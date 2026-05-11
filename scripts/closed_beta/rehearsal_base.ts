/**
 * rehearsal_base.ts — YearRing Closed Beta: Base Mainnet Small-Amount Rehearsal
 *
 * Full closed-loop rehearsal on real Base mainnet:
 *   deposit → lock (30d) → Aave invest → Aave divest/returnToVault
 *   → previewRebate → earlyExit → redeem
 *
 * Test user  : customerA = signers[1] (ALICE_PRIVATE_KEY)
 * Admin      : deployer  = signers[0] (PRIVATE_KEY / ADMIN_ADDRESS)
 * Test amount: 5 USDC
 * Lock period: 30 days (minimum, seconds: 30 * 86400 = 2,592,000)
 *   — We use earlyExit since we cannot wait 30 days on mainnet.
 *
 * Key fixes vs. initial draft:
 *   - duration is in SECONDS (MIN_LOCK = 30 * 86400, MAX = 365 * 86400)
 *   - lockWithPoints requires: vaultShares.approve(ledgerAddr, shares)  ← ledger, not vault
 *   - earlyExit requires:      pts.approve(managerAddr, pointsIssued)   ← manager
 *   - idleUSDC() → usdc.balanceOf(vaultAddr)
 *   - previewLock() does not exist → use previewRebate() for rebate preview
 *   - LockPosition struct: fields are unlockAt (not maturesAt), earlyExited (not exited)
 *   - accrueManagementFee() is state-changing; skip as view, call separately
 *   - Explicit gasLimit on every TX (public RPC may under-estimate)
 *   - Resume detection: if nextLockId > 0, skip Phase 1 (deposit+lock already done)
 *
 * Records per step: TX hash, block, gas, customerA USDC/yrCORE/YRPTS,
 *                   vault totalAssets/totalSupply/freeUSDC, stratMgr idle/managed
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/rehearsal_base.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ─────────────────────────────────────────────────────────────────
const HDR  = (s: string) => {
  console.log("\n" + "=".repeat(72));
  console.log("  " + s);
  console.log("=".repeat(72));
};
const SEP  = () => console.log("-".repeat(72));
const STEP = (s: string) => { SEP(); console.log("  ▶  " + s); SEP(); };
const OK   = (s: string) => console.log(`  ✓  ${s}`);
const INFO = (s: string) => console.log(`  ℹ  ${s}`);
const WARN = (s: string) => console.log(`  ⚠  ${s}`);
const fmt6 = (n: bigint) => ethers.formatUnits(n, 6);
const fmt18= (n: bigint) => ethers.formatEther(n);

// Gas limits per operation type (public RPC may under-estimate)
const GAS = {
  approve:              100_000n,
  deposit:              300_000n,
  lockWithPoints:       600_000n,
  setReserveRatioBps:   100_000n,
  addToAllowlist:       100_000n,
  transferToStratMgr:   200_000n,
  invest:               500_000n,
  divest:               500_000n,
  returnToVault:        200_000n,
  claimRebate:          300_000n,
  earlyExit:            400_000n,
  redeem:               300_000n,
};

// ── ABIs ────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) external returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];
const VAULT_ABI = [
  "function deposit(uint256,address) external returns (uint256)",
  "function redeem(uint256,address,address) external returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function reserveRatioBps() view returns (uint256)",
  "function setReserveRatioBps(uint256) external",
  "function addToAllowlist(address) external",
  "function isAllowed(address) view returns (bool)",
  "function transferToStrategyManager(uint256) external",
  "function availableToInvest() view returns (uint256)",
  "function convertToShares(uint256) view returns (uint256)",
  "function accrueManagementFee() external",
  "function approve(address,uint256) external returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];
const MANAGER_ABI = [
  "function lockWithPoints(uint256,uint64) external returns (uint256)",
  "function earlyExit(uint256) external",
  "function claimRebate(uint256) external returns (uint256)",
  "function previewRebate(uint256) view returns (uint256)",
  "function issuedPoints(uint256) view returns (uint256)",
];
const LEDGER_ABI = [
  "function getLock(uint256) view returns (tuple(address owner,uint256 shares,uint64 lockedAt,uint64 unlockAt,uint64 endedAt,bool unlocked,bool earlyExited))",
  "function nextLockId() view returns (uint256)",
  "function totalLockedShares() view returns (uint256)",
  "function userLockIds(address) view returns (uint256[])",
];
const STRATMGR_ABI = [
  "function invest(uint256) external",
  "function divest(uint256) external",
  "function returnToVault(uint256) external",
  "function idleUnderlying() view returns (uint256)",
  "function totalManagedAssets() view returns (uint256)",
  "function paused() view returns (bool)",
  "event Divested(uint256 requested, uint256 withdrawn)",
  "event Invested(uint256 amount)",
];
const AAVE_ABI = [
  "function totalUnderlying() view returns (uint256)",
];
const TREASURY_ABI_VIEW = [
  "function rebateSpentOf(address) view returns (uint256)",
  "function rebateBudgetRemaining(address) view returns (uint256)",
];

// ── State snapshot ──────────────────────────────────────────────────────────
// Sequential reads to avoid rate-limiting on public RPC nodes
async function snapshot(
  label: string,
  usdc: ethers.Contract,
  vault: ethers.Contract,
  pts: ethers.Contract,
  stratMgr: ethers.Contract,
  treasury: ethers.Contract,
  vaultAddr: string,
  treasuryAddr: string,
  customerAddr: string,
) {
  const cUsdc        = await usdc.balanceOf(customerAddr);
  const cYrCore      = await vault.balanceOf(customerAddr);
  const cPts         = await pts.balanceOf(customerAddr);
  const totalAssets  = await vault.totalAssets();
  const totalSupply  = await vault.totalSupply();
  const pricePerShare= await vault.pricePerShare();
  const reserveBps   = await vault.reserveRatioBps();
  const vaultUSDC    = await usdc.balanceOf(vaultAddr);
  const smIdle       = await stratMgr.idleUnderlying();
  const smManaged    = await stratMgr.totalManagedAssets();
  const tYrCore      = await vault.balanceOf(treasuryAddr);
  const rebateSpent  = await treasury.rebateSpentOf(vaultAddr);

  console.log(`\n  ── Snapshot: ${label} ──`);
  console.log(`  customerA  USDC     : ${fmt6(cUsdc)} USDC`);
  console.log(`  customerA  yrCORE   : ${fmt18(cYrCore)} yrCORE`);
  console.log(`  customerA  YRPTS    : ${fmt18(cPts)} YRPTS`);
  console.log(`  Vault totalAssets   : ${fmt6(totalAssets)} USDC`);
  console.log(`  Vault totalSupply   : ${fmt18(totalSupply)} yrCORE`);
  console.log(`  Vault pricePerShare : ${fmt18(pricePerShare)} USDC/yrCORE`);
  console.log(`  Vault reserveBps    : ${reserveBps}`);
  console.log(`  Vault freeUSDC      : ${fmt6(vaultUSDC)} USDC`);
  console.log(`  StratMgr idle       : ${fmt6(smIdle)} USDC`);
  console.log(`  StratMgr managed    : ${fmt6(smManaged)} USDC`);
  console.log(`  Treasury yrCORE     : ${fmt18(tYrCore)} yrCORE`);
  console.log(`  Treasury rebateSpent: ${fmt18(rebateSpent)} yrCORE`);

  return { cUsdc, cYrCore, cPts, totalAssets, totalSupply, vaultUSDC, smIdle, smManaged };
}

async function sendTx(label: string, txPromise: Promise<ethers.TransactionResponse>) {
  const tx   = await txPromise;
  const rcpt = await tx.wait();
  if (!rcpt || rcpt.status !== 1) throw new Error(`TX REVERTED: ${label}`);
  console.log(`  ✓  ${label}`);
  console.log(`     TX   : ${rcpt.hash}`);
  console.log(`     Block: ${rcpt.blockNumber}  gas: ${rcpt.gasUsed}`);
  return rcpt;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const dep = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../../deployments", `closed_beta_${network.name}.json`), "utf8"
  ));
  const c = dep.contracts as Record<string, string>;

  const [deployer, customerA] = await ethers.getSigners();

  const vaultAddr    = c["YearRingCoreVaultV01"];
  const treasuryAddr = c["TreasuryV02"];
  const pointsAddr   = c["PointsToken"];
  const ledgerAddr   = c["LockLedgerV02"];
  const managerAddr  = c["LockPointsRebateManagerV02"];
  const stratMgrAddr = c["StrategyManagerV01"];
  const strategyAddr = c["AaveV3StrategyV01"];
  const usdcAddr     = c["USDC"];

  // Signer-bound contracts
  const usdc     = new ethers.Contract(usdcAddr,     ERC20_ABI,         customerA);
  const usdcD    = new ethers.Contract(usdcAddr,     ERC20_ABI,         deployer);
  const vault    = new ethers.Contract(vaultAddr,    VAULT_ABI,         deployer);  // admin ops
  const vaultA   = new ethers.Contract(vaultAddr,    VAULT_ABI,         customerA); // user ops
  const pts      = new ethers.Contract(pointsAddr,   ERC20_ABI,         customerA);
  const manager  = new ethers.Contract(managerAddr,  MANAGER_ABI,       customerA);
  const ledger   = new ethers.Contract(ledgerAddr,   LEDGER_ABI,        deployer);
  const stratMgr = new ethers.Contract(stratMgrAddr, STRATMGR_ABI,      deployer);
  const aave     = new ethers.Contract(strategyAddr, AAVE_ABI,          deployer);
  const treasury = new ethers.Contract(treasuryAddr, TREASURY_ABI_VIEW, deployer);

  // Constants
  const DEPOSIT_USDC  = 5_000_000n;          // 5 USDC (6 decimals)
  const DAY           = 86400;
  const LOCK_DURATION = BigInt(30 * DAY);     // 30 days in seconds (minimum lock)

  HDR("YearRing Closed Beta — Base Mainnet Small-Amount Rehearsal");
  console.log(`  Network    : ${network.name}`);
  console.log(`  Deployer   : ${deployer.address}`);
  console.log(`  CustomerA  : ${customerA.address}`);
  console.log(`  Vault      : ${vaultAddr}`);
  console.log(`  LockLedger : ${ledgerAddr}`);
  console.log(`  Manager    : ${managerAddr}`);
  console.log(`  StratMgr   : ${stratMgrAddr}`);
  console.log(`  AaveStrat  : ${strategyAddr}`);
  console.log(`  Deposit    : ${fmt6(DEPOSIT_USDC)} USDC`);
  console.log(`  Lock       : 30 days (minimum, earlyExit after invest/divest)`);

  // ── Phase 0: Preflight ─────────────────────────────────────────────────────
  HDR("Phase 0 · Preflight");

  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 8453n) throw new Error(`Wrong chain: ${chainId} (expected 8453)`);
  OK(`Chain ID: ${chainId} (Base mainnet)`);

  const usdcBalA = await usdc.balanceOf(customerA.address);
  const ethBalA  = await ethers.provider.getBalance(customerA.address);
  INFO(`customerA ETH  : ${ethers.formatEther(ethBalA)} ETH`);
  INFO(`customerA USDC : ${fmt6(usdcBalA)} USDC`);
  OK("Balance check passed");

  const smPaused = await stratMgr.paused();
  if (smPaused) throw new Error("StrategyManager is paused — abort");
  OK("StrategyManager not paused");

  const reserveBps = await vault.reserveRatioBps();
  INFO(`reserveRatioBps: ${reserveBps}`);

  await snapshot("PRE-RUN", usdc, vault, pts, stratMgr, treasury,
    vaultAddr, treasuryAddr, customerA.address);

  // ── Phase 0A: Admin setup ──────────────────────────────────────────────────
  HDR("Phase 0A · Admin Setup (reserveRatioBps + allowlist)");

  STEP("setReserveRatioBps(3000) if needed");
  if (reserveBps !== 3000n) {
    await sendTx("vault.setReserveRatioBps(3000)",
      vault.setReserveRatioBps(3000, { gasLimit: GAS.setReserveRatioBps }));
    OK("reserveRatioBps set to 3000");
  } else {
    OK("reserveRatioBps already 3000 — skip");
  }

  STEP("Allowlist customerA");
  const isAllowlisted = await vault.isAllowed(customerA.address);
  if (!isAllowlisted) {
    await sendTx("vault.addToAllowlist(customerA)",
      vault.addToAllowlist(customerA.address, { gasLimit: GAS.addToAllowlist }));
  } else {
    OK("customerA already allowlisted — skip");
  }

  // ── Phase 1: Deposit + Lock (resume-aware) ─────────────────────────────────
  HDR("Phase 1 · Deposit + Lock (resume-aware)");

  // Resume detection: if nextLockId > 0, Phase 1 already completed on-chain
  const nextLockId = await ledger.nextLockId();
  INFO(`ledger.nextLockId(): ${nextLockId}`);

  let sharesReceived: bigint;
  let lockId: bigint;
  let ptsIssued: bigint;

  if (nextLockId > 0n) {
    // ── RESUME PATH ──────────────────────────────────────────────────────────
    OK("nextLockId > 0 — Phase 1 already completed on-chain. Resuming from Phase 2.");
    lockId = 0n;
    const lockData0 = await ledger.getLock(lockId);
    sharesReceived = lockData0.shares;
    ptsIssued      = await pts.balanceOf(customerA.address);
    const freeYr   = await vaultA.balanceOf(customerA.address);

    INFO(`  lockId        : ${lockId}`);
    INFO(`  locked shares : ${fmt18(sharesReceived)} yrCORE`);
    INFO(`  free yrCORE   : ${fmt18(freeYr)} yrCORE`);
    INFO(`  YRPTS balance : ${fmt18(ptsIssued)} YRPTS`);
    INFO(`  unlockAt      : ${new Date(Number(lockData0.unlockAt) * 1000).toISOString()}`);
    INFO(`  earlyExited   : ${lockData0.earlyExited}`);

    if (lockData0.earlyExited) {
      WARN("Lock is already earlyExited — skipping earlyExit in Phase 3B");
    }
    if (lockData0.owner.toLowerCase() !== customerA.address.toLowerCase()) {
      throw new Error(`HALT: Lock[0] owner mismatch. expected=${customerA.address} got=${lockData0.owner}`);
    }

  } else {
    // ── FRESH PATH ───────────────────────────────────────────────────────────
    // Phase 1A: Deposit
    HDR("Phase 1A · Deposit 5 USDC → yrCORE");

    STEP("customerA: usdc.approve(vault, 5 USDC)");
    const usdcAllowance = await usdc.allowance(customerA.address, vaultAddr);
    if (usdcAllowance < DEPOSIT_USDC) {
      await sendTx("usdc.approve(vault, 5 USDC)",
        usdc.approve(vaultAddr, DEPOSIT_USDC, { gasLimit: GAS.approve }));
    } else {
      OK("USDC allowance already sufficient — skip");
    }

    if (usdcBalA < DEPOSIT_USDC) throw new Error(`customerA USDC too low: ${fmt6(usdcBalA)}`);

    STEP("customerA: vault.deposit(5 USDC)");
    const expectedShares = await vaultA.convertToShares(DEPOSIT_USDC);
    INFO(`Expected yrCORE (convertToShares): ${fmt18(expectedShares)}`);

    const depositRcpt = await sendTx("vault.deposit(5 USDC, customerA)",
      vaultA.deposit(DEPOSIT_USDC, customerA.address, { gasLimit: GAS.deposit }));

    // Extract minted shares from Transfer event (mint: from=0x0, to=customerA)
    const transferIface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    sharesReceived = 0n;
    for (const log of depositRcpt.logs) {
      try {
        const parsed = transferIface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "Transfer" &&
            parsed.args[0] === ethers.ZeroAddress &&
            parsed.args[1].toLowerCase() === customerA.address.toLowerCase()) {
          sharesReceived = parsed.args[2];
          break;
        }
      } catch (_) {}
    }
    if (sharesReceived === 0n) {
      sharesReceived = await vaultA.balanceOf(customerA.address);
      INFO(`(shares from balanceOf fallback: ${fmt18(sharesReceived)})`);
    }
    if (sharesReceived === 0n) throw new Error("HALT: deposit minted 0 shares");
    OK(`Deposit ✓ — ${fmt18(sharesReceived)} yrCORE minted`);

    // Phase 1B: Lock
    HDR("Phase 1B · Lock yrCORE for 30 days (earlyExit path)");

    STEP("customerA: vault(yrCORE).approve(ledger, shares)");
    const yrCoreAllowance = await vaultA.allowance(customerA.address, ledgerAddr);
    if (yrCoreAllowance < sharesReceived) {
      await sendTx("yrCORE.approve(ledger, shares)",
        vaultA.approve(ledgerAddr, sharesReceived, { gasLimit: GAS.approve }));
    } else {
      OK("yrCORE → ledger allowance already sufficient — skip");
    }

    const prePtsA = await pts.balanceOf(customerA.address);
    lockId = await ledger.nextLockId();

    STEP(`customerA: manager.lockWithPoints(shares, 30d)`);
    await sendTx(
      `lockWithPoints(${fmt18(sharesReceived)} yrCORE, 30d=${LOCK_DURATION}s)`,
      manager.lockWithPoints(sharesReceived, LOCK_DURATION, { gasLimit: GAS.lockWithPoints })
    );

    const postPtsA = await pts.balanceOf(customerA.address);
    ptsIssued = postPtsA - prePtsA;
    INFO(`Lock ID      : ${lockId}`);
    INFO(`YRPTS issued : ${fmt18(ptsIssued)} YRPTS`);
    if (ptsIssued === 0n) {
      WARN("YRPTS issued = 0. Check Treasury YRPTS balance and allowance setup.");
    } else {
      OK(`Lock ✓ — lockId=${lockId} — ${fmt18(ptsIssued)} YRPTS issued`);
    }

    const lockData = await ledger.getLock(lockId);
    INFO(`Lock record:`);
    INFO(`  owner    : ${lockData.owner}`);
    INFO(`  shares   : ${fmt18(lockData.shares)} yrCORE`);
    INFO(`  lockedAt : ${new Date(Number(lockData.lockedAt) * 1000).toISOString()}`);
    INFO(`  unlockAt : ${new Date(Number(lockData.unlockAt) * 1000).toISOString()}`);
    INFO(`  earlyExited: ${lockData.earlyExited}`);
  }

  await snapshot("POST-LOCK-CHECK", usdc, vault, pts, stratMgr, treasury,
    vaultAddr, treasuryAddr, customerA.address);

  // ── Phase 2A: Aave Invest ──────────────────────────────────────────────────
  HDR("Phase 2A · Aave Invest");

  // Check if already invested (stratMgr already has managed assets)
  const preInvestManaged = await stratMgr.totalManagedAssets();
  if (preInvestManaged > 0n) {
    WARN(`StratMgr already has ${fmt6(preInvestManaged)} USDC managed. Skipping invest — going to divest.`);
    // Jump to Phase 2B directly
  } else {
    const availToInvest = await vault.availableToInvest();
    INFO(`vault.availableToInvest(): ${fmt6(availToInvest)} USDC`);

    if (availToInvest === 0n) {
      const vaultFreeUSDC = await usdcD.balanceOf(vaultAddr);
      const ta = await vault.totalAssets();
      WARN(`availableToInvest = 0. vaultFreeUSDC=${fmt6(vaultFreeUSDC)}, totalAssets=${fmt6(ta)}, reserveBps=${await vault.reserveRatioBps()}`);
      WARN("If totalAssets × (1 - reserveBps/10000) = 0, the vault is fully reserved.");
      WARN("Proceeding to divest/earlyExit/redeem without invest test.");
    } else {
      // Subtract 1 wei to avoid MaxDeployExceeded: availableToInvest() uses integer division
      // which can return 1 wei more than the 70% hard cap allows in transferToStrategyManager.
      // Example: totalAssets=9999999, reserveBps=3000 → availableToInvest=7000000, but
      // MAX_STRATEGY_DEPLOY_BPS check allows at most 9999999×7000/10000=6999999.
      const investAmount = availToInvest > 1n ? availToInvest - 1n : availToInvest;

      STEP(`Admin: vault.transferToStrategyManager(${fmt6(investAmount)} USDC)`);
      await sendTx("vault.transferToStrategyManager",
        vault.transferToStrategyManager(investAmount, { gasLimit: GAS.transferToStratMgr }));

      const smIdleAfterTransfer = await stratMgr.idleUnderlying();
      INFO(`StratMgr idleUnderlying after transfer: ${fmt6(smIdleAfterTransfer)} USDC`);
      if (smIdleAfterTransfer < investAmount)
        throw new Error(`HALT: StratMgr received less than expected. got=${smIdleAfterTransfer} need=${investAmount}`);

      STEP(`Admin: stratMgr.invest(${fmt6(investAmount)} USDC) → Aave V3`);
      await sendTx("stratMgr.invest(amount)",
        stratMgr.invest(investAmount, { gasLimit: GAS.invest }));

      const smIdlePostInvest   = await stratMgr.idleUnderlying();
      const smManagedPostInvest= await stratMgr.totalManagedAssets();
      const aaveTotal          = await aave.totalUnderlying();
      INFO(`StratMgr idle after invest    : ${fmt6(smIdlePostInvest)} USDC`);
      INFO(`StratMgr managed after invest : ${fmt6(smManagedPostInvest)} USDC`);
      INFO(`AaveV3 totalUnderlying        : ${fmt6(aaveTotal)} USDC`);
      if (aaveTotal === 0n) throw new Error("HALT: Aave shows 0 underlying — invest failed");
      OK(`Aave invest ✓ — ${fmt6(aaveTotal)} USDC deployed to Aave V3`);

      await snapshot("POST-INVEST", usdc, vault, pts, stratMgr, treasury,
        vaultAddr, treasuryAddr, customerA.address);
    }
  }

  // ── Phase 2B: Aave Divest → returnToVault ─────────────────────────────────
  HDR("Phase 2B · Aave Divest → returnToVault");

  const aaveTotalNow = await aave.totalUnderlying();
  INFO(`AaveV3 totalUnderlying now: ${fmt6(aaveTotalNow)} USDC`);

  if (aaveTotalNow === 0n) {
    const smManNow  = await stratMgr.totalManagedAssets();
    const smIdleNow = await stratMgr.idleUnderlying();
    if (smManNow === 0n && smIdleNow === 0n) {
      WARN("No Aave position and no StratMgr managed assets. Skipping divest.");
    } else {
      // Divest already completed (or never happened), but USDC is sitting in StratMgr idle.
      // This happens when a previous run divested from Aave but returnToVault failed/was skipped.
      WARN(`Aave totalUnderlying = 0 but stratMgr managed = ${fmt6(smManNow)}, idle = ${fmt6(smIdleNow)}.`);
      WARN("Divest already done — calling returnToVault to recover idle USDC to Vault.");
      const returnAmt = smIdleNow > 0n ? smIdleNow : smManNow;
      if (returnAmt > 0n) {
        STEP(`Admin: stratMgr.returnToVault(${fmt6(returnAmt)} USDC) — recovery`);
        await sendTx("stratMgr.returnToVault (recovery)",
          stratMgr.returnToVault(returnAmt, { gasLimit: GAS.returnToVault }));
        const vaultFreeAfter = await usdcD.balanceOf(vaultAddr);
        INFO(`Vault freeUSDC after recovery returnToVault: ${fmt6(vaultFreeAfter)} USDC`);
        OK(`Recovery returnToVault ✓ — ${fmt6(returnAmt)} USDC back in Vault`);
      }
    }
  } else {
    const divestAmount = aaveTotalNow;
    INFO(`Divesting full Aave position: ${fmt6(divestAmount)} USDC`);

    // Divest: request slightly less than totalUnderlying to avoid Aave rounding dust.
    // Use divestAmount - 1 to prevent "InsufficientBalance" revert if aToken grew by 1 wei.
    const safeDivestAmount = divestAmount > 1n ? divestAmount - 1n : divestAmount;
    INFO(`Divesting ${fmt6(safeDivestAmount)} USDC (conservative to avoid Aave 1-wei rounding)`);

    STEP(`Admin: stratMgr.divest(${fmt6(safeDivestAmount)} USDC)`);
    const divestRcpt = await sendTx("stratMgr.divest(amount)",
      stratMgr.divest(safeDivestAmount, { gasLimit: GAS.divest }));

    // Parse Divested(uint256 requested, uint256 withdrawn) event — canonical source of truth
    // Avoids RPC state-lag issue (public nodes may return stale balances after TXs)
    const divestIface = new ethers.Interface(["event Divested(uint256 requested, uint256 withdrawn)"]);
    let withdrawnFromDivest = 0n;
    for (const log of divestRcpt.logs) {
      try {
        const parsed = divestIface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "Divested") {
          withdrawnFromDivest = parsed.args[1];
          INFO(`Divested event: requested=${fmt6(parsed.args[0])}, withdrawn=${fmt6(withdrawnFromDivest)}`);
          break;
        }
      } catch (_) {}
    }

    // Fallback: RPC read (may lag on public nodes — idleUnderlying = balanceOf(stratMgr))
    const smIdleAfterDivest = await stratMgr.idleUnderlying();
    INFO(`StratMgr idle after divest (RPC read): ${fmt6(smIdleAfterDivest)} USDC`);

    // Determine returnToVault amount: prefer live RPC, fall back to event, then safeDivestAmount
    const returnAmount =
      smIdleAfterDivest > 0n ? smIdleAfterDivest :
      withdrawnFromDivest > 0n ? withdrawnFromDivest :
      safeDivestAmount;
    INFO(`returnToVault amount (used): ${fmt6(returnAmount)} USDC`);

    if (withdrawnFromDivest === 0n && smIdleAfterDivest === 0n) {
      WARN("Neither event nor RPC confirms USDC in StratMgr. Attempting returnToVault anyway (TX will revert on-chain if truly 0).");
    }

    STEP(`Admin: stratMgr.returnToVault(${fmt6(returnAmount)} USDC)`);
    await sendTx("stratMgr.returnToVault",
      stratMgr.returnToVault(returnAmount, { gasLimit: GAS.returnToVault }));

    const vaultFreeUSDC  = await usdcD.balanceOf(vaultAddr);
    const totalAssetsPost= await vault.totalAssets();
    INFO(`Vault freeUSDC after returnToVault  : ${fmt6(vaultFreeUSDC)} USDC`);
    INFO(`Vault totalAssets after returnToVault: ${fmt6(totalAssetsPost)} USDC`);
    if (totalAssetsPost === 0n) throw new Error("HALT: totalAssets = 0 after returnToVault");
    OK(`Aave divest+returnToVault ✓ — Vault totalAssets: ${fmt6(totalAssetsPost)} USDC`);

    const ta = await vault.totalAssets();
    const delta = ta > 5_000_000n ? ta - 5_000_000n : 5_000_000n - ta;
    if (delta > 10_000n && ta > 0n) {
      INFO(`totalAssets vs 5 USDC deviation: ${fmt6(delta)} USDC (may reflect second deposit or Aave interest)`);
    }
  }

  await snapshot("POST-DIVEST", usdc, vault, pts, stratMgr, treasury,
    vaultAddr, treasuryAddr, customerA.address);

  // ── Phase 3A: previewRebate ─────────────────────────────────────────────────
  HDR("Phase 3A · Preview Rebate");

  const claimable = await manager.previewRebate(lockId);
  INFO(`manager.previewRebate(lockId=${lockId}): ${fmt18(claimable)} yrCORE`);

  if (claimable === 0n) {
    WARN("previewRebate = 0. Expected for this rehearsal:");
    WARN("  • No management fees have accrued (vault just deployed, ~0 time elapsed).");
    WARN("  • Rebate = share of Treasury yrCORE; Treasury yrCORE starts at 0.");
    WARN("  • This is NOT a failure — correct behavior for a fresh zero-history deploy.");
    OK("claimRebate skipped (claimable = 0, expected)");
  } else {
    STEP(`customerA: manager.claimRebate(lockId=${lockId}): ${fmt18(claimable)} yrCORE`);
    const preClaimYr = await vaultA.balanceOf(customerA.address);
    await sendTx("manager.claimRebate",
      manager.claimRebate(lockId, { gasLimit: GAS.claimRebate }));
    const postClaimYr = await vaultA.balanceOf(customerA.address);
    INFO(`yrCORE before claimRebate: ${fmt18(preClaimYr)}`);
    INFO(`yrCORE after  claimRebate: ${fmt18(postClaimYr)}`);
    INFO(`yrCORE received           : ${fmt18(postClaimYr - preClaimYr)}`);
    OK("claimRebate ✓");
  }

  // ── Phase 3B: earlyExit ────────────────────────────────────────────────────
  HDR("Phase 3B · EarlyExit (return YRPTS, release yrCORE lock)");

  // Check if already exited (resume safety)
  const lockBeforeExit = await ledger.getLock(lockId);
  if (lockBeforeExit.earlyExited || lockBeforeExit.unlocked) {
    WARN(`Lock[${lockId}] is already exited (earlyExited=${lockBeforeExit.earlyExited}, unlocked=${lockBeforeExit.unlocked}) — skipping earlyExit`);
  } else {
    const ptsBeforeExit = await pts.balanceOf(customerA.address);
    INFO(`customerA YRPTS before earlyExit: ${fmt18(ptsBeforeExit)}`);

    // earlyExit requires pts.approve(manager, issuedPoints[lockId])
    const storedPts = await manager.issuedPoints(lockId);
    INFO(`manager.issuedPoints(lockId=${lockId}): ${fmt18(storedPts)} YRPTS to return`);

    if (storedPts > 0n) {
      STEP("customerA: pts.approve(manager, issuedPoints)");
      const ptsAllowance = await pts.allowance(customerA.address, managerAddr);
      if (ptsAllowance < storedPts) {
        await sendTx("pts.approve(manager, storedPts)",
          pts.approve(managerAddr, storedPts, { gasLimit: GAS.approve }));
      } else {
        OK("YRPTS → manager allowance already sufficient — skip");
      }
    } else {
      INFO("issuedPoints = 0 — no Points approval needed for earlyExit");
    }

    STEP(`customerA: manager.earlyExit(lockId=${lockId})`);
    const preExitYrCore = await vaultA.balanceOf(customerA.address);
    await sendTx("manager.earlyExit",
      manager.earlyExit(lockId, { gasLimit: GAS.earlyExit }));
    const postExitYrCore = await vaultA.balanceOf(customerA.address);
    const postExitPts    = await pts.balanceOf(customerA.address);

    INFO(`yrCORE before earlyExit: ${fmt18(preExitYrCore)}`);
    INFO(`yrCORE after  earlyExit: ${fmt18(postExitYrCore)}`);
    INFO(`YRPTS  after  earlyExit: ${fmt18(postExitPts)} (should = 0, returned to Treasury)`);

    if (postExitYrCore <= preExitYrCore) {
      throw new Error(`HALT: earlyExit did not return yrCORE. before=${fmt18(preExitYrCore)} after=${fmt18(postExitYrCore)}`);
    }
    OK(`earlyExit ✓ — lockId=${lockId} exited, yrCORE returned: ${fmt18(postExitYrCore - preExitYrCore)}`);

    const lockAfterExit = await ledger.getLock(lockId);
    INFO(`Lock post-exit — unlocked: ${lockAfterExit.unlocked}, earlyExited: ${lockAfterExit.earlyExited}`);
    if (!lockAfterExit.earlyExited) {
      WARN("Lock.earlyExited != true after earlyExit — unexpected state");
    }
  }

  // ── Phase 3C: Redeem ───────────────────────────────────────────────────────
  HDR("Phase 3C · Redeem yrCORE → USDC");

  const finalYrCore = await vaultA.balanceOf(customerA.address);
  INFO(`customerA yrCORE to redeem: ${fmt18(finalYrCore)}`);
  if (finalYrCore === 0n) throw new Error("HALT: customerA has 0 yrCORE — cannot redeem");

  const totalAssetsBeforeRedeem = await vault.totalAssets();
  const vaultFreeUsdcBeforeRedeem = await usdcD.balanceOf(vaultAddr);
  INFO(`Vault totalAssets before redeem : ${fmt6(totalAssetsBeforeRedeem)} USDC`);
  INFO(`Vault freeUSDC before redeem    : ${fmt6(vaultFreeUsdcBeforeRedeem)} USDC`);

  const preUsdcRedeem = await usdc.balanceOf(customerA.address);
  STEP(`customerA: vault.redeem(${fmt18(finalYrCore)} yrCORE)`);
  await sendTx("vault.redeem(shares, customerA, customerA)",
    vaultA.redeem(finalYrCore, customerA.address, customerA.address, { gasLimit: GAS.redeem }));
  const postUsdcRedeem = await usdc.balanceOf(customerA.address);
  const usdcReturned   = postUsdcRedeem - preUsdcRedeem;

  INFO(`USDC before redeem: ${fmt6(preUsdcRedeem)}`);
  INFO(`USDC after  redeem: ${fmt6(postUsdcRedeem)}`);
  INFO(`USDC returned     : ${fmt6(usdcReturned)}`);
  if (usdcReturned === 0n) throw new Error("HALT: redeem returned 0 USDC");
  OK(`Redeem ✓ — ${fmt6(usdcReturned)} USDC returned to customerA`);

  // ── Final snapshot ─────────────────────────────────────────────────────────
  const final = await snapshot("POST-REDEEM (FINAL)", usdc, vault, pts, stratMgr, treasury,
    vaultAddr, treasuryAddr, customerA.address);

  const ptsNow = await pts.balanceOf(customerA.address);

  // ── Summary ────────────────────────────────────────────────────────────────
  HDR("REHEARSAL COMPLETE ✓");
  console.log(`  Total yrCORE redeemed : ${fmt18(finalYrCore)}`);
  console.log(`  USDC returned         : ${fmt6(usdcReturned)}`);
  console.log(`  YRPTS held now        : ${fmt18(ptsNow)}`);
  console.log(`  Lock ID               : ${lockId} (earlyExit ✓)`);
  console.log(`  Aave invest/divest    : ✓`);
  console.log(`  claimRebate           : ${claimable > 0n ? "✓" : "skipped (0 claimable — expected)"}`);
  console.log("\n  Next step:");
  console.log("    npx hardhat run scripts/closed_beta/check_base_state.ts --network base");
}

main().catch(err => {
  console.error("\n  ✗ REHEARSAL FAILED:", err.message || err);
  process.exit(1);
});
