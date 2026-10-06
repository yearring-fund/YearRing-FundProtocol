/**
 * rehearsal_fork.ts — YearRing Closed Beta: Fork Rehearsal on Base Mainnet
 *
 * Forks Base mainnet, deploys the closed beta contracts against real USDC + Aave V3,
 * then runs the full user flow using impersonated whale accounts.
 *
 * If fork activation fails (RPC unavailable / block pruned), all tests are skipped
 * gracefully — does NOT fail the pipeline.
 *
 * Flow covered:
 *   1. Deploy full stack (real USDC, AaveV3StrategyV01)
 *   2. Setup all roles + rebate budget
 *   3. Impersonate USDC whale → fund test users
 *   4. Deposit USDC → yrCORE
 *   5. Lock yrCORE → Points issued
 *   6. Invest to Aave via StrategyManager
 *   7. Advance time (hardhat_increaseTime)
 *   8. Divest from Aave → returnToVault
 *   9. accrueManagementFee → verify treasury yrCORE
 *  10. claimRebate → verify yrCORE to user
 *  11. earlyExit → verify Points returned to treasury
 *  12. unlock mature lock → verify yrCORE returned
 *  13. redeem yrCORE → verify USDC out
 *  14. EmergencyExit simulation (stratMgr.emergencyExit)
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/rehearsal_fork.ts --network hardhat
 *
 * Requires in .env:
 *   BASE_MAINNET_RPC_URL=<your QuickNode / Alchemy Base endpoint>
 */

import { ethers, network } from "hardhat";
import { getClosedBetaConfig } from "./config";

// ── Helpers ──────────────────────────────────────────────────────────────────
const SEP  = () => console.log("-".repeat(68));
const HDR  = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK   = (msg: string) => console.log(`  ✓  ${msg}`);
const INFO = (msg: string) => console.log(`  ℹ  ${msg}`);
const SKIP = (msg: string) => console.log(`  –  ${msg}`);

