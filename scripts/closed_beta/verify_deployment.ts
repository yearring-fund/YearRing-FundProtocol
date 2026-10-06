/**
 * verify_deployment.ts — YearRing Closed Beta: Post-Deploy Verification
 *
 * Must run AFTER setup_roles.ts.
 * Reads deployments/closed_beta_<network>.json and verifies all bindings,
 * roles, and token balances are correct.
 *
 * Exits 0 on success, 1 if any check fails.
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/verify_deployment.ts --network base
 *   npx hardhat run scripts/closed_beta/verify_deployment.ts --network hardhat
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

let failures = 0;

function pass(label: string) {
  console.log(`  ✓  ${label}`);
}

function fail(label: string, expected: string, actual: string) {
  console.log(`  ✗  ${label}`);
  console.log(`       expected: ${expected}`);
  console.log(`       actual  : ${actual}`);
  failures++;
}

function check(label: string, expected: string, actual: string) {
  if (expected.toLowerCase() === actual.toLowerCase()) {
    pass(label);
  } else {
    fail(label, expected, actual);
  }
}

function checkTrue(label: string, actual: boolean) {
  if (actual) {
    pass(label);
  } else {
    fail(label, "true", "false");
  }
}

function checkGt(label: string, actual: bigint, floor: bigint) {
  if (actual > floor) {
    pass(`${label} (${ethers.formatEther(actual)})`);
  } else {
    fail(label, `> ${floor}`, actual.toString());
  }
}

const SEP = () => console.log("-".repeat(68));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };

async function main() {
  const deploymentsPath = path.join(
    __dirname, "../../deployments", `closed_beta_${network.name}.json`
  );

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `Deployment record not found: ${deploymentsPath}\n` +
      `Run deploy_core_beta.ts and setup_roles.ts first.`
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
  console.log("  YearRing Fund Protocol — Closed Beta Deployment Verification");
  console.log("=".repeat(68));
  console.log("  Network  :", network.name);
  console.log("=".repeat(68) + "\n");

  const vaultAddr    = addr("YearRingCoreVaultV01");
  const ledgerAddr   = addr("LockLedgerV02");
  const benefitAddr  = addr("LockBenefitV02");
  const managerAddr  = addr("LockPointsRebateManagerV02");
  const beneAddr     = addr("BeneficiaryModuleV02");
  const userStateAddr= addr("UserStateEngineV02");
  const metricsAddr  = addr("MetricsLayerV02");
  const govAddr      = addr("GovernanceSignalV02");
  const treasuryAddr = addr("TreasuryV02");
  const pointsAddr   = addr("PointsToken");
  const stratMgrAddr = addr("StrategyManagerV01");
  const usdcAddr     = c["USDC"] || addr("MockUSDC");
  const strategyKey  = c["AaveV3StrategyV01"] ? "AaveV3StrategyV01" : "DummyStrategy";
  const strategyAddr = addr(strategyKey);

  // Minimal view ABIs
  const VAULT_ABI = [
    "function asset() view returns (address)",
    "function treasury() view returns (address)",
    "function lockLedger() view returns (address)",
    "function strategyManager() view returns (address)",
    "function externalTransfersEnabled() view returns (bool)",
    "function mgmtFeeBpsPerMonth() view returns (uint256)",
    "function symbol() view returns (string)",
  ];
  const LEDGER_ABI = [
    "function vaultShares() view returns (address)",
    "function OPERATOR_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
  ];
  const BENEFIT_ABI = ["function ledger() view returns (address)"];
  const MANAGER_ABI = [
    "function ledger() view returns (address)",
    "function benefit() view returns (address)",
    "function pointsToken() view returns (address)",
    "function vaultShares() view returns (address)",
    "function vault() view returns (address)",
    "function treasury() view returns (address)",
  ];
  const BENE_ABI    = ["function ledger() view returns (address)"];
  const USERST_ABI  = ["function ledger() view returns (address)"];
  const METRICS_ABI = ["function vault() view returns (address)", "function ledger() view returns (address)"];
  const GOV_ABI     = ["function rewardToken() view returns (address)"];
  const TREASURY_ABI = [
    "function rebateManager() view returns (address)",
    "function approvedAssets(address) view returns (bool)",
    "function approvedModules(address) view returns (bool)",
  ];
  const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
  const STRATMGR_ABI = [
    "function vault() view returns (address)",
    "function underlying() view returns (address)",
    "function strategy() view returns (address)",
  ];

  const [signer] = await ethers.getSigners();
  const vault    = new ethers.Contract(vaultAddr,     VAULT_ABI,    signer);
  const ledger   = new ethers.Contract(ledgerAddr,    LEDGER_ABI,   signer);
  const benefit  = new ethers.Contract(benefitAddr,   BENEFIT_ABI,  signer);
  const manager  = new ethers.Contract(managerAddr,   MANAGER_ABI,  signer);
  const bene     = new ethers.Contract(beneAddr,      BENE_ABI,     signer);
  const userSt   = new ethers.Contract(userStateAddr, USERST_ABI,   signer);
  const metrics  = new ethers.Contract(metricsAddr,   METRICS_ABI,  signer);
  const gov      = new ethers.Contract(govAddr,       GOV_ABI,      signer);
  const treasury = new ethers.Contract(treasuryAddr,  TREASURY_ABI, signer);
  const points   = new ethers.Contract(pointsAddr,    ERC20_ABI,    signer);
  const stratMgr = new ethers.Contract(stratMgrAddr,  STRATMGR_ABI, signer);

  // ── A. Vault ─────────────────────────────────────────────────────────────
  HDR("A · YearRingCoreVaultV01");
  check("vault.asset() == USDC",               usdcAddr,     await vault.asset());
  check("vault.treasury() == TreasuryV02",     treasuryAddr, await vault.treasury());
  check("vault.lockLedger() == LockLedgerV02", ledgerAddr,   await vault.lockLedger());
  check("vault.strategyManager() == StratMgr", stratMgrAddr, await vault.strategyManager());
  checkTrue("vault.externalTransfersEnabled()", await vault.externalTransfersEnabled());
  const feeBps = await vault.mgmtFeeBpsPerMonth();
  console.log(`  ℹ  mgmtFeeBpsPerMonth = ${feeBps}`);
  const sym = await vault.symbol();
  console.log(`  ℹ  symbol = ${sym}`);

  // ── B. LockLedger ────────────────────────────────────────────────────────
  HDR("B · LockLedgerV02");
  check("ledger.vaultShares() == Vault",  vaultAddr, await ledger.vaultShares());

  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  checkTrue("ledger: LockPointsRebateManagerV02 has OPERATOR_ROLE",
    await ledger.hasRole(OPERATOR_ROLE, managerAddr));
  checkTrue("ledger: BeneficiaryModuleV02 has OPERATOR_ROLE",
    await ledger.hasRole(OPERATOR_ROLE, beneAddr));

  // ── C. LockBenefitV02 ────────────────────────────────────────────────────
  HDR("C · LockBenefitV02");
  check("benefit.ledger() == LockLedgerV02", ledgerAddr, await benefit.ledger());

  // ── D. LockPointsRebateManagerV02 ───────────────────────────────────────
  HDR("D · LockPointsRebateManagerV02");
  check("manager.ledger() == LockLedgerV02",   ledgerAddr,   await manager.ledger());
  check("manager.benefit() == LockBenefitV02", benefitAddr,  await manager.benefit());
  check("manager.pointsToken() == PointsToken",pointsAddr,   await manager.pointsToken());
  check("manager.vaultShares() == Vault",      vaultAddr,    await manager.vaultShares());
  check("manager.vault() == Vault",            vaultAddr,    await manager.vault());
  check("manager.treasury() == TreasuryV02",   treasuryAddr, await manager.treasury());

  // ── E. BeneficiaryModuleV02 ──────────────────────────────────────────────
  HDR("E · BeneficiaryModuleV02");
  check("bene.ledger() == LockLedgerV02", ledgerAddr, await bene.ledger());

  // ── F. UserStateEngineV02 ────────────────────────────────────────────────
  HDR("F · UserStateEngineV02");
  check("userState.ledger() == LockLedgerV02", ledgerAddr, await userSt.ledger());

  // ── G. MetricsLayerV02 ───────────────────────────────────────────────────
  HDR("G · MetricsLayerV02");
  check("metrics.vault() == Vault",   vaultAddr,  await metrics.vault());
  check("metrics.ledger() == Ledger", ledgerAddr, await metrics.ledger());

  // ── H. GovernanceSignalV02 ───────────────────────────────────────────────
  HDR("H · GovernanceSignalV02");
  check("gov.rewardToken() == PointsToken", pointsAddr, await gov.rewardToken());

  // ── I. TreasuryV02 ───────────────────────────────────────────────────────
  HDR("I · TreasuryV02");
  check("treasury.rebateManager() == LockPointsRebateManagerV02",
    managerAddr, await treasury.rebateManager());
  checkTrue("treasury.approvedAssets[yrCORE vault] == true",
    await treasury.approvedAssets(vaultAddr));
  checkTrue("treasury.approvedModules[LockPointsRebateManagerV02] == true",
    await treasury.approvedModules(managerAddr));

  // ── J. PointsToken supply ────────────────────────────────────────────────
  HDR("J · PointsToken (YRPTS) supply");
  const pointsRecipient = c["PointsRecipient"] || treasuryAddr;
  const ptsBal = await points.balanceOf(pointsRecipient);
  const expectedSupply = 20_000_000n * 10n ** 18n;
  checkGt("PointsToken balance of Treasury > 0", ptsBal, 0n);
  if (ptsBal === expectedSupply) {
    pass("PointsToken balance of Treasury == 20,000,000 YRPTS (full supply)");
  } else {
    console.log(`  ℹ  PointsToken treasury balance = ${ethers.formatEther(ptsBal)} YRPTS`);
  }

  // ── K. StrategyManagerV01 ────────────────────────────────────────────────
  HDR("K · StrategyManagerV01");
  check("stratMgr.vault() == Vault",           vaultAddr,    await stratMgr.vault());
  check("stratMgr.underlying() == USDC",        usdcAddr,    await stratMgr.underlying());
  check(`stratMgr.strategy() == ${strategyKey}`, strategyAddr, await stratMgr.strategy());

  // ── Result ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ALL CHECKS PASSED ✓");
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
    console.log("  Fix the issues above before proceeding to export_addresses.ts");
  }
  console.log("=".repeat(68));

  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
