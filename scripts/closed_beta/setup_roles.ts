/**
 * setup_roles.ts — YearRing Closed Beta: Post-Deploy Role & Binding Setup
 *
 * Must run AFTER deploy_core_beta.ts.
 * Reads deployments/closed_beta_<network>.json and wires up:
 *
 *   A. Vault: lockLedger, strategyManager, externalTransfers
 *   B. LockLedger: OPERATOR_ROLE for LockPointsRebateManagerV02 + BeneficiaryModuleV02
 *   C. TreasuryV02: rebateManager, approvedAsset(yrCORE), approvedModule, spender allowance,
 *                   rebateBudget for yrCORE shares
 *                   NOTE: YRPTS / PointsToken approvals removed — Points are now managed by
 *                   PointsLedgerV01 and do not flow through TreasuryV02.
 *   D. StrategyManager: strategy binding (requires pause → setStrategy → unpause)
 *   E. PointsLedgerV01: role grants
 *        POINTS_MINTER_ROLE → LockPointsRebateManagerV02
 *        POINTS_MINTER_ROLE → ContributionPointsDistributorV01
 *        POINTS_BURNER_ROLE → LockPointsRebateManagerV02
 *        SNAPSHOT_ROLE      → GovernanceSignalV02
 *
 * Idempotent: each step checks current state before sending a tx.
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/setup_roles.ts --network base
 *   npx hardhat run scripts/closed_beta/setup_roles.ts --network hardhat
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEP = () => console.log("-".repeat(68));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK  = (msg: string) => console.log(`  ✓  ${msg}`);
const SKP = (msg: string) => console.log(`  –  ${msg} (already set)`);

// ── Minimal ABIs ────────────────────────────────────────────────────────────

const VAULT_ABI = [
  "function lockLedger() view returns (address)",
  "function strategyManager() view returns (address)",
  "function externalTransfersEnabled() view returns (bool)",
  "function setLockLedger(address) external",
  "function setModules(address) external",
  "function setExternalTransfersEnabled(bool) external",
] as const;

const LEDGER_ABI = [
  "function OPERATOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address) external",
] as const;

const TREASURY_ABI = [
  "function rebateManager() view returns (address)",
  "function approvedAssets(address) view returns (bool)",
  "function approvedModules(address) view returns (bool)",
  "function rebateBudgetOf(address) view returns (uint256)",
  "function setRebateManager(address) external",
  "function setApprovedAsset(address,bool) external",
  "function setApprovedModule(address,bool) external",
  "function approveSpender(address,address,uint256) external",
  "function setRebateBudget(address,uint256) external",
] as const;

const STRAT_MGR_ABI = [
  "function strategy() view returns (address)",
  "function paused() view returns (bool)",
  "function setStrategy(address) external",
  "function pause() external",
  "function unpause() external",
] as const;

const POINTS_LEDGER_ABI = [
  "function POINTS_MINTER_ROLE() view returns (bytes32)",
  "function POINTS_BURNER_ROLE() view returns (bytes32)",
  "function SNAPSHOT_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address) external",
] as const;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [signer] = await ethers.getSigners();

  const deploymentsPath = path.join(
    __dirname, "../../deployments", `closed_beta_${network.name}.json`
  );

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `Deployment record not found: ${deploymentsPath}\n` +
      `Run deploy_core_beta.ts first.`
    );
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts as Record<string, string>;

  function addr(key: string): string {
    const a = c[key];
    if (!a) throw new Error(`Missing contract address for key: ${key}`);
    return a;
  }

  console.log("\n" + "=".repeat(68));
  console.log("  YearRing Fund Protocol — Closed Beta Role Setup");
  console.log("=".repeat(68));
  console.log("  Network  :", network.name);
  console.log("  Signer   :", signer.address);
  console.log("=".repeat(68) + "\n");

  // ── Resolve addresses ──────────────────────────────────────────────────────
  const vaultAddr       = addr("YearRingCoreVaultV01");
  const ledgerAddr      = addr("LockLedgerV02");
  const managerAddr     = addr("LockPointsRebateManagerV02");
  const beneAddr        = addr("BeneficiaryModuleV02");
  const treasuryAddr    = addr("TreasuryV02");
  const stratMgrAddr    = addr("StrategyManagerV01");
  const pointsLedgerAddr = addr("PointsLedgerV01");
  const distributorAddr  = addr("ContributionPointsDistributorV01");
  const governanceAddr   = addr("GovernanceSignalV02");
  const strategyKey     = c["AaveV3StrategyV01"] ? "AaveV3StrategyV01" : "DummyStrategy";
  const strategyAddr    = addr(strategyKey);

  // ── Instantiate contracts ─────────────────────────────────────────────────
  const vault        = new ethers.Contract(vaultAddr,        VAULT_ABI,        signer);
  const lockLedger   = new ethers.Contract(ledgerAddr,       LEDGER_ABI,       signer);
  const treasury     = new ethers.Contract(treasuryAddr,     TREASURY_ABI,     signer);
  const stratMgr     = new ethers.Contract(stratMgrAddr,     STRAT_MGR_ABI,    signer);
  const pointsLedger = new ethers.Contract(pointsLedgerAddr, POINTS_LEDGER_ABI, signer);

  const MaxUint256 = ethers.MaxUint256;

  // ── A. Vault bindings ──────────────────────────────────────────────────────
  HDR("A · Vault bindings");

  const currentLedger = await vault.lockLedger();
  if (currentLedger.toLowerCase() === ledgerAddr.toLowerCase()) {
    SKP("vault.lockLedger already set");
  } else {
    await (await vault.setLockLedger(ledgerAddr)).wait();
    OK("vault.setLockLedger(LockLedgerV02)");
  }

  const currentStratMgr = await vault.strategyManager();
  if (currentStratMgr.toLowerCase() === stratMgrAddr.toLowerCase()) {
    SKP("vault.strategyManager already set");
  } else {
    await (await vault.setModules(stratMgrAddr)).wait();
    OK("vault.setModules(StrategyManagerV01)");
  }

  const extEnabled = await vault.externalTransfersEnabled();
  if (extEnabled) {
    SKP("vault.externalTransfersEnabled already true");
  } else {
    await (await vault.setExternalTransfersEnabled(true)).wait();
    OK("vault.setExternalTransfersEnabled(true)");
  }

  // ── B. LockLedger OPERATOR_ROLE grants ────────────────────────────────────
  HDR("B · LockLedger OPERATOR_ROLE grants");

  const OPERATOR_ROLE = await lockLedger.OPERATOR_ROLE();

  const managerHasOp = await lockLedger.hasRole(OPERATOR_ROLE, managerAddr);
  if (managerHasOp) {
    SKP("LockPointsRebateManagerV02 already has OPERATOR_ROLE");
  } else {
    await (await lockLedger.grantRole(OPERATOR_ROLE, managerAddr)).wait();
    OK("grantRole(OPERATOR_ROLE, LockPointsRebateManagerV02)");
  }

  const beneHasOp = await lockLedger.hasRole(OPERATOR_ROLE, beneAddr);
  if (beneHasOp) {
    SKP("BeneficiaryModuleV02 already has OPERATOR_ROLE");
  } else {
    await (await lockLedger.grantRole(OPERATOR_ROLE, beneAddr)).wait();
    OK("grantRole(OPERATOR_ROLE, BeneficiaryModuleV02)");
  }

  // ── C. TreasuryV02 configuration ──────────────────────────────────────────
  // Scope: yrCORE rebate path only.
  // YRPTS / PointsToken config removed — Points are managed by PointsLedgerV01.
  HDR("C · TreasuryV02 configuration (yrCORE rebate path)");

  const currentRebateMgr = await treasury.rebateManager();
  if (currentRebateMgr.toLowerCase() === managerAddr.toLowerCase()) {
    SKP("treasury.rebateManager already set");
  } else {
    await (await treasury.setRebateManager(managerAddr)).wait();
    OK("treasury.setRebateManager(LockPointsRebateManagerV02)");
  }

  const vaultAssetApproved = await treasury.approvedAssets(vaultAddr);
  if (vaultAssetApproved) {
    SKP("treasury.approvedAssets[yrCORE] already true");
  } else {
    await (await treasury.setApprovedAsset(vaultAddr, true)).wait();
    OK("treasury.setApprovedAsset(yrCORE vault shares, true)");
  }

  const moduleApproved = await treasury.approvedModules(managerAddr);
  if (moduleApproved) {
    SKP("treasury.approvedModules[LockPointsRebateManagerV02] already true");
  } else {
    await (await treasury.setApprovedModule(managerAddr, true)).wait();
    OK("treasury.setApprovedModule(LockPointsRebateManagerV02, true)");
  }

  // approveSpender overwrites; always re-set for idempotency
  await (await treasury.approveSpender(vaultAddr, managerAddr, MaxUint256)).wait();
  OK("treasury.approveSpender(yrCORE, LockPointsRebateManager, MaxUint256)");

  const currentBudget = await treasury.rebateBudgetOf(vaultAddr);
  if (currentBudget === 0n) {
    await (await treasury.setRebateBudget(vaultAddr, MaxUint256)).wait();
    OK("treasury.setRebateBudget(yrCORE, MaxUint256)");
  } else {
    SKP(`treasury.rebateBudgetOf[yrCORE] = ${currentBudget} (already set)`);
  }

  // ── D. StrategyManager: bind strategy ─────────────────────────────────────
  HDR("D · StrategyManager: bind strategy");

  const currentStrategy = await stratMgr.strategy();
  if (currentStrategy.toLowerCase() === strategyAddr.toLowerCase()) {
    SKP(`stratMgr.strategy already = ${strategyKey}`);
  } else {
    const isPaused = await stratMgr.paused();
    if (!isPaused) {
      await (await stratMgr.pause()).wait();
      OK("stratMgr.pause()");
    }
    await (await stratMgr.setStrategy(strategyAddr)).wait();
    OK(`stratMgr.setStrategy(${strategyKey})`);
    await (await stratMgr.unpause()).wait();
    OK("stratMgr.unpause()");
  }

  // ── E. PointsLedgerV01 role grants ────────────────────────────────────────
  HDR("E · PointsLedgerV01 role grants");

  const POINTS_MINTER_ROLE = await pointsLedger.POINTS_MINTER_ROLE();
  const POINTS_BURNER_ROLE = await pointsLedger.POINTS_BURNER_ROLE();
  const SNAPSHOT_ROLE      = await pointsLedger.SNAPSHOT_ROLE();

  // POINTS_MINTER_ROLE → LockPointsRebateManagerV02
  const mgrHasMinter = await pointsLedger.hasRole(POINTS_MINTER_ROLE, managerAddr);
  if (mgrHasMinter) {
    SKP("LockPointsRebateManagerV02 already has POINTS_MINTER_ROLE");
  } else {
    await (await pointsLedger.grantRole(POINTS_MINTER_ROLE, managerAddr)).wait();
    OK("grantRole(POINTS_MINTER_ROLE, LockPointsRebateManagerV02)");
  }

  // POINTS_BURNER_ROLE → LockPointsRebateManagerV02
  const mgrHasBurner = await pointsLedger.hasRole(POINTS_BURNER_ROLE, managerAddr);
  if (mgrHasBurner) {
    SKP("LockPointsRebateManagerV02 already has POINTS_BURNER_ROLE");
  } else {
    await (await pointsLedger.grantRole(POINTS_BURNER_ROLE, managerAddr)).wait();
    OK("grantRole(POINTS_BURNER_ROLE, LockPointsRebateManagerV02)");
  }

  // POINTS_MINTER_ROLE → ContributionPointsDistributorV01
  const distHasMinter = await pointsLedger.hasRole(POINTS_MINTER_ROLE, distributorAddr);
  if (distHasMinter) {
    SKP("ContributionPointsDistributorV01 already has POINTS_MINTER_ROLE");
  } else {
    await (await pointsLedger.grantRole(POINTS_MINTER_ROLE, distributorAddr)).wait();
    OK("grantRole(POINTS_MINTER_ROLE, ContributionPointsDistributorV01)");
  }

  // SNAPSHOT_ROLE → GovernanceSignalV02
  const govHasSnapshot = await pointsLedger.hasRole(SNAPSHOT_ROLE, governanceAddr);
  if (govHasSnapshot) {
    SKP("GovernanceSignalV02 already has SNAPSHOT_ROLE");
  } else {
    await (await pointsLedger.grantRole(SNAPSHOT_ROLE, governanceAddr)).wait();
    OK("grantRole(SNAPSHOT_ROLE, GovernanceSignalV02)");
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  console.log("  SETUP COMPLETE");
  console.log("=".repeat(68));
  console.log("\n  Next:");
  console.log("    npx hardhat run scripts/closed_beta/verify_deployment.ts --network " + network.name);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