let failures = 0;
function checkGt(label: string, actual: bigint, floor: bigint) {
  if (actual > floor) { OK(`${label} (${actual})`); }
  else { console.log(`  ✗  ${label}: expected > ${floor}, got ${actual}`); failures++; }
}
function checkEq(label: string, expected: bigint, actual: bigint) {
  if (expected === actual) { OK(`${label} (${actual})`); }
  else { console.log(`  ✗  ${label}: expected ${expected}, got ${actual}`); failures++; }
}
function checkLt(label: string, actual: bigint, ceiling: bigint) {
  if (actual < ceiling) { OK(`${label} (${actual})`); }
  else { console.log(`  ✗  ${label}: expected < ${ceiling}, got ${actual}`); failures++; }
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ── Fork activation ───────────────────────────────────────────────────────────
async function activateFork(): Promise<boolean> {
  const rpcUrl = process.env.BASE_MAINNET_RPC_URL;
  if (!rpcUrl) {
    console.log("\n  ⚠  BASE_MAINNET_RPC_URL not set — skipping fork rehearsal");
    return false;
  }

  console.log("\n  Activating Base mainnet fork …");
  try {
    await ethers.provider.send("hardhat_reset", [{
      forking: { jsonRpcUrl: rpcUrl },
    }]);
    const block = await ethers.provider.getBlockNumber();
    console.log(`  Fork active at block ${block}`);
    return true;
  } catch (e: any) {
    console.log(`  ⚠  Fork activation failed: ${String(e.message).slice(0, 120)}`);
    console.log("  ⚠  Skipping fork rehearsal — local rehearsal is sufficient for CI.");
    return false;
  }
}

// ── Find USDC whale (scan known Base mainnet holders) ─────────────────────────
const KNOWN_USDC_WHALES = [
  "0xd0b53D9277642d899DF5C87A3966A349A798F224", // Aave aUSDC pool
  "0x4200000000000000000000000000000000000006", // WETH (usually has USDC pairs)
  "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A", // known Base USDC holder
];

async function findWhale(usdcAddr: string, minAmount: bigint): Promise<string | null> {
  const erc20 = new ethers.Contract(usdcAddr,
    ["function balanceOf(address) view returns (uint256)"],
    ethers.provider);
  for (const w of KNOWN_USDC_WHALES) {
    try {
      const bal = await erc20.balanceOf(w);
      if (bal >= minAmount) {
        INFO(`USDC whale found: ${w} (balance: ${ethers.formatUnits(bal,6)} USDC)`);
        return w;
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "=".repeat(68));
  console.log("  Closed Beta — Fork Rehearsal (Base Mainnet fork)");
  console.log("=".repeat(68));

  const forkActive = await activateFork();
  if (!forkActive) {
    console.log("\n  SKIPPED — fork not available");
    console.log("=".repeat(68) + "\n");
    return;
  }

  const cfg = getClosedBetaConfig("base");
  const signers = await ethers.getSigners();
  const admin   = signers[0];
  const alice   = signers[1];
  const bob     = signers[2];
  const MaxUint256 = ethers.MaxUint256;
  const DAY  = 86400;
  const LOCK_DURATION_ALICE = BigInt(90 * DAY);
  const LOCK_DURATION_BOB   = BigInt(30 * DAY);

  // Fund hardhat signers with ETH for gas
  for (const s of [admin, alice, bob]) {
    await ethers.provider.send("hardhat_setBalance", [
      s.address, "0x" + (10n * 10n**18n).toString(16),
    ]);
  }
  INFO(`Admin: ${admin.address}`);
  INFO(`Alice: ${alice.address}`);
  INFO(`Bob:   ${bob.address}`);

  // ── Find & impersonate USDC whale ─────────────────────────────────────────
  HDR("Step 1 · Acquire USDC via whale impersonation");

  const NEED_USDC = 20_000n * 1_000_000n; // 20,000 USDC total
  const whaleAddr = await findWhale(cfg.usdc, NEED_USDC);
  if (!whaleAddr) {
    console.log("  ⚠  No USDC whale found with sufficient balance — skipping fork rehearsal");
    return;
  }

  await ethers.provider.send("hardhat_impersonateAccount", [whaleAddr]);
  await ethers.provider.send("hardhat_setBalance", [
    whaleAddr, "0x" + (5n * 10n**18n).toString(16),
  ]);
  const whale = await ethers.getSigner(whaleAddr);

  const USDC_ABI = [
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const usdc = new ethers.Contract(cfg.usdc, USDC_ABI, whale);

  const ALICE_USDC = 10_000n * 1_000_000n;
  const BOB_USDC   = 5_000n  * 1_000_000n;
  await (await usdc.transfer(alice.address, ALICE_USDC)).wait();
  await (await usdc.transfer(bob.address,   BOB_USDC)).wait();
  OK(`Whale → Alice: ${ethers.formatUnits(ALICE_USDC,6)} USDC`);
  OK(`Whale → Bob:   ${ethers.formatUnits(BOB_USDC,6)} USDC`);
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [whaleAddr]);

  // ── Deploy full stack ──────────────────────────────────────────────────────
  HDR("Step 2 · Deploy contracts (real USDC + AaveV3StrategyV01)");

  async function dep(name: string, args: unknown[]): Promise<string> {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    OK(`${name.padEnd(38)} ${a}`);
    return a;
  }

  const treasuryAddr = await dep("TreasuryV02",   [admin.address]);
  const pointsAddr   = await dep("PointsToken",   [
    cfg.pointsTokenName, cfg.pointsTokenSymbol, cfg.pointsTotalSupply, treasuryAddr,
  ]);
  const vaultAddr    = await dep("YearRingCoreVaultV01", [
    cfg.usdc, cfg.vaultName, cfg.vaultSymbol, treasuryAddr, admin.address, cfg.mgmtFeeBpsPerMonth,
  ]);
  const ledgerAddr   = await dep("LockLedgerV02",  [vaultAddr, admin.address, admin.address]);
  const benefitAddr  = await dep("LockBenefitV02", [ledgerAddr]);
  const managerAddr  = await dep("LockPointsRebateManagerV02", [
    ledgerAddr, benefitAddr, pointsAddr, vaultAddr, vaultAddr, treasuryAddr, admin.address, admin.address,
  ]);
  const beneModAddr  = await dep("BeneficiaryModuleV02", [ledgerAddr, admin.address]);
  await dep("UserStateEngineV02", [ledgerAddr]);
  await dep("MetricsLayerV02",    [vaultAddr, ledgerAddr]);
  await dep("GovernanceSignalV02",[pointsAddr, cfg.votingThreshold, cfg.votingPeriod, admin.address]);
  await dep("ClaimLedger",        [admin.address]);
  const stratMgrAddr = await dep("StrategyManagerV01",   [cfg.usdc, vaultAddr, admin.address]);
  const strategyAddr = await dep("AaveV3StrategyV01",    [
    cfg.usdc, stratMgrAddr, cfg.aavePool, cfg.aUsdc, cfg.aaveReferralCode,
  ]);
  INFO("AaveV3StrategyV01 bound to Base Aave V3 Pool");

  // ── Setup roles ────────────────────────────────────────────────────────────
  HDR("Step 3 · Setup roles & bindings");

  const VAULT_SETUP_ABI = [
    "function setLockLedger(address) external",
    "function setModules(address) external",
    "function setExternalTransfersEnabled(bool) external",
    "function addToAllowlist(address) external",
    "function setReserveRatioBps(uint256) external",
  ];
  const LEDGER_SETUP_ABI = [
    "function OPERATOR_ROLE() view returns (bytes32)",
    "function grantRole(bytes32,address) external",
  ];
  const TREASURY_SETUP_ABI = [
    "function setRebateManager(address) external",
    "function setApprovedAsset(address,bool) external",
    "function setApprovedModule(address,bool) external",
    "function approveSpender(address,address,uint256) external",
    "function setRebateBudget(address,uint256) external",
  ];
  const STRATMGR_SETUP_ABI = [
    "function setStrategy(address) external",
    "function pause() external",
    "function unpause() external",
  ];

  const vaultSetup    = new ethers.Contract(vaultAddr,    VAULT_SETUP_ABI,    admin);
  const ledgerSetup   = new ethers.Contract(ledgerAddr,   LEDGER_SETUP_ABI,   admin);
  const treasurySetup = new ethers.Contract(treasuryAddr, TREASURY_SETUP_ABI, admin);
  const stratMgrSetup = new ethers.Contract(stratMgrAddr, STRATMGR_SETUP_ABI, admin);

  await (await vaultSetup.setLockLedger(ledgerAddr)).wait();              OK("vault.setLockLedger");
  await (await vaultSetup.setModules(stratMgrAddr)).wait();               OK("vault.setModules");
  await (await vaultSetup.setExternalTransfersEnabled(true)).wait();      OK("vault.setExternalTransfersEnabled");
  await (await vaultSetup.addToAllowlist(alice.address)).wait();          OK("allowlist: Alice");
  await (await vaultSetup.addToAllowlist(bob.address)).wait();            OK("allowlist: Bob");
  await (await vaultSetup.setReserveRatioBps(3000)).wait();              OK("vault.setReserveRatioBps(3000)");

  const OPERATOR_ROLE = await ledgerSetup.OPERATOR_ROLE();
  await (await ledgerSetup.grantRole(OPERATOR_ROLE, managerAddr)).wait(); OK("ledger: OPERATOR → manager");
  await (await ledgerSetup.grantRole(OPERATOR_ROLE, beneModAddr)).wait(); OK("ledger: OPERATOR → beneMod");

  await (await treasurySetup.setRebateManager(managerAddr)).wait();       OK("treasury.setRebateManager");
  await (await treasurySetup.setApprovedAsset(vaultAddr, true)).wait();   OK("treasury.setApprovedAsset(yrCORE)");
  await (await treasurySetup.setApprovedModule(managerAddr, true)).wait();OK("treasury.setApprovedModule(manager)");
  await (await treasurySetup.approveSpender(vaultAddr, managerAddr, MaxUint256)).wait();
  OK("treasury.approveSpender(yrCORE → manager, MaxUint256)");
  await (await treasurySetup.setApprovedAsset(pointsAddr, true)).wait();  OK("treasury.setApprovedAsset(YRPTS)");
  await (await treasurySetup.approveSpender(pointsAddr, managerAddr, MaxUint256)).wait();
  OK("treasury.approveSpender(YRPTS → manager, MaxUint256)");
  await (await treasurySetup.setRebateBudget(vaultAddr, MaxUint256)).wait();
  OK("treasury.setRebateBudget(yrCORE, MaxUint256)");

  await (await stratMgrSetup.pause()).wait();                              OK("stratMgr.pause");
  await (await stratMgrSetup.setStrategy(strategyAddr)).wait();           OK("stratMgr.setStrategy(AaveV3)");
  await (await stratMgrSetup.unpause()).wait();                            OK("stratMgr.unpause");

  // ── User flows ─────────────────────────────────────────────────────────────
  const ERC20_ABI = [
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ];
  const VAULT_ABI = [
    "function deposit(uint256,address) external returns (uint256)",
    "function redeem(uint256,address,address) external returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function accrueManagementFee() external",
    "function transferToStrategyManager(uint256) external",
    "function pricePerShare() view returns (uint256)",
  ];
  const MANAGER_ABI = [
    "function lockWithPoints(uint256,uint64) external returns (uint256)",
    "function claimRebate(uint256) external returns (uint256)",
    "function earlyExit(uint256) external",
    "function previewRebate(uint256) view returns (uint256)",
    "function issuedPoints(uint256) view returns (uint256)",
  ];
  const LEDGER_ABI = ["function unlock(uint256) external"];
  const STRATMGR_ABI = [
    "function invest(uint256) external",
    "function divest(uint256) external",
    "function returnToVault(uint256) external",
    "function idleUnderlying() view returns (uint256)",
    "function totalManagedAssets() view returns (uint256)",
    "function emergencyExit() external",
  ];

  const aliceUsdc  = new ethers.Contract(cfg.usdc, ERC20_ABI, alice);
  const bobUsdc    = new ethers.Contract(cfg.usdc, ERC20_ABI, bob);
  const aliceYrCore = new ethers.Contract(vaultAddr, ERC20_ABI, alice);
  const bobYrCore   = new ethers.Contract(vaultAddr, ERC20_ABI, bob);
  const alicePts   = new ethers.Contract(pointsAddr, ERC20_ABI, alice);
  const bobPts     = new ethers.Contract(pointsAddr, ERC20_ABI, bob);
  const aliceVault = new ethers.Contract(vaultAddr,    VAULT_ABI,   alice);
  const bobVault   = new ethers.Contract(vaultAddr,    VAULT_ABI,   bob);
  const aliceMgr   = new ethers.Contract(managerAddr,  MANAGER_ABI, alice);
  const bobMgr     = new ethers.Contract(managerAddr,  MANAGER_ABI, bob);
  const aliceLedger = new ethers.Contract(ledgerAddr,  LEDGER_ABI,  alice);
  const vault      = new ethers.Contract(vaultAddr,    VAULT_ABI,    admin);
  const stratMgr   = new ethers.Contract(stratMgrAddr, STRATMGR_ABI, admin);

  // ── Deposit ────────────────────────────────────────────────────────────────
  HDR("Step 4 · Deposit USDC → yrCORE");

  await (await aliceUsdc.approve(vaultAddr, ALICE_USDC)).wait();
  await (await aliceVault.deposit(ALICE_USDC, alice.address)).wait();
  const aliceShares = await aliceYrCore.balanceOf(alice.address);
  checkGt("Alice yrCORE > 0", aliceShares, 0n);
  OK(`Alice: ${ethers.formatUnits(ALICE_USDC,6)} USDC → ${ethers.formatEther(aliceShares)} yrCORE`);

  await (await bobUsdc.approve(vaultAddr, BOB_USDC)).wait();
  await (await bobVault.deposit(BOB_USDC, bob.address)).wait();
  const bobShares = await bobYrCore.balanceOf(bob.address);
  checkGt("Bob yrCORE > 0", bobShares, 0n);
  OK(`Bob:   ${ethers.formatUnits(BOB_USDC,6)} USDC → ${ethers.formatEther(bobShares)} yrCORE`);

  const totalAssets0 = await vault.totalAssets();
  INFO(`Vault totalAssets: ${ethers.formatUnits(totalAssets0,6)} USDC`);

  // ── Lock ───────────────────────────────────────────────────────────────────
  HDR("Step 5 · Lock yrCORE → Points issued");

  const aliceLockShares = aliceShares / 2n;
  await (await aliceYrCore.approve(ledgerAddr, aliceLockShares)).wait();
  await (await aliceMgr.lockWithPoints(aliceLockShares, LOCK_DURATION_ALICE)).wait();
  const aliceLockId = 0n;
  const alicePoints = await aliceMgr.issuedPoints(aliceLockId);
  checkGt("Alice Points issued > 0", alicePoints, 0n);
  OK(`Alice locked ${ethers.formatEther(aliceLockShares)} yrCORE 90d → ${ethers.formatEther(alicePoints)} YRPTS`);

  await (await bobYrCore.approve(ledgerAddr, bobShares)).wait();
  await (await bobMgr.lockWithPoints(bobShares, LOCK_DURATION_BOB)).wait();
  const bobLockId = 1n;
  const bobPoints = await bobMgr.issuedPoints(bobLockId);
  checkGt("Bob Points issued > 0", bobPoints, 0n);
  OK(`Bob locked ${ethers.formatEther(bobShares)} yrCORE 30d → ${ethers.formatEther(bobPoints)} YRPTS`);

  // ── Invest to Aave ─────────────────────────────────────────────────────────
  HDR("Step 6 · Invest to Aave V3");

  const investAmount = 5_000n * 1_000_000n;
  await (await vault.transferToStrategyManager(investAmount)).wait();
  OK(`vault.transferToStrategyManager(${ethers.formatUnits(investAmount,6)} USDC)`);
  await (await stratMgr.invest(investAmount)).wait();
  OK(`stratMgr.invest(${ethers.formatUnits(investAmount,6)} USDC) → Aave V3`);

  const managedAfterInvest = await stratMgr.totalManagedAssets();
  checkGt("totalManagedAssets > 0 after Aave invest", managedAfterInvest, 0n);
  INFO(`Aave aUSDC position: ${ethers.formatUnits(managedAfterInvest,6)} USDC`);

  // ── Advance time ───────────────────────────────────────────────────────────
  HDR("Step 7 · Advance time 31d (simulates Aave interest accrual)");

  await increaseTime(31 * DAY);
  OK("Time advanced 31 days");

  const managedAfterTime = await stratMgr.totalManagedAssets();
  INFO(`totalManagedAssets after 31d: ${ethers.formatUnits(managedAfterTime,6)} USDC`);
  // Aave interest accrual may or may not change balance in fork (depends on Aave state)
  OK("Time advance confirmed");

  // ── Divest from Aave ───────────────────────────────────────────────────────
  HDR("Step 8 · Divest from Aave → returnToVault");

  await (await stratMgr.divest(managedAfterTime)).wait();
  OK(`stratMgr.divest(${ethers.formatUnits(managedAfterTime,6)} requested)`);
  const idleAfterDivest = await stratMgr.idleUnderlying();
  checkGt("StrategyManager has USDC after Aave divest", idleAfterDivest, 0n);
  OK(`idleUnderlying: ${ethers.formatUnits(idleAfterDivest,6)} USDC`);

  await (await stratMgr.returnToVault(idleAfterDivest)).wait();
  OK("stratMgr.returnToVault");
  const totalAssetsAfterDivest = await vault.totalAssets();
  checkGt("Vault totalAssets > initial after divest", totalAssetsAfterDivest, totalAssets0);
  INFO(`Vault totalAssets: ${ethers.formatUnits(totalAssetsAfterDivest,6)} USDC`);

  // ── accrueManagementFee ────────────────────────────────────────────────────
  HDR("Step 9 · accrueManagementFee");

  await (await vault.accrueManagementFee()).wait();
  const treasuryBal = await aliceYrCore.balanceOf(treasuryAddr);
  checkGt("Treasury yrCORE > 0 (fee accrued)", treasuryBal, 0n);
  INFO(`Treasury yrCORE: ${ethers.formatEther(treasuryBal)}`);

  // ── claimRebate ────────────────────────────────────────────────────────────
  HDR("Step 10 · Alice claimRebate");

  const rebatePreview = await aliceMgr.previewRebate(aliceLockId);
  INFO(`previewRebate: ${ethers.formatEther(rebatePreview)} yrCORE`);
  const aliceYrcoreBefore = await aliceYrCore.balanceOf(alice.address);
  await (await aliceMgr.claimRebate(aliceLockId)).wait();
  const aliceYrcoreAfter = await aliceYrCore.balanceOf(alice.address);
  checkGt("Alice yrCORE increased after claimRebate", aliceYrcoreAfter, aliceYrcoreBefore);
  OK(`Rebate received: ${ethers.formatEther(aliceYrcoreAfter - aliceYrcoreBefore)} yrCORE`);

  // ── earlyExit ──────────────────────────────────────────────────────────────
  HDR("Step 11 · Bob earlyExit");

  await (await bobPts.approve(managerAddr, bobPoints)).wait();
  OK(`Bob approved ${ethers.formatEther(bobPoints)} YRPTS`);
  const bobYrcoreBefore = await bobYrCore.balanceOf(bob.address);
  await (await bobMgr.earlyExit(bobLockId)).wait();
  const bobYrcoreAfter  = await bobYrCore.balanceOf(bob.address);
  const bobPtsAfter     = await bobPts.balanceOf(bob.address);
  checkGt("Bob yrCORE returned after earlyExit", bobYrcoreAfter, bobYrcoreBefore);
  checkEq("Bob Points fully returned (= 0)", 0n, bobPtsAfter);
  OK(`Bob earlyExit: received ${ethers.formatEther(bobYrcoreAfter - bobYrcoreBefore)} yrCORE`);

  // ── Advance to Alice lock maturity ─────────────────────────────────────────
  HDR("Step 12 · Advance to Alice's 90d lock maturity → unlock");

  await increaseTime(59 * DAY); // already at 31d + now +59d = 90d
  OK("Time advanced 59 more days (total: 90d)");

  const aliceBeforeUnlock = await aliceYrCore.balanceOf(alice.address);
  await (await aliceLedger.unlock(aliceLockId)).wait();
  const aliceAfterUnlock = await aliceYrCore.balanceOf(alice.address);
  checkGt("Alice yrCORE returned on unlock", aliceAfterUnlock, aliceBeforeUnlock);
  OK(`Unlocked: ${ethers.formatEther(aliceAfterUnlock - aliceBeforeUnlock)} yrCORE returned`);

  // ── redeem ─────────────────────────────────────────────────────────────────
  HDR("Step 13 · Alice redeem yrCORE → USDC");

  const aliceAllShares = await aliceYrCore.balanceOf(alice.address);
  const aliceUsdcBefore = await (new ethers.Contract(cfg.usdc, ERC20_ABI, alice)).balanceOf(alice.address);
  await (await aliceVault.redeem(aliceAllShares, alice.address, alice.address)).wait();
  const aliceUsdcAfter = await (new ethers.Contract(cfg.usdc, ERC20_ABI, alice)).balanceOf(alice.address);
  checkGt("Alice received USDC after redeem", aliceUsdcAfter, aliceUsdcBefore);
  const usdcOut = aliceUsdcAfter - aliceUsdcBefore;
  OK(`Alice redeemed ${ethers.formatEther(aliceAllShares)} yrCORE → ${ethers.formatUnits(usdcOut,6)} USDC`);
  INFO(`USDC out vs original deposit: ${ethers.formatUnits(ALICE_USDC/2n,6)} → ${ethers.formatUnits(usdcOut,6)}`);

  // ── EmergencyExit simulation ───────────────────────────────────────────────
  HDR("Step 14 · EmergencyExit simulation (strategy level)");

  // Re-invest a small amount to test emergencyExit path
  const smallInvest = 100n * 1_000_000n; // 100 USDC
  const vaultUsdcBal = await (new ethers.Contract(cfg.usdc, ERC20_ABI, admin)).balanceOf(vaultAddr);
  if (vaultUsdcBal >= smallInvest) {
    await (await vault.transferToStrategyManager(smallInvest)).wait();
    await (await stratMgr.invest(smallInvest)).wait();
    OK(`Re-invested ${ethers.formatUnits(smallInvest,6)} USDC to Aave`);

    await (await stratMgr.emergencyExit()).wait();
    OK("stratMgr.emergencyExit() called — Aave position fully divested");
    const idleAfterEmergency = await stratMgr.idleUnderlying();
    checkGt("StrategyManager holds USDC after emergencyExit", idleAfterEmergency, 0n);
    INFO(`Idle after emergency: ${ethers.formatUnits(idleAfterEmergency,6)} USDC`);
    await (await stratMgr.returnToVault(idleAfterEmergency)).wait();
    OK("returnToVault after emergencyExit");
  } else {
    SKIP("Vault USDC too low for re-invest test — emergencyExit skipped");
  }

  // ── Result ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ALL FORK REHEARSAL CHECKS PASSED ✓");
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
  }
  console.log("=".repeat(68) + "\n");

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
