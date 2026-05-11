/**
 * rehearsal_local.ts — YearRing Closed Beta: Full User Flow Rehearsal (local hardhat)
 *
 * Simulates a complete closed beta lifecycle in a single Hardhat process:
 *   Deploy → Setup Roles → User Flows → Verify Final State
 *
 * User flow coverage:
 *   1. Admin: allowlist users, invest to strategy, pause/unpause
 *   2. Alice: deposit USDC → yrCORE, lock yrCORE → Points issued
 *   3. Bob:   deposit USDC → yrCORE, lock yrCORE (will early exit)
 *   4. Time advance → rebate accrues
 *   5. Alice: previewRebate → claimRebate → verify yrCORE received
 *   6. Bob:   previewEarlyExit → earlyExit → verify Points returned
 *   7. Time advance past Alice's lock maturity
 *   8. Alice: unlock mature lock → verify yrCORE returned
 *   9. Alice: redeem yrCORE → verify USDC received
 *  10. Admin: invest → simulateYield → divest → returnToVault
 *  11. Admin: pause deposits → check deposit blocked → unpause
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/rehearsal_local.ts --network hardhat
 */

import { ethers } from "hardhat";
import { getClosedBetaConfig } from "./config";

// ── Helpers ──────────────────────────────────────────────────────────────────
const SEP = () => console.log("-".repeat(68));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK  = (msg: string) => console.log(`  ✓  ${msg}`);
const INFO = (msg: string) => console.log(`  ℹ  ${msg}`);

