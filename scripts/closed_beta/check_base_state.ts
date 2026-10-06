/**
 * check_base_state.ts — YearRing Closed Beta: Post-Deployment On-Chain State Check
 *
 * Reads the deployment record and verifies live on-chain state after Base rehearsal.
 * Run this AFTER performing manual rehearsal steps on Base mainnet.
 *
 * Checks:
 *   A. All contract bindings (same as verify_deployment.ts)
 *   B. Vault operational state (deposits/redeems enabled, price-per-share)
 *   C. Treasury state (yrCORE balance, YRPTS balance, rebate budget, allowances)
 *   D. StrategyManager state (strategy binding, idle/managed assets)
 *   E. Lock state (active locks, total locked shares, user lock counts)
 *   F. Points state (treasury YRPTS remaining, issued across locks)
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/check_base_state.ts --network base
 *
 * Output: human-readable state snapshot for the deployment record.
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEP  = () => console.log("-".repeat(68));
const HDR  = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK   = (msg: string) => console.log(`  ✓  ${msg}`);
const INFO = (msg: string) => console.log(`  ℹ  ${msg}`);
const WARN = (msg: string) => console.log(`  ⚠  ${msg}`);

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
function checkTrue(label: string, val: boolean) {
  if (val) { OK(label); } else { console.log(`  ✗  ${label} (expected true)`); failures++; }
}

async function main() {
  const deploymentsPath = path.join(
    __dirname, "../../deployments", `closed_beta_${network.name}.json`
  );

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `Deployment record not found: ${deploymentsPath}\n` +
      `Run deploy_core_beta.ts → setup_roles.ts → verify_deployment.ts first.`
    );
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts as Record<string, string>;

  function addr(key: string): string {
    const a = c[key];
    if (!a) throw new Error(`Missing address for key: ${key}`);
    return a;
  }

  const [signer] = await ethers.getSigners();

  console.log("\n" + "=".repeat(68));
  console.log("  YearRing Fund Protocol — Closed Beta On-Chain State Check");
  console.log("=".repeat(68));
  console.log("  Network  :", network.name);
  console.log("  Checker  :", signer.address);
  console.log("  Timestamp:", new Date().toISOString());
  console.log("=".repeat(68) + "\n");

  const vaultAddr    = addr("YearRingCoreVaultV01");
  const ledgerAddr   = addr("LockLedgerV02");
  const benefitAddr  = addr("LockBenefitV02");
  const managerAddr  = addr("LockPointsRebateManagerV02");
  const beneAddr     = addr("BeneficiaryModuleV02");
  const treasuryAddr = addr("TreasuryV02");
  const pointsAddr   = addr("PointsToken");
  const stratMgrAddr = addr("StrategyManagerV01");
  const usdcAddr     = c["USDC"] || addr("MockUSDC");
  const strategyKey  = c["AaveV3StrategyV01"] ? "AaveV3StrategyV01" : "DummyStrategy";
  const strategyAddr = addr(strategyKey);

  // ── ABIs ──────────────────────────────────────────────────────────────────
  const VAULT_ABI = [
    "function asset() view returns (address)",
    "function treasury() view returns (address)",
    "function lockLedger() view returns (address)",
    "function strategyManager() view returns (address)",
    "function externalTransfersEnabled() view returns (bool)",
    "function depositsPaused() view returns (bool)",
    "function redeemsPaused() view returns (bool)",
    "function systemMode() view returns (uint8)",
    "function pricePerShare() view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function mgmtFeeBpsPerMonth() view returns (uint256)",
    "function reserveRatioBps() view returns (uint256)",
    "function symbol() view returns (string)",
  ];
  const LEDGER_ABI = [
    "function vaultShares() view returns (address)",
    "function OPERATOR_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function totalLockedShares() view returns (uint256)",
    "function nextLockId() view returns (uint256)",
  ];
  const TREASURY_ABI = [
    "function rebateManager() view returns (address)",
    "function approvedAssets(address) view returns (bool)",
    "function approvedModules(address) view returns (bool)",
    "function rebateBudgetOf(address) view returns (uint256)",
    "function rebateSpentOf(address) view returns (uint256)",
    "function rebateBudgetRemaining(address) view returns (uint256)",
  ];
  const STRATMGR_ABI = [
    "function vault() view returns (address)",
    "function underlying() view returns (address)",
    "function strategy() view returns (address)",
    "function totalManagedAssets() view returns (uint256)",
    "function idleUnderlying() view returns (uint256)",
    "function paused() view returns (bool)",
  ];
  const MANAGER_ABI = [
    "function ledger() view returns (address)",
    "function pointsToken() view returns (address)",
    "function treasury() view returns (address)",
  ];
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ];

  const vault    = new ethers.Contract(vaultAddr,    VAULT_ABI,    signer);
  const ledger   = new ethers.Contract(ledgerAddr,   LEDGER_ABI,   signer);
  const treasury = new ethers.Contract(treasuryAddr, TREASURY_ABI, signer);
  const stratMgr = new ethers.Contract(stratMgrAddr, STRATMGR_ABI, signer);
  const manager  = new ethers.Contract(managerAddr,  MANAGER_ABI,  signer);
  const yrCore   = new ethers.Contract(vaultAddr,    ERC20_ABI,    signer);
  const pts      = new ethers.Contract(pointsAddr,   ERC20_ABI,    signer);

  // ── A. Contract bindings ───────────────────────────────────────────────────
  HDR("A · Contract Bindings (same as verify_deployment)");
  check("vault.asset == USDC",              usdcAddr,     await vault.asset());
  check("vault.treasury == TreasuryV02",    treasuryAddr, await vault.treasury());
  check("vault.lockLedger == LockLedger",   ledgerAddr,   await vault.lockLedger());
  check("vault.strategyManager == StratMgr",stratMgrAddr, await vault.strategyManager());
  checkTrue("vault.externalTransfersEnabled", await vault.externalTransfersEnabled());

  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  check("ledger.vaultShares == Vault",      vaultAddr,    await ledger.vaultShares());
  checkTrue("ledger: manager has OPERATOR_ROLE",
    await ledger.hasRole(OPERATOR_ROLE, managerAddr));
  checkTrue("ledger: beneMod has OPERATOR_ROLE",
    await ledger.hasRole(OPERATOR_ROLE, beneAddr));

  check("manager.ledger == LockLedger",     ledgerAddr,   await manager.ledger());
  check("manager.pointsToken == PointsToken",pointsAddr,  await manager.pointsToken());
  check("manager.treasury == TreasuryV02",  treasuryAddr, await manager.treasury());

  check("treasury.rebateManager == Manager",managerAddr,  await treasury.rebateManager());
  checkTrue("treasury.approvedAssets[yrCORE]",  await treasury.approvedAssets(vaultAddr));
  checkTrue("treasury.approvedAssets[YRPTS]",   await treasury.approvedAssets(pointsAddr));
  checkTrue("treasury.approvedModules[manager]",await treasury.approvedModules(managerAddr));

  check("stratMgr.vault == Vault",          vaultAddr,    await stratMgr.vault());
  check("stratMgr.underlying == USDC",      usdcAddr,     await stratMgr.underlying());
  check(`stratMgr.strategy == ${strategyKey}`,strategyAddr,await stratMgr.strategy());

  // ── B. Vault operational state ─────────────────────────────────────────────
  HDR("B · Vault Operational State");

  const vaultSym      = await vault.symbol();
  const systemMode    = await vault.systemMode();
  const depositsPaused = await vault.depositsPaused();
  const redeemsPaused  = await vault.redeemsPaused();
  const pricePerShare = await vault.pricePerShare();
  const totalAssets   = await vault.totalAssets();
  const totalSupply   = await vault.totalSupply();
  const feeBps        = await vault.mgmtFeeBpsPerMonth();
  const reserveBps    = await vault.reserveRatioBps();

  INFO(`symbol:            ${vaultSym}`);
  INFO(`systemMode:        ${systemMode} (0=Normal, 1=EmergencyExit)`);
  INFO(`depositsPaused:    ${depositsPaused}`);
  INFO(`redeemsPaused:     ${redeemsPaused}`);
  INFO(`pricePerShare:     ${ethers.formatEther(pricePerShare)} USDC/yrCORE`);
  INFO(`totalAssets:       ${ethers.formatUnits(totalAssets,6)} USDC`);
  INFO(`totalSupply:       ${ethers.formatEther(totalSupply)} yrCORE`);
  INFO(`mgmtFeeBpsPerMonth:${feeBps} bps`);
  INFO(`reserveRatioBps:   ${reserveBps} bps`);

  checkTrue("Vault in Normal mode (mode=0)", systemMode === 0n);
  checkTrue("Deposits not paused", !depositsPaused);
  checkTrue("Redeems not paused",  !redeemsPaused);
  if (totalAssets === 0n) WARN("Vault totalAssets = 0 — no deposits yet");

  // ── C. Treasury state ──────────────────────────────────────────────────────
  HDR("C · Treasury State");

  const tYrCoreBal    = await yrCore.balanceOf(treasuryAddr);
  const tPtsBal       = await pts.balanceOf(treasuryAddr);
  const yrCoreAllowance = await yrCore.allowance(treasuryAddr, managerAddr);
  const ptsAllowance    = await pts.allowance(treasuryAddr, managerAddr);
  const rebateBudget    = await treasury.rebateBudgetOf(vaultAddr);
  const rebateSpent     = await treasury.rebateSpentOf(vaultAddr);
  const rebateRemaining = await treasury.rebateBudgetRemaining(vaultAddr);

  INFO(`Treasury yrCORE balance:    ${ethers.formatEther(tYrCoreBal)} yrCORE`);
  INFO(`Treasury YRPTS balance:     ${ethers.formatEther(tPtsBal)} YRPTS`);
  INFO(`yrCORE allowance (→mgr):   ${yrCoreAllowance === ethers.MaxUint256 ? "MaxUint256" : ethers.formatEther(yrCoreAllowance)}`);
  INFO(`YRPTS allowance (→mgr):    ${ptsAllowance === ethers.MaxUint256 ? "MaxUint256" : ethers.formatEther(ptsAllowance)}`);
  INFO(`rebateBudget (yrCORE):     ${rebateBudget === ethers.MaxUint256 ? "MaxUint256" : ethers.formatEther(rebateBudget)}`);
  INFO(`rebateSpent (yrCORE):      ${ethers.formatEther(rebateSpent)}`);
  INFO(`rebateRemaining (yrCORE):  ${rebateRemaining === ethers.MaxUint256 ? "MaxUint256" : ethers.formatEther(rebateRemaining)}`);

  checkTrue("Treasury YRPTS > 0 (premint intact)", tPtsBal > 0n);
  checkTrue("yrCORE allowance to manager set", yrCoreAllowance > 0n);
  checkTrue("YRPTS allowance to manager set", ptsAllowance > 0n);
  checkTrue("Rebate budget set (> 0)", rebateBudget > 0n);

  // ── D. StrategyManager state ───────────────────────────────────────────────
  HDR("D · StrategyManager State");

  const smPaused  = await stratMgr.paused();
  const smIdle    = await stratMgr.idleUnderlying();
  const smManaged = await stratMgr.totalManagedAssets();

  INFO(`paused:            ${smPaused}`);
  INFO(`idleUnderlying:    ${ethers.formatUnits(smIdle,6)} USDC`);
  INFO(`totalManagedAssets:${ethers.formatUnits(smManaged,6)} USDC`);
  checkTrue("StrategyManager not paused", !smPaused);

  // ── E. Lock state ──────────────────────────────────────────────────────────
  HDR("E · Lock State (LockLedgerV02)");

  const nextLockId       = await ledger.nextLockId();
  const totalLockedShares = await ledger.totalLockedShares();

  INFO(`nextLockId:        ${nextLockId} (total locks ever created)`);
  INFO(`totalLockedShares: ${ethers.formatEther(totalLockedShares)} yrCORE`);

  if (nextLockId === 0n) {
    WARN("No locks created yet — run deposit + lock steps first");
  } else {
    OK(`${nextLockId} lock(s) created, ${ethers.formatEther(totalLockedShares)} yrCORE locked`);
  }

  // ── F. Points supply ───────────────────────────────────────────────────────
  HDR("F · PointsToken (YRPTS) Supply");

  const ptsTotalSupply = await pts.totalSupply();
  const ptsInCirculation = ptsTotalSupply - tPtsBal;

  INFO(`totalSupply:       ${ethers.formatEther(ptsTotalSupply)} YRPTS`);
  INFO(`Treasury holds:    ${ethers.formatEther(tPtsBal)} YRPTS`);
  INFO(`In circulation:    ${ethers.formatEther(ptsInCirculation)} YRPTS`);

  const expectedSupply = 20_000_000n * 10n**18n;
  if (ptsTotalSupply === expectedSupply) {
    OK("YRPTS totalSupply == 20,000,000 (correct)");
  } else {
    console.log(`  ✗  YRPTS totalSupply mismatch: got ${ethers.formatEther(ptsTotalSupply)}`);
    failures++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ALL STATE CHECKS PASSED ✓");
    console.log("  Protocol is correctly configured for closed beta.");
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
    console.log("  Fix the issues above before proceeding.");
  }
  console.log("=".repeat(68));

  // Print address summary for deployment record
  console.log("\n  ── Address Summary ─────────────────────────────────────────");
  console.log(`  USDC                       ${usdcAddr}`);
  console.log(`  YearRingCoreVaultV01       ${vaultAddr}`);
  console.log(`  TreasuryV02                ${treasuryAddr}`);
  console.log(`  PointsToken (YRPTS)        ${pointsAddr}`);
  console.log(`  LockLedgerV02              ${ledgerAddr}`);
  console.log(`  LockBenefitV02             ${benefitAddr}`);
  console.log(`  LockPointsRebateManagerV02 ${managerAddr}`);
  console.log(`  BeneficiaryModuleV02       ${beneAddr}`);
  console.log(`  StrategyManagerV01         ${stratMgrAddr}`);
  console.log(`  ${strategyKey.padEnd(26)} ${strategyAddr}`);
  console.log("  " + "-".repeat(66) + "\n");

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
