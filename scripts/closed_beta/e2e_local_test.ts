/**
 * e2e_local_test.ts — End-to-End local validation of the closed beta deployment pipeline
 *
 * Runs the full sequence in a single Hardhat process (same in-memory state):
 *   Deploy → Setup Roles → Verify → (optionally) Export
 *
 * This script is for CI / pre-mainnet validation only.
 * For production, run each script separately against --network base.
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/e2e_local_test.ts --network hardhat
 */

import { ethers } from "hardhat";
import { getClosedBetaConfig } from "./config";

const SEP = () => console.log("-".repeat(68));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK  = (msg: string) => console.log(`  ✓  ${msg}`);

let failures = 0;
function check(label: string, expected: string, actual: string) {
  if (expected.toLowerCase() === actual.toLowerCase()) {
    OK(label);
  } else {
    console.log(`  ✗  ${label}`);
    console.log(`       expected: ${expected}`);
    console.log(`       actual  : ${actual}`);
    failures++;
  }
}
function checkTrue(label: string, val: boolean) {
  if (val) OK(label);
  else { console.log(`  ✗  ${label} (expected true, got false)`); failures++; }
}

async function main() {
  const cfg = getClosedBetaConfig("hardhat");
  const [deployer] = await ethers.getSigners();
  const admin    = deployer;
  const guardian = deployer;
  const MaxUint256 = ethers.MaxUint256;

  console.log("\n" + "=".repeat(68));
  console.log("  Closed Beta E2E Local Test");
  console.log("=".repeat(68));
  console.log("  Deployer/Admin/Guardian :", deployer.address);
  console.log("=".repeat(68) + "\n");

  // ── PHASE 1: Deploy ──────────────────────────────────────────────────────
  HDR("Phase 1 · Deploy All Contracts");

  async function dep(name: string, args: unknown[]) {
    process.stdout.write(`  ${name.padEnd(36)} … `);
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    console.log(a);
    return a;
  }

  const mockUsdcAddr    = await dep("MockUSDC", []);
  const treasuryAddr    = await dep("TreasuryV02", [admin.address]);
  const pointsAddr      = await dep("PointsToken", [
    cfg.pointsTokenName, cfg.pointsTokenSymbol, cfg.pointsTotalSupply, treasuryAddr,
  ]);
  const vaultAddr       = await dep("YearRingCoreVaultV01", [
    mockUsdcAddr, cfg.vaultName, cfg.vaultSymbol, treasuryAddr, admin.address, cfg.mgmtFeeBpsPerMonth,
  ]);
  const ledgerAddr      = await dep("LockLedgerV02",    [vaultAddr, admin.address, guardian.address]);
  const benefitAddr     = await dep("LockBenefitV02",   [ledgerAddr]);
  const managerAddr     = await dep("LockPointsRebateManagerV02", [
    ledgerAddr, benefitAddr, pointsAddr, vaultAddr, vaultAddr, treasuryAddr, admin.address, guardian.address,
  ]);
  const beneModAddr     = await dep("BeneficiaryModuleV02", [ledgerAddr, admin.address]);
  const userStateAddr   = await dep("UserStateEngineV02",   [ledgerAddr]);
  const metricsAddr     = await dep("MetricsLayerV02",      [vaultAddr, ledgerAddr]);
  const govAddr         = await dep("GovernanceSignalV02",  [
    pointsAddr, cfg.votingThreshold, cfg.votingPeriod, admin.address,
  ]);
  const claimLedgerAddr = await dep("ClaimLedger",          [admin.address]);
  const stratMgrAddr    = await dep("StrategyManagerV01",   [mockUsdcAddr, vaultAddr, admin.address]);
  const strategyAddr    = await dep("DummyStrategy",        [mockUsdcAddr]);

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
  ];
  const STRATMGR_ABI = [
    "function setStrategy(address) external",
    "function setLimits(uint256,uint256) external",
    "function pause() external",
    "function unpause() external",
    "function strategy() view returns (address)",
  ];

  const vault    = new ethers.Contract(vaultAddr,    VAULT_ABI,    admin);
  const ledger   = new ethers.Contract(ledgerAddr,   LEDGER_ABI,   admin);
  const treasury = new ethers.Contract(treasuryAddr, TREASURY_ABI, admin);
  const stratMgr = new ethers.Contract(stratMgrAddr, STRATMGR_ABI, admin);

  await (await vault.setLockLedger(ledgerAddr)).wait();             OK("vault.setLockLedger");
  await (await vault.setModules(stratMgrAddr)).wait();              OK("vault.setModules");
  await (await vault.setExternalTransfersEnabled(true)).wait();     OK("vault.setExternalTransfersEnabled");

  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await (await ledger.grantRole(OPERATOR_ROLE, managerAddr)).wait(); OK("ledger: grantRole OPERATOR → manager");
  await (await ledger.grantRole(OPERATOR_ROLE, beneModAddr)).wait(); OK("ledger: grantRole OPERATOR → beneModule");

  await (await treasury.setRebateManager(managerAddr)).wait();       OK("treasury.setRebateManager");
  await (await treasury.setApprovedAsset(vaultAddr, true)).wait();   OK("treasury.setApprovedAsset(yrCORE)");
  await (await treasury.setApprovedModule(managerAddr, true)).wait();OK("treasury.setApprovedModule(manager)");
  await (await treasury.approveSpender(vaultAddr, managerAddr, MaxUint256)).wait();
  OK("treasury.approveSpender(yrCORE → manager, MaxUint256)");
  // Also approve YRPTS from treasury to manager — required for lockWithPoints (Points issuance)
  await (await treasury.setApprovedAsset(pointsAddr, true)).wait();
  OK("treasury.setApprovedAsset(YRPTS)");
  await (await treasury.approveSpender(pointsAddr, managerAddr, MaxUint256)).wait();
  OK("treasury.approveSpender(YRPTS → manager, MaxUint256)");

  await (await stratMgr.pause()).wait();                             OK("stratMgr.pause()");
  await (await stratMgr.setStrategy(strategyAddr)).wait();          OK("stratMgr.setStrategy(DummyStrategy)");
  await (await stratMgr.unpause()).wait();                           OK("stratMgr.unpause()");

  // ── PHASE 3: Verify ──────────────────────────────────────────────────────
  HDR("Phase 3 · Verify All Bindings");

  const VIEW_VAULT_ABI = [
    "function asset() view returns (address)",
    "function treasury() view returns (address)",
    "function lockLedger() view returns (address)",
    "function strategyManager() view returns (address)",
    "function externalTransfersEnabled() view returns (bool)",
    "function symbol() view returns (string)",
  ];
  const VIEW_LEDGER_ABI   = ["function vaultShares() view returns (address)", "function hasRole(bytes32,address) view returns (bool)"];
  const VIEW_BENEFIT_ABI  = ["function ledger() view returns (address)"];
  const VIEW_MANAGER_ABI  = ["function ledger() view returns (address)", "function benefit() view returns (address)", "function pointsToken() view returns (address)", "function vaultShares() view returns (address)", "function vault() view returns (address)", "function treasury() view returns (address)"];
  const VIEW_BENEMOD_ABI  = ["function ledger() view returns (address)"];
  const VIEW_USERST_ABI   = ["function ledger() view returns (address)"];
  const VIEW_METRICS_ABI  = ["function vault() view returns (address)", "function ledger() view returns (address)"];
  const VIEW_GOV_ABI      = ["function rewardToken() view returns (address)"];
  const VIEW_TREASURY_ABI = ["function rebateManager() view returns (address)", "function approvedAssets(address) view returns (bool)", "function approvedModules(address) view returns (bool)"];
  const VIEW_STRATMGR_ABI = ["function vault() view returns (address)", "function underlying() view returns (address)", "function strategy() view returns (address)"];
  const ERC20_ABI         = ["function balanceOf(address) view returns (uint256)"];

  const [signer] = await ethers.getSigners();
  const vV    = new ethers.Contract(vaultAddr,    VIEW_VAULT_ABI,    signer);
  const vL    = new ethers.Contract(ledgerAddr,   VIEW_LEDGER_ABI,   signer);
  const vB    = new ethers.Contract(benefitAddr,  VIEW_BENEFIT_ABI,  signer);
  const vM    = new ethers.Contract(managerAddr,  VIEW_MANAGER_ABI,  signer);
  const vBM   = new ethers.Contract(beneModAddr,  VIEW_BENEMOD_ABI,  signer);
  const vUS   = new ethers.Contract(userStateAddr,VIEW_USERST_ABI,   signer);
  const vMet  = new ethers.Contract(metricsAddr,  VIEW_METRICS_ABI,  signer);
  const vG    = new ethers.Contract(govAddr,      VIEW_GOV_ABI,      signer);
  const vT    = new ethers.Contract(treasuryAddr, VIEW_TREASURY_ABI, signer);
  const vSM   = new ethers.Contract(stratMgrAddr, VIEW_STRATMGR_ABI, signer);
  const pts   = new ethers.Contract(pointsAddr,   ERC20_ABI,         signer);

  // Vault
  check("vault.asset == USDC",          mockUsdcAddr,  await vV.asset());
  check("vault.treasury == Treasury",   treasuryAddr,  await vV.treasury());
  check("vault.lockLedger == Ledger",   ledgerAddr,    await vV.lockLedger());
  check("vault.strategyManager == SM",  stratMgrAddr,  await vV.strategyManager());
  checkTrue("vault.externalTransfersEnabled", await vV.externalTransfersEnabled());

  // LockLedger
  check("ledger.vaultShares == Vault",  vaultAddr, await vL.vaultShares());
  checkTrue("ledger: manager has OPERATOR_ROLE",  await vL.hasRole(OPERATOR_ROLE, managerAddr));
  checkTrue("ledger: beneMod has OPERATOR_ROLE",  await vL.hasRole(OPERATOR_ROLE, beneModAddr));

  // Immutable bindings
  check("benefit.ledger == Ledger",    ledgerAddr,   await vB.ledger());
  check("manager.ledger == Ledger",    ledgerAddr,   await vM.ledger());
  check("manager.benefit == Benefit",  benefitAddr,  await vM.benefit());
  check("manager.pointsToken == Pts",  pointsAddr,   await vM.pointsToken());
  check("manager.vaultShares == Vault",vaultAddr,    await vM.vaultShares());
  check("manager.vault == Vault",      vaultAddr,    await vM.vault());
  check("manager.treasury == Treasury",treasuryAddr, await vM.treasury());
  check("beneMod.ledger == Ledger",    ledgerAddr,   await vBM.ledger());
  check("userState.ledger == Ledger",  ledgerAddr,   await vUS.ledger());
  check("metrics.vault == Vault",      vaultAddr,    await vMet.vault());
  check("metrics.ledger == Ledger",    ledgerAddr,   await vMet.ledger());
  check("gov.rewardToken == Points",   pointsAddr,   await vG.rewardToken());

  // Treasury
  check("treasury.rebateManager == Manager",   managerAddr, await vT.rebateManager());
  checkTrue("treasury.approvedAssets[vault]",       await vT.approvedAssets(vaultAddr));
  checkTrue("treasury.approvedModules[manager]",    await vT.approvedModules(managerAddr));

  // StrategyManager
  check("stratMgr.vault == Vault",       vaultAddr,    await vSM.vault());
  check("stratMgr.underlying == USDC",   mockUsdcAddr, await vSM.underlying());
  check("stratMgr.strategy == Dummy",    strategyAddr, await vSM.strategy());

  // Points supply
  const ptsBal = await pts.balanceOf(treasuryAddr);
  if (ptsBal === cfg.pointsTotalSupply) {
    OK(`PointsToken: Treasury holds full 20M YRPTS (${ethers.formatEther(ptsBal)})`);
  } else {
    console.log(`  ✗  PointsToken treasury balance mismatch: ${ethers.formatEther(ptsBal)}`);
    failures++;
  }

  // ── Result ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ALL E2E CHECKS PASSED ✓  — deployment pipeline is valid");
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
  }
  console.log("=".repeat(68) + "\n");

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