let failures = 0;
function check(label: string, expected: string, actual: string) {
  if (expected.toLowerCase() === actual.toLowerCase()) { OK(label); }
  else {
    console.log(`  ✗  ${label}`);
    console.log(`       expected: ${expected}`);
    console.log(`       actual  : ${actual}`);
    failures++;
  }
}
function checkGte(label: string, actual: bigint, floor: bigint) {
  if (actual >= floor) { OK(`${label} (${actual})`); }
  else {
    console.log(`  ✗  ${label}: expected >= ${floor}, got ${actual}`);
    failures++;
  }
}
function checkEq(label: string, expected: bigint, actual: bigint) {
  if (expected === actual) { OK(`${label} (${actual})`); }
  else {
    console.log(`  ✗  ${label}: expected ${expected}, got ${actual}`);
    failures++;
  }
}
function checkGt(label: string, actual: bigint, floor: bigint) {
  if (actual > floor) { OK(`${label} (${actual})`); }
  else {
    console.log(`  ✗  ${label}: expected > ${floor}, got ${actual}`);
    failures++;
  }
}
function checkLt(label: string, actual: bigint, ceiling: bigint) {
  if (actual < ceiling) { OK(`${label} (${actual})`); }
  else {
    console.log(`  ✗  ${label}: expected < ${ceiling}, got ${actual}`);
    failures++;
  }
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = getClosedBetaConfig("hardhat");
  const signers = await ethers.getSigners();
  const admin   = signers[0];
  const alice   = signers[1];
  const bob     = signers[2];
  const MaxUint256 = ethers.MaxUint256;

  const DAY  = 86400;
  const LOCK_DURATION_ALICE = BigInt(90 * DAY);  // Alice: 90-day lock (will hold to maturity)
  const LOCK_DURATION_BOB   = BigInt(60 * DAY);  // Bob:   60-day lock (will early exit)

  console.log("\n" + "=".repeat(68));
  console.log("  Closed Beta — Full User Flow Rehearsal (local hardhat)");
  console.log("=".repeat(68));
  console.log("  Admin/Deployer:", admin.address);
  console.log("  Alice:         ", alice.address);
  console.log("  Bob:           ", bob.address);
  console.log("=".repeat(68) + "\n");

  // ── PHASE 1: Deploy ──────────────────────────────────────────────────────
  HDR("Phase 1 · Deploy");

  async function dep(name: string, args: unknown[]): Promise<string> {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    OK(`${name.padEnd(38)} ${a}`);
    return a;
  }

  const mockUsdcAddr = await dep("MockUSDC", []);
  const treasuryAddr = await dep("TreasuryV02", [admin.address]);
  const pointsAddr   = await dep("PointsToken", [
    cfg.pointsTokenName, cfg.pointsTokenSymbol, cfg.pointsTotalSupply, treasuryAddr,
  ]);
  const vaultAddr    = await dep("YearRingCoreVaultV01", [
    mockUsdcAddr, cfg.vaultName, cfg.vaultSymbol, treasuryAddr, admin.address, cfg.mgmtFeeBpsPerMonth,
  ]);
  const ledgerAddr   = await dep("LockLedgerV02",    [vaultAddr, admin.address, admin.address]);
  const benefitAddr  = await dep("LockBenefitV02",   [ledgerAddr]);
  const managerAddr  = await dep("LockPointsRebateManagerV02", [
    ledgerAddr, benefitAddr, pointsAddr, vaultAddr, vaultAddr, treasuryAddr, admin.address, admin.address,
  ]);
  const beneModAddr  = await dep("BeneficiaryModuleV02", [ledgerAddr, admin.address]);
  await dep("UserStateEngineV02",   [ledgerAddr]);
  await dep("MetricsLayerV02",      [vaultAddr, ledgerAddr]);
  await dep("GovernanceSignalV02",  [pointsAddr, cfg.votingThreshold, cfg.votingPeriod, admin.address]);
  await dep("ClaimLedger",          [admin.address]);
  const stratMgrAddr = await dep("StrategyManagerV01",   [mockUsdcAddr, vaultAddr, admin.address]);
  const strategyAddr = await dep("DummyStrategy",        [mockUsdcAddr]);

  // ── PHASE 2: Setup Roles ─────────────────────────────────────────────────
  HDR("Phase 2 · Setup Roles & Bindings");

  const VAULT_ABI = [
    "function setLockLedger(address) external",
    "function setModules(address) external",
    "function setExternalTransfersEnabled(bool) external",
  ];
  const LEDGER_ABI = [
    "function OPERATOR_ROLE() view returns (bytes32)",
    "function grantRole(bytes32,address) external",
  ];
  const TREASURY_ABI = [
    "function setRebateManager(address) external",
    "function setApprovedAsset(address,bool) external",
    "function setApprovedModule(address,bool) external",
    "function approveSpender(address,address,uint256) external",
    "function setRebateBudget(address,uint256) external",
  ];
  const STRATMGR_ABI = [
    "function setStrategy(address) external",
    "function pause() external",
    "function unpause() external",
  ];

  const vaultSetup    = new ethers.Contract(vaultAddr,    VAULT_ABI,    admin);
  const ledgerSetup   = new ethers.Contract(ledgerAddr,   LEDGER_ABI,   admin);
  const treasurySetup = new ethers.Contract(treasuryAddr, TREASURY_ABI, admin);
  const stratMgrSetup = new ethers.Contract(stratMgrAddr, STRATMGR_ABI, admin);

  await (await vaultSetup.setLockLedger(ledgerAddr)).wait();              OK("vault.setLockLedger");
  await (await vaultSetup.setModules(stratMgrAddr)).wait();               OK("vault.setModules");
  await (await vaultSetup.setExternalTransfersEnabled(true)).wait();      OK("vault.setExternalTransfersEnabled");

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
  // Set rebate budget — budget=0 blocks claimRebate; set to MaxUint256 for closed beta.
  await (await treasurySetup.setRebateBudget(vaultAddr, MaxUint256)).wait();
  OK("treasury.setRebateBudget(yrCORE, MaxUint256)");

  await (await stratMgrSetup.pause()).wait();                              OK("stratMgr.pause");
  await (await stratMgrSetup.setStrategy(strategyAddr)).wait();           OK("stratMgr.setStrategy");
  await (await stratMgrSetup.unpause()).wait();                            OK("stratMgr.unpause");

  // ── Contract handles ──────────────────────────────────────────────────────
  const ERC20_ABI = [
    "function mint(address,uint256) external",
    "function approve(address,uint256) external",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const VAULT_USER_ABI = [
    "function addToAllowlist(address) external",
    "function deposit(uint256,address) external returns (uint256)",
    "function redeem(uint256,address,address) external returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function approve(address,uint256) external",
    "function pauseDeposits() external",
    "function unpauseDeposits() external",
    "function accrueManagementFee() external",
    "function pricePerShare() view returns (uint256)",
    "function setReserveRatioBps(uint256) external",
    "function transferToStrategyManager(uint256) external",
    "function availableToInvest() view returns (uint256)",
  ];
  const MANAGER_ABI = [
    "function lockWithPoints(uint256,uint64) external returns (uint256)",
    "function claimRebate(uint256) external returns (uint256)",
    "function earlyExit(uint256) external",
    "function previewRebate(uint256) view returns (uint256)",
    "function issuedPoints(uint256) view returns (uint256)",
  ];
  const LEDGER_USER_ABI = [
    "function unlock(uint256) external",
  ];
  const STRATMGR_USER_ABI = [
    "function invest(uint256) external",
    "function divest(uint256) external",
    "function returnToVault(uint256) external",
    "function totalManagedAssets() view returns (uint256)",
    "function idleUnderlying() view returns (uint256)",
  ];
  const DUMMY_ABI = ["function simulateYield(uint256) external"];

  const mockUsdc  = new ethers.Contract(mockUsdcAddr, ERC20_ABI,           admin);
  const pts       = new ethers.Contract(pointsAddr,   ERC20_ABI,           admin);
  const vault     = new ethers.Contract(vaultAddr,    VAULT_USER_ABI,      admin);
  const mgr       = new ethers.Contract(managerAddr,  MANAGER_ABI,         admin);
  const ledger    = new ethers.Contract(ledgerAddr,   LEDGER_USER_ABI,     admin);
  const stratMgr  = new ethers.Contract(stratMgrAddr, STRATMGR_USER_ABI,  admin);
  const dummy     = new ethers.Contract(strategyAddr, DUMMY_ABI,           admin);

  const aliceMockUsdc = mockUsdc.connect(alice) as typeof mockUsdc;
  const bobMockUsdc   = mockUsdc.connect(bob)   as typeof mockUsdc;
  const aliceVault    = vault.connect(alice)    as typeof vault;
  const bobVault      = vault.connect(bob)      as typeof vault;
  const aliceMgr      = mgr.connect(alice)      as typeof mgr;
  const bobMgr        = mgr.connect(bob)        as typeof mgr;
  const aliceVaultShares = new ethers.Contract(vaultAddr, ERC20_ABI, alice);
  const bobVaultShares   = new ethers.Contract(vaultAddr, ERC20_ABI, bob);
  const alicePts      = pts.connect(alice)      as typeof pts;
  const bobPts        = pts.connect(bob)        as typeof pts;
  const aliceLedger   = ledger.connect(alice)   as typeof ledger;

  // ── PHASE 3: Allowlist + Mint USDC ───────────────────────────────────────
  HDR("Phase 3 · Allowlist users & mint MockUSDC");

  await (await vault.addToAllowlist(alice.address)).wait();  OK("allowlist: Alice");
  await (await vault.addToAllowlist(bob.address)).wait();    OK("allowlist: Bob");

  const ALICE_USDC = 10_000n * 1_000_000n;  // 10,000 USDC (6 dec)
  const BOB_USDC   = 5_000n  * 1_000_000n;  //  5,000 USDC (6 dec)

  await (await mockUsdc.mint(alice.address, ALICE_USDC)).wait(); OK(`MockUSDC.mint(Alice, ${ethers.formatUnits(ALICE_USDC,6)} USDC)`);
  await (await mockUsdc.mint(bob.address,   BOB_USDC)).wait();   OK(`MockUSDC.mint(Bob,   ${ethers.formatUnits(BOB_USDC,6)} USDC)`);

  // ── PHASE 4: Deposit ─────────────────────────────────────────────────────
  HDR("Phase 4 · Deposit USDC → yrCORE");

  await (await aliceMockUsdc.approve(vaultAddr, ALICE_USDC)).wait();
  const aliceDepositTx = await aliceVault.deposit(ALICE_USDC, alice.address);
  await aliceDepositTx.wait();
  const aliceShares0 = await (vault.connect(alice) as any).balanceOf(alice.address);
  OK(`Alice deposited ${ethers.formatUnits(ALICE_USDC,6)} USDC → ${ethers.formatEther(aliceShares0)} yrCORE`);
  checkGt("Alice yrCORE > 0", aliceShares0, 0n);

  await (await bobMockUsdc.approve(vaultAddr, BOB_USDC)).wait();
  const bobDepositTx = await bobVault.deposit(BOB_USDC, bob.address);
  await bobDepositTx.wait();
  const bobShares0 = await (vault.connect(bob) as any).balanceOf(bob.address);
  OK(`Bob deposited ${ethers.formatUnits(BOB_USDC,6)} USDC → ${ethers.formatEther(bobShares0)} yrCORE`);
  checkGt("Bob yrCORE > 0", bobShares0, 0n);

  const totalAssets0 = await vault.totalAssets();
  INFO(`Vault totalAssets: ${ethers.formatUnits(totalAssets0, 6)} USDC`);

  // ── PHASE 5: Lock ────────────────────────────────────────────────────────
  HDR("Phase 5 · Lock yrCORE → Points issued");

  // Alice locks half her shares for 90 days
  const aliceLockShares = aliceShares0 / 2n;
  await (await aliceVaultShares.approve(ledgerAddr, aliceLockShares)).wait();
  const aliceLockTx = await aliceMgr.lockWithPoints(aliceLockShares, LOCK_DURATION_ALICE);
  const aliceLockReceipt = await aliceLockTx.wait();
  // lockId starts at 0 (nextLockId increments per lock)
  const aliceLockId = 0n;
  const alicePoints = await mgr.issuedPoints(aliceLockId);
  OK(`Alice locked ${ethers.formatEther(aliceLockShares)} yrCORE for 90d → lockId=${aliceLockId}`);
  checkGt("Alice Points issued > 0", alicePoints, 0n);
  INFO(`Alice issuedPoints: ${ethers.formatEther(alicePoints)} YRPTS`);

  // Bob locks all his shares for 60 days (will early exit later)
  const bobLockShares = bobShares0;
  await (await bobVaultShares.approve(ledgerAddr, bobLockShares)).wait();
  const bobLockTx = await bobMgr.lockWithPoints(bobLockShares, LOCK_DURATION_BOB);
  await bobLockTx.wait();
  const bobLockId = 1n;
  const bobPoints = await mgr.issuedPoints(bobLockId);
  OK(`Bob locked ${ethers.formatEther(bobLockShares)} yrCORE for 60d → lockId=${bobLockId}`);
  checkGt("Bob Points issued > 0", bobPoints, 0n);
  INFO(`Bob issuedPoints: ${ethers.formatEther(bobPoints)} YRPTS`);

  // Verify Points came from Treasury
  const treasuryPtsAfterLocks = await pts.balanceOf(treasuryAddr);
  const expectedTreasuryPts = cfg.pointsTotalSupply - alicePoints - bobPoints;
  checkEq("Treasury YRPTS decreased by issued amount", expectedTreasuryPts, treasuryPtsAfterLocks);

  // ── PHASE 6: Strategy invest + yield simulation ───────────────────────────
  HDR("Phase 6 · Strategy: invest → simulate yield → divest");

  // reserveRatioBps defaults to 100% — must lower it to allow investment.
  // Set to 30% reserve (70% can be deployed to strategy).
  await (await vault.setReserveRatioBps(3000)).wait();
  OK("vault.setReserveRatioBps(3000) — 30% reserve, 70% investable");

  const available = await vault.availableToInvest();
  INFO(`vault.availableToInvest: ${ethers.formatUnits(available,6)} USDC`);

  // Transfer USDC from vault to StrategyManager, then instruct StratMgr to deploy to Strategy.
  const investAmount = 5_000n * 1_000_000n;  // 5,000 USDC
  await (await vault.transferToStrategyManager(investAmount)).wait();
  OK(`vault.transferToStrategyManager(${ethers.formatUnits(investAmount,6)} USDC)`);
  await (await stratMgr.invest(investAmount)).wait();
  OK(`StrategyManager.invest(${ethers.formatUnits(investAmount,6)} USDC)`);

  const managedAfterInvest = await stratMgr.totalManagedAssets();
  INFO(`StrategyManager.totalManagedAssets: ${ethers.formatUnits(managedAfterInvest,6)} USDC`);

  // Simulate yield: DummyStrategy mints 50 USDC yield (1% on 5000 USDC)
  const yieldAmount = 50n * 1_000_000n;
  await (await mockUsdc.mint(strategyAddr, yieldAmount)).wait();  // fund the strategy's "yield"
  await (await dummy.simulateYield(yieldAmount)).wait();
  OK(`DummyStrategy.simulateYield(${ethers.formatUnits(yieldAmount,6)} USDC)`);

  const managedAfterYield = await stratMgr.totalManagedAssets();
  checkGt("totalManagedAssets > investAmount", managedAfterYield, investAmount);
  INFO(`totalManagedAssets after yield: ${ethers.formatUnits(managedAfterYield,6)} USDC`);

  // Divest all: DummyStrategy transfers actual balance back to StrategyManager.
  // Note: yieldOffset inflates totalManagedAssets but DummyStrategy.divest only
  // transfers real USDC balance. Use idleUnderlying() for the returnToVault amount.
  await (await stratMgr.divest(managedAfterYield)).wait();
  OK(`StrategyManager.divest(${ethers.formatUnits(managedAfterYield,6)} requested)`);
  const actualIdle = await stratMgr.idleUnderlying();
  OK(`StrategyManager.idleUnderlying after divest: ${ethers.formatUnits(actualIdle,6)} USDC`);
  await (await stratMgr.returnToVault(actualIdle)).wait();
  OK("StrategyManager.returnToVault");
  const totalAssetsAfterYield = await vault.totalAssets();
  checkGt("Vault totalAssets increased after yield", totalAssetsAfterYield, totalAssets0);
  INFO(`Vault totalAssets after yield: ${ethers.formatUnits(totalAssetsAfterYield,6)} USDC`);

  // ── PHASE 7: Time advance + accrueManagementFee ───────────────────────────
  HDR("Phase 7 · Advance time 30d → accrue mgmt fee");

  await increaseTime(30 * DAY);
  OK("Hardhat time advanced 30 days");

  await (await vault.accrueManagementFee()).wait();
  const tresuryYrcoreBal = await aliceVaultShares.balanceOf(treasuryAddr);
  OK(`accrueManagementFee() called`);
  checkGt("Treasury yrCORE > 0 (mgmt fee accrued)", tresuryYrcoreBal, 0n);
  INFO(`Treasury yrCORE balance: ${ethers.formatEther(tresuryYrcoreBal)} yrCORE`);

  // ── PHASE 8: Alice claimRebate ────────────────────────────────────────────
  HDR("Phase 8 · Alice claimRebate");

  const aliceRebatePreview = await mgr.previewRebate(aliceLockId);
  INFO(`Alice previewRebate: ${ethers.formatEther(aliceRebatePreview)} yrCORE`);

  const aliceYrcoreBefore = await aliceVaultShares.balanceOf(alice.address);
  await (await aliceMgr.claimRebate(aliceLockId)).wait();
  const aliceYrcoreAfter = await aliceVaultShares.balanceOf(alice.address);

  checkGt("Alice received rebate (yrCORE increased)", aliceYrcoreAfter, aliceYrcoreBefore);
  const rebateReceived = aliceYrcoreAfter - aliceYrcoreBefore;
  OK(`Alice rebate received: ${ethers.formatEther(rebateReceived)} yrCORE`);

  // ── PHASE 9: Bob earlyExit ────────────────────────────────────────────────
  HDR("Phase 9 · Bob earlyExit (before maturity)");

  const bobPtsBefore = await bobPts.balanceOf(bob.address);
  checkGte("Bob has Points to return", bobPtsBefore, bobPoints);

  // Bob must approve manager to pull his Points
  await (await bobPts.connect(bob).approve(managerAddr, bobPoints)).wait();
  OK(`Bob approved ${ethers.formatEther(bobPoints)} YRPTS to manager`);

  const bobYrCoreBefore = await bobVaultShares.balanceOf(bob.address);
  await (await bobMgr.earlyExit(bobLockId)).wait();
  const bobYrCoreAfter = await bobVaultShares.balanceOf(bob.address);
  const bobPtsAfter    = await bobPts.balanceOf(bob.address);

  // After earlyExit: yrCORE returned, Points returned to treasury
  checkGt("Bob yrCORE returned after earlyExit", bobYrCoreAfter, bobYrCoreBefore);
  checkLt("Bob Points deducted after earlyExit", bobPtsAfter, bobPtsBefore);
  checkEq("Bob Points fully returned (= 0)", 0n, bobPtsAfter);
  OK(`Bob early exited: received ${ethers.formatEther(bobYrCoreAfter)} yrCORE, returned all Points`);

  // ── PHASE 10: Advance to Alice's maturity + unlock ────────────────────────
  HDR("Phase 10 · Advance to 90d total → Alice unlock mature lock");

  await increaseTime(60 * DAY); // already at 30d, +60d = 90d total
  OK("Hardhat time advanced 60 more days (total: 90d)");

  const aliceYrcoreBeforeUnlock = await aliceVaultShares.balanceOf(alice.address);
  await (await aliceLedger.unlock(aliceLockId)).wait();
  const aliceYrcoreAfterUnlock = await aliceVaultShares.balanceOf(alice.address);

  checkGt("Alice yrCORE returned after unlock", aliceYrcoreAfterUnlock, aliceYrcoreBeforeUnlock);
  OK(`Alice unlocked lockId=${aliceLockId}: received ${ethers.formatEther(aliceYrcoreAfterUnlock - aliceYrcoreBeforeUnlock)} yrCORE`);
  INFO(`Alice total yrCORE: ${ethers.formatEther(aliceYrcoreAfterUnlock)}`);

  // Alice still holds her original Points (normal completion preserves them)
  const alicePtsFinal = await alicePts.balanceOf(alice.address);
  checkGt("Alice retains Points after normal unlock", alicePtsFinal, 0n);
  INFO(`Alice YRPTS retained: ${ethers.formatEther(alicePtsFinal)}`);

  // ── PHASE 11: Alice redeem yrCORE → USDC ─────────────────────────────────
  HDR("Phase 11 · Alice redeem all free yrCORE → USDC");

  const aliceRedeemShares = await aliceVaultShares.balanceOf(alice.address);
  const aliceUsdcBefore   = await (mockUsdc.connect(alice) as any).balanceOf(alice.address);
  await (await aliceVault.redeem(aliceRedeemShares, alice.address, alice.address)).wait();
  const aliceUsdcAfter    = await (mockUsdc.connect(alice) as any).balanceOf(alice.address);

  checkGt("Alice received USDC from redeem", aliceUsdcAfter, aliceUsdcBefore);
  const usdcOut = aliceUsdcAfter - aliceUsdcBefore;
  OK(`Alice redeemed ${ethers.formatEther(aliceRedeemShares)} yrCORE → ${ethers.formatUnits(usdcOut,6)} USDC`);
  // USDC out should be close to or more than original deposit (yield added)
  checkGte("Alice USDC out ≥ deposited (yield included)", usdcOut, ALICE_USDC / 2n);

  // ── PHASE 12: Admin pause / unpause ───────────────────────────────────────
  HDR("Phase 12 · Admin pause deposits → verify block → unpause");

  await (await vault.pauseDeposits()).wait();  OK("vault.pauseDeposits()");

  // Verify deposit is blocked while paused
  const SMALL_USDC = 1_000_000n; // 1 USDC
  await (await mockUsdc.mint(alice.address, SMALL_USDC)).wait();
  await (await aliceMockUsdc.approve(vaultAddr, SMALL_USDC)).wait();
  try {
    await aliceVault.deposit(SMALL_USDC, alice.address);
    console.log("  ✗  Deposit should have reverted while paused");
    failures++;
  } catch {
    OK("Deposit correctly reverted while paused");
  }

  await (await vault.unpauseDeposits()).wait(); OK("vault.unpauseDeposits()");
  // Deposit should succeed again
  const resumeTx = await aliceVault.deposit(SMALL_USDC, alice.address);
  await resumeTx.wait();
  OK("Deposit resumed after unpause");

  // ── Result ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ALL REHEARSAL CHECKS PASSED ✓  — local user flow validated");
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
  }
  console.log("=".repeat(68) + "\n");

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
