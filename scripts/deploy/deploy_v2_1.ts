/**
 * deploy_v2_1.ts — YearRing Fund Protocol V2.1 Full Deployment
 * =============================================================
 *
 * Deploys all V2.1 contracts in dependency order, wires roles,
 * and seeds the vault with the initial 10-USDC deposit.
 *
 * Network behaviour
 * -----------------
 *   base       → real USDC + AaveUSDCStrategyV21 (Aave V3 on Base)
 *   hardhat    → MockUSDC + MockStrategyV21 (no external deps)
 *   localhost  → same as hardhat
 *   base-fork  → same as hardhat (mock strategy; fork tests only)
 *
 * Environment variables (mainnet only, ignored on local)
 * ------------------------------------------------------
 *   ADMIN_ADDRESS    multisig address that will hold DEFAULT_ADMIN_ROLE
 *   KEEPER_ADDRESS   bot address that will hold KEEPER_ROLE
 *
 * Usage
 * -----
 *   npx hardhat run scripts/deploy/deploy_v2_1.ts --network base
 *   npx hardhat run scripts/deploy/deploy_v2_1.ts --network hardhat
 *
 * Output
 *   deployments/v2_1_<network>.json   ← all addresses + config snapshot
 *
 * Post-deploy checklist (manual)
 * --------------------------------
 *   1. Transfer DEFAULT_ADMIN_ROLE to multisig (renounce deployer admin)
 *   2. Verify contracts on Basescan
 *   3. Add beta user addresses to vault allowlist via allowlist_add.ts
 *   4. Optional: set EligibilityModule requiredPoints if Points gate is needed
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getV21Config } from "./config_v2_1";

// ── Logging helpers ──────────────────────────────────────────────────────────

const SEP = () => console.log("-".repeat(70));
const HDR = (s: string) => { SEP(); console.log(`  ${s}`); SEP(); };
const OK  = (label: string, addr: string) =>
  console.log(`  ✓  ${label.padEnd(38)} ${addr}`);
const INFO = (msg: string) => console.log(`  ℹ  ${msg}`);
const WARN = (msg: string) => console.log(`  ⚠  ${msg}`);

// ── Role constants (keccak256 of role name, matching contracts) ───────────────

const KEEPER_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
const REBATE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBATE_MANAGER_ROLE"));
const POINTS_MINTER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_MINTER_ROLE"));
const POINTS_BURNER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_BURNER_ROLE"));

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = getV21Config(network.name);
  const [deployer] = await ethers.getSigners();

  // ── Role addresses ────────────────────────────────────────────────────────
  // On local: deployer = admin = keeper (no env vars needed).
  // On mainnet: ADMIN_ADDRESS becomes the long-term multisig admin.
  //             KEEPER_ADDRESS becomes the keeper bot.
  //             Deployer still signs all initial config txs (assumed == admin
  //             during the deploy window); transfer admin to multisig post-deploy.

  const ADMIN_ADDR  = cfg.useDeployerAsAdmin
    ? deployer.address
    : (process.env.ADMIN_ADDRESS   || deployer.address);

  const KEEPER_ADDR = cfg.useDeployerAsAdmin
    ? deployer.address
    : (process.env.KEEPER_ADDRESS  || deployer.address);

  // ── Banner ────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("  YearRing Fund Protocol V2.1 — Full Deployment");
  console.log("=".repeat(70));
  console.log(`  Network   : ${network.name}`);
  console.log(`  Deployer  : ${deployer.address}`);
  console.log(`  Admin     : ${ADMIN_ADDR}`);
  console.log(`  Keeper    : ${KEEPER_ADDR}`);
  console.log(`  Strategy  : ${network.name === "base" ? "AaveUSDCStrategyV21" : "MockStrategyV21"}`);
  console.log("=".repeat(70) + "\n");

  if (!cfg.useDeployerAsAdmin && deployer.address !== ADMIN_ADDR) {
    WARN("Deployer ≠ Admin. Config txs will be signed by deployer.");
    WARN("Ensure deployer holds DEFAULT_ADMIN_ROLE until handoff.");
    console.log();
  }

  // ── Output file ──────────────────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const outPath = path.join(deploymentsDir, `v2_1_${network.name}.json`);
  const record: Record<string, unknown> = {
    network:   network.name,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    config: {
      admin:            ADMIN_ADDR,
      keeper:           KEEPER_ADDR,
      asmFeeBpsPerYear: cfg.asmFeeBpsPerYear,
      seedDepositUSDC:  cfg.seedDepositUSDC.toString(),
    },
    contracts: {} as Record<string, string>,
  };
  const c = record.contracts as Record<string, string>;

  // ── Resume: load existing partial deployment if present ──────────────────
  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>;
    if (existing.contracts && typeof existing.contracts === "object") {
      Object.assign(c, existing.contracts);
      INFO(`Resuming existing deployment — ${Object.keys(c).length} contracts already recorded.`);
      console.log();
    }
  }

  /** Write partial state after every deploy so recovery is possible on failure. */
  function save() {
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  }

  /** Deploy a contract (or reuse existing address if already in record). */
  async function deploy(
    label:       string,
    factoryName: string,
    args:        unknown[],
  ): Promise<string> {
    if (c[label]) {
      console.log(`  ↩  ${label.padEnd(36)} … ${c[label]}  (reused)`);
      return c[label];
    }
    process.stdout.write(`  Deploying ${label.padEnd(36)} … `);
    const factory  = await ethers.getContractFactory(factoryName);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    console.log(addr);
    c[label] = addr;
    save();
    return addr;
  }

  // =========================================================================
  // Step 1 — USDC
  // =========================================================================

  HDR("Step 1 · USDC");
  let usdcAddr: string;
  if (network.name === "base") {
    usdcAddr = cfg.usdc;
    OK("USDC (real Base Mainnet)", usdcAddr);
    c["USDC"] = usdcAddr;
    save();
  } else {
    usdcAddr = await deploy("MockUSDC", "MockUSDC", []);
    INFO("MockUSDC deployed (local / fork only)");
  }

  // =========================================================================
  // Step 2 — PointsLedgerV01
  // =========================================================================

  HDR("Step 2 · PointsLedgerV01");
  const pointsLedgerAddr = await deploy("PointsLedgerV01", "PointsLedgerV01", [
    ADMIN_ADDR,
  ]);
  INFO("PointsLedgerV01 — non-transferable Points ledger for closed beta");

  // =========================================================================
  // Step 3 — YearRingCoreVaultV21
  // =========================================================================

  HDR("Step 3 · YearRingCoreVaultV21");
  const vaultAddr = await deploy("YearRingCoreVaultV21", "YearRingCoreVaultV21", [
    usdcAddr,
    ADMIN_ADDR,
    cfg.vaultName,
    cfg.vaultSymbol,
  ]);
  INFO(`name="${cfg.vaultName}"  symbol="${cfg.vaultSymbol}"`);
  INFO("CoreStrategyManager not yet wired (set in Step 5)");

  // =========================================================================
  // Step 4 — CoreStrategyManagerV21
  // =========================================================================

  HDR("Step 4 · CoreStrategyManagerV21");
  const csmAddr = await deploy("CoreStrategyManagerV21", "CoreStrategyManagerV21", [
    usdcAddr,
    vaultAddr,
    ADMIN_ADDR,
  ]);
  INFO("CSM fee hard-coded to 50 bps/year (CoreStrategyManagerV21.FEE_BPS)");

  // =========================================================================
  // Step 5 — Wire Vault → CoreSM
  // =========================================================================

  HDR("Step 5 · vault.setCoreStrategyManager");
  const vault = await ethers.getContractAt("YearRingCoreVaultV21", vaultAddr);
  {
    const existing = await vault.coreStrategyManager();
    if (existing.toLowerCase() === csmAddr.toLowerCase()) {
      OK("vault.coreStrategyManager", csmAddr);
      INFO("Already wired — skipped");
    } else {
      await (await vault.setCoreStrategyManager(csmAddr)).wait();
      OK("vault.coreStrategyManager", csmAddr);
      INFO("Auto-rebalance now active — subsequent deposits will push excess to CSM");
    }
  }

  // =========================================================================
  // Step 6 — TreasuryV21
  // =========================================================================

  HDR("Step 6 · TreasuryV21");
  const treasuryAddr = await deploy("TreasuryV21", "TreasuryV21", [
    vaultAddr,
    usdcAddr,
    csmAddr,
    ADMIN_ADDR,
  ]);

  // =========================================================================
  // Step 7 — AccessStrategyManagerV21
  // =========================================================================

  HDR("Step 7 · AccessStrategyManagerV21");
  // LockManager address unknown yet; set via setLockManager after Step 8.
  const asmAddr = await deploy("AccessStrategyManagerV21", "AccessStrategyManagerV21", [
    usdcAddr,
    vaultAddr,
    ethers.ZeroAddress,       // lockManager — wired in Step 9
    cfg.asmFeeBpsPerYear,
    ADMIN_ADDR,
  ]);
  INFO(`ASM managementFeeBpsPerYear = ${cfg.asmFeeBpsPerYear} (${cfg.asmFeeBpsPerYear / 100}%)`);

  // =========================================================================
  // Step 8 — LockManagerV21
  // =========================================================================

  HDR("Step 8 · LockManagerV21");
  // yrUSDC_ == coreVault_ because the vault IS the yrUSDC ERC-20 (ERC4626 share).
  const lockManagerAddr = await deploy("LockManagerV21", "LockManagerV21", [
    vaultAddr,           // yrUSDC (vault share token)
    vaultAddr,           // coreVault (for convertToAssets — same contract)
    pointsLedgerAddr,
    ADMIN_ADDR,
  ]);

  // =========================================================================
  // Step 9 — Wire ASM → LockManager
  // =========================================================================

  HDR("Step 9 · accessStrategyManager.setLockManager");
  const accessStrategyManager = await ethers.getContractAt("AccessStrategyManagerV21", asmAddr);
  {
    const existing = await accessStrategyManager.lockManager();
    if (existing.toLowerCase() === lockManagerAddr.toLowerCase()) {
      OK("asm.lockManager", lockManagerAddr);
      INFO("Already wired — skipped");
    } else {
      await (await accessStrategyManager.setLockManager(lockManagerAddr)).wait();
      OK("asm.lockManager", lockManagerAddr);
    }
  }

  // =========================================================================
  // Step 10 — RebateManagerV21
  // =========================================================================

  HDR("Step 10 · RebateManagerV21");
  const rebateManagerAddr = await deploy("RebateManagerV21", "RebateManagerV21", [
    vaultAddr,
    lockManagerAddr,
    treasuryAddr,
    ADMIN_ADDR,
  ]);

  // =========================================================================
  // Step 11 — EligibilityModuleV21
  // =========================================================================

  HDR("Step 11 · EligibilityModuleV21");
  const eligibilityModuleAddr = await deploy("EligibilityModuleV21", "EligibilityModuleV21", [
    lockManagerAddr,
    pointsLedgerAddr,
    ADMIN_ADDR,
  ]);
  INFO("Deployed wired to lockManager + pointsLedger");
  INFO("Closed-beta defaults: all thresholds=0, allowlistRequired=false");

  // =========================================================================
  // Step 12 — PortfolioLensV21
  // =========================================================================

  HDR("Step 12 · PortfolioLensV21");
  const lensAddr = await deploy("PortfolioLensV21", "PortfolioLensV21", [
    vaultAddr,
    lockManagerAddr,
    eligibilityModuleAddr,
    pointsLedgerAddr,
    treasuryAddr,
  ]);

  // =========================================================================
  // Step 13 — Strategy (CoreSM)
  // =========================================================================

  HDR("Step 13 · Strategy for CoreStrategyManagerV21");
  let coreSMStrategyAddr: string;
  if (network.name === "base") {
    coreSMStrategyAddr = await deploy(
      "AaveUSDCStrategyV21 (CoreSM)",
      "AaveUSDCStrategyV21",
      [usdcAddr, csmAddr, cfg.aavePool, cfg.aaveAUsdc, cfg.aaveReferralCode],
    );
    INFO("AaveUSDCStrategyV21 → Aave V3 Pool on Base Mainnet");
  } else {
    coreSMStrategyAddr = await deploy(
      "MockStrategyV21 (CoreSM)",
      "MockStrategyV21",
      [usdcAddr, csmAddr, ADMIN_ADDR],
    );
    INFO("MockStrategyV21 (local / fork only)");
  }

  // =========================================================================
  // Step 14 — Strategy (ASM)
  // =========================================================================

  HDR("Step 14 · Strategy for AccessStrategyManagerV21");
  let asmStrategyAddr: string;
  if (network.name === "base") {
    asmStrategyAddr = await deploy(
      "AaveUSDCStrategyV21 (ASM)",
      "AaveUSDCStrategyV21",
      [usdcAddr, asmAddr, cfg.aavePool, cfg.aaveAUsdc, cfg.aaveReferralCode],
    );
    INFO("AaveUSDCStrategyV21 → Aave V3 Pool on Base Mainnet");
  } else {
    asmStrategyAddr = await deploy(
      "MockStrategyV21 (ASM)",
      "MockStrategyV21",
      [usdcAddr, asmAddr, ADMIN_ADDR],
    );
    INFO("MockStrategyV21 (local / fork only)");
  }

  // =========================================================================
  // Step 15 — Role grants & protocol wiring
  // =========================================================================

  HDR("Step 15 · Role grants & protocol wiring");

  const csm          = await ethers.getContractAt("CoreStrategyManagerV21",      csmAddr);
  const lockManager  = await ethers.getContractAt("LockManagerV21",              lockManagerAddr);
  const treasury     = await ethers.getContractAt("TreasuryV21",                 treasuryAddr);
  const rebateMgr    = await ethers.getContractAt("RebateManagerV21",            rebateManagerAddr);
  const eligMod      = await ethers.getContractAt("EligibilityModuleV21",        eligibilityModuleAddr);
  const pointsLedger = await ethers.getContractAt("PointsLedgerV01",             pointsLedgerAddr);

  // ── CoreSM ────────────────────────────────────────────────────────────────
  process.stdout.write("  csm.setFeeReceiver(treasury)               … ");
  await (await csm.setFeeReceiver(treasuryAddr)).wait();
  console.log("done");

  process.stdout.write("  csm.setStrategy(coreSMStrategy)            … ");
  await (await csm.setStrategy(coreSMStrategyAddr)).wait();
  console.log("done");

  process.stdout.write("  csm.grantRole(KEEPER_ROLE, keeper)         … ");
  await (await csm.grantRole(KEEPER_ROLE, KEEPER_ADDR)).wait();
  console.log("done");

  // ── ASM ───────────────────────────────────────────────────────────────────
  process.stdout.write("  accessStrategyManager.setFeeReceiver(treasury)               … ");
  await (await accessStrategyManager.setFeeReceiver(treasuryAddr)).wait();
  console.log("done");

  process.stdout.write("  accessStrategyManager.setStrategy(asmStrategy)               … ");
  await (await accessStrategyManager.setStrategy(asmStrategyAddr)).wait();
  console.log("done");

  process.stdout.write("  accessStrategyManager.grantRole(KEEPER_ROLE, keeper)         … ");
  await (await accessStrategyManager.grantRole(KEEPER_ROLE, KEEPER_ADDR)).wait();
  console.log("done");

  // ── Treasury ─────────────────────────────────────────────────────────────
  process.stdout.write("  treasury.setRebateManager(rebateManager)   … ");
  await (await treasury.setRebateManager(rebateManagerAddr)).wait();
  console.log("done");

  process.stdout.write("  treasury.addAccessManager(asmAddr)                 … ");
  {
    const count = await treasury.accessManagerCount();
    let alreadyAdded = false;
    for (let i = 0n; i < count; i++) {
      if ((await treasury.accessManagerAt(i)).toLowerCase() === asmAddr.toLowerCase()) {
        alreadyAdded = true; break;
      }
    }
    if (alreadyAdded) { console.log("skipped (already registered)"); }
    else { await (await treasury.addAccessManager(asmAddr)).wait(); console.log("done"); }
  }

  // ── LockManager ──────────────────────────────────────────────────────────
  process.stdout.write("  lockManager.grantRole(REBATE_MANAGER)      … ");
  await (await lockManager.grantRole(REBATE_MANAGER_ROLE, rebateManagerAddr)).wait();
  console.log("done");

  process.stdout.write("  lockManager.grantRole(KEEPER_ROLE, keeper) … ");
  await (await lockManager.grantRole(KEEPER_ROLE, KEEPER_ADDR)).wait();
  console.log("done");

  process.stdout.write("  lockManager.setEligibilityModule(em)       … ");
  await (await lockManager.setEligibilityModule(eligibilityModuleAddr)).wait();
  console.log("done");

  // ── PointsLedger ─────────────────────────────────────────────────────────
  process.stdout.write("  pointsLedger.grantRole(MINTER, lockMgr)   … ");
  await (await pointsLedger.grantRole(POINTS_MINTER_ROLE, lockManagerAddr)).wait();
  console.log("done");

  process.stdout.write("  pointsLedger.grantRole(BURNER, lockMgr)   … ");
  await (await pointsLedger.grantRole(POINTS_BURNER_ROLE, lockManagerAddr)).wait();
  console.log("done");

  // ── EligibilityModule — closed-beta defaults ──────────────────────────────
  // Enable ASM with all thresholds = 0 (permissionless entry within lock rules).
  // Tighten via setManagerConfig post-launch if Points gate is needed.
  process.stdout.write("  eligMod.setManagerConfig(asmAddr, open)        … ");
  await (await eligMod.setManagerConfig(asmAddr, true, 0, 0, false)).wait();
  console.log("done");

  // ── Vault — KEEPER_ROLE + allowlist ──────────────────────────────────────
  process.stdout.write("  vault.grantRole(KEEPER_ROLE, keeper)       … ");
  await (await vault.grantRole(KEEPER_ROLE, KEEPER_ADDR)).wait();
  console.log("done");

  // Treasury must deposit yrUSDC ↔ vault for fee settlement
  process.stdout.write("  vault.setAllowlist(treasury, true)         … ");
  await (await vault.setAllowlist(treasuryAddr, true)).wait();
  console.log("done");

  // ASM deposits USDC → vault on exit() (gets yrUSDC back for user)
  process.stdout.write("  vault.setAllowlist(asmAddr, true)              … ");
  await (await vault.setAllowlist(asmAddr, true)).wait();
  console.log("done");

  // Deployer must be allowlisted for the seed deposit below
  if (deployer.address !== ADMIN_ADDR) {
    process.stdout.write("  vault.setAllowlist(deployer, true)         … ");
    await (await vault.setAllowlist(deployer.address, true)).wait();
    console.log("done");
  }

  // Admin must be allowlisted (seed deposit is from admin address)
  process.stdout.write("  vault.setAllowlist(admin, true)            … ");
  await (await vault.setAllowlist(ADMIN_ADDR, true)).wait();
  console.log("done");

  INFO("Role grants complete");

  // =========================================================================
  // Step 16 — Seed deposit (establishes PPS = 1 before any user can deposit)
  // =========================================================================

  HDR("Step 16 · Seed deposit — 10 USDC");

  const usdc = await ethers.getContractAt("IERC20", usdcAddr);
  const seedAmt = cfg.seedDepositUSDC;

  if (network.name !== "base") {
    // Local / fork: mint USDC to deployer then deposit
    const mockUsdc = await ethers.getContractAt("MockUSDC", usdcAddr);
    process.stdout.write("  MockUSDC.mint(deployer, 10 USDC)           … ");
    await (await mockUsdc.mint(deployer.address, seedAmt)).wait();
    console.log("done");
  }

  const deployerBalance = await usdc.balanceOf(deployer.address);
  if (deployerBalance < seedAmt) {
    WARN(`Deployer USDC balance (${deployerBalance}) < seed amount (${seedAmt})`);
    WARN("Skipping seed deposit. Run manually: vault.deposit(10_000_000, deployer)");
    WARN("IMPORTANT: Vault PPS is undefined until seeded. Block user deposits.");
  } else {
    process.stdout.write("  usdc.approve(vault, 10 USDC)               … ");
    await (await usdc.approve(vaultAddr, seedAmt)).wait();
    console.log("done");

    process.stdout.write("  vault.deposit(10 USDC, deployer)           … ");
    await (await vault.deposit(seedAmt, deployer.address)).wait();
    console.log("done");

    const totalAssets = await vault.totalAssets();
    INFO(`Vault totalAssets after seed = ${totalAssets} (6-dec USDC)`);
    INFO("PPS established: 1 USDC = 1 yrUSDC (12-decimal offset applied)");
  }

  // =========================================================================
  // Summary
  // =========================================================================

  console.log("\n" + "=".repeat(70));
  console.log("  V2.1 DEPLOYMENT COMPLETE");
  console.log("=".repeat(70));
  console.log();
  console.log("  Core contracts:");
  OK("USDC",                        usdcAddr);
  OK("PointsLedgerV01",             pointsLedgerAddr);
  OK("YearRingCoreVaultV21",        vaultAddr);
  OK("CoreStrategyManagerV21",      csmAddr);
  OK("TreasuryV21",                 treasuryAddr);
  OK("AccessStrategyManagerV21",  asmAddr);
  OK("LockManagerV21",              lockManagerAddr);
  OK("RebateManagerV21",            rebateManagerAddr);
  OK("EligibilityModuleV21",        eligibilityModuleAddr);
  OK("PortfolioLensV21",            lensAddr);
  console.log();
  console.log("  Strategies:");
  OK("CoreSM Strategy",             coreSMStrategyAddr);
  OK("ASM Strategy",                asmStrategyAddr);
  console.log();
  console.log("  Roles:");
  console.log(`  Admin   : ${ADMIN_ADDR}`);
  console.log(`  Keeper  : ${KEEPER_ADDR}`);
  console.log();
  console.log("=".repeat(70));
  console.log(`  Saved → ${outPath}`);
  console.log();
  console.log("  Post-deploy checklist:");
  console.log("    □  Verify contracts on Basescan");
  console.log("    □  Transfer DEFAULT_ADMIN_ROLE to multisig (renounce deployer)");
  console.log("    □  Add beta user addresses via vault.setAllowlist(user, true)");
  console.log("    □  Optional: tighten eligibilityModule thresholds if Points gate needed");
  console.log("    □  Fund deployer/treasury with USDC for first rebate settlement");
  console.log();

  // Final save with completed flag
  (record as Record<string, unknown>).completed = true;
  save();
}

main().catch(err => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
