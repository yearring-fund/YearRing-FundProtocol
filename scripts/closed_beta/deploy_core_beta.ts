/**
 * deploy_core_beta.ts — YearRing Closed Beta: Full Stack Deployment
 *
 * Deploys ALL contracts for the closed beta in dependency order.
 * On Base Mainnet  → uses real USDC + AaveV3StrategyV01
 * On hardhat/local → deploys MockUSDC + DummyStrategy (no Aave required)
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/deploy_core_beta.ts --network base
 *   npx hardhat run scripts/closed_beta/deploy_core_beta.ts --network hardhat
 *   npx hardhat run scripts/closed_beta/deploy_core_beta.ts --network localhost
 *
 * Output:
 *   deployments/closed_beta_<network>.json   ← addresses + config snapshot
 *
 * After running this script, run:
 *   setup_roles.ts   → wire bindings and roles
 *   verify_deployment.ts → confirm all wiring
 *   export_addresses.ts  → push addresses to frontend
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getClosedBetaConfig } from "./config";

const SEP = () => console.log("-".repeat(68));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK  = (label: string, addr: string) =>
  console.log(`  ✓  ${label.padEnd(36)} ${addr}`);

async function main() {
  const cfg = getClosedBetaConfig(network.name);
  const [deployer] = await ethers.getSigners();

  // Role addresses:
  //   - useDeployerAsAdmin=true (local/fork): deployer holds all roles, env vars ignored.
  //   - useDeployerAsAdmin=false (mainnet): env vars required; must be multisig addresses.
  let ADMIN_ADDR:    string;
  let GUARDIAN_ADDR: string;
  let TREASURY_ADDR_OVERRIDE: string | undefined;

  if (cfg.useDeployerAsAdmin) {
    ADMIN_ADDR    = deployer.address;
    GUARDIAN_ADDR = deployer.address;
    TREASURY_ADDR_OVERRIDE = undefined;
  } else {
    ADMIN_ADDR    = process.env.ADMIN_ADDRESS    || deployer.address;
    GUARDIAN_ADDR = process.env.GUARDIAN_ADDRESS || deployer.address;
    TREASURY_ADDR_OVERRIDE = process.env.TREASURY_ADDRESS;
  }

  console.log("\n" + "=".repeat(68));
  console.log("  YearRing Fund Protocol — Closed Beta Deployment");
  console.log("=".repeat(68));
  console.log("  Network  :", network.name);
  console.log("  Deployer :", deployer.address);
  console.log("  Admin    :", ADMIN_ADDR);
  console.log("  Guardian :", GUARDIAN_ADDR);
  if (TREASURY_ADDR_OVERRIDE) console.log("  Treasury :", TREASURY_ADDR_OVERRIDE, "(override)");
  console.log("=".repeat(68) + "\n");

  // ── Deployment record ───────────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "../../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const outPath = path.join(deploymentsDir, `closed_beta_${network.name}.json`);
  const record: Record<string, unknown> = {
    network:   network.name,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    config: {
      admin:    ADMIN_ADDR,
      guardian: GUARDIAN_ADDR,
    },
    contracts: {} as Record<string, string>,
  };
  const c = record.contracts as Record<string, string>;

  function save() {
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  }

  async function deploy(label: string, factoryName: string, args: unknown[]): Promise<string> {
    process.stdout.write(`  Deploying ${label.padEnd(34)} … `);
    const factory  = await ethers.getContractFactory(factoryName);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    console.log(addr);
    c[label] = addr;
    save();
    return addr;
  }

  // ── Step 1: USDC ────────────────────────────────────────────────────────
  HDR("Step 1 · USDC");
  let usdcAddr: string;
  if (network.name === "base") {
    usdcAddr = cfg.usdc;
    OK("USDC (real Base mainnet)", usdcAddr);
    c["USDC"] = usdcAddr;
  } else {
    usdcAddr = await deploy("MockUSDC", "MockUSDC", []);
    OK("USDC (MockUSDC local)", usdcAddr);
  }

  // ── Step 2: TreasuryV02 ─────────────────────────────────────────────────
  HDR("Step 2 · TreasuryV02");
  const treasuryAddr = await deploy("TreasuryV02", "TreasuryV02", [ADMIN_ADDR]);

  // Use TREASURY_ADDRESS override for Points premint target, else use TreasuryV02
  const pointsRecipient = TREASURY_ADDR_OVERRIDE ?? treasuryAddr;

  // ── Step 3: PointsToken ─────────────────────────────────────────────────
  HDR("Step 3 · PointsToken (YRPTS)");
  const pointsAddr = await deploy("PointsToken", "PointsToken", [
    cfg.pointsTokenName,
    cfg.pointsTokenSymbol,
    cfg.pointsTotalSupply,
    pointsRecipient,   // preminted directly to TreasuryV02
  ]);
  console.log(`  ℹ  20,000,000 YRPTS preminted to ${pointsRecipient}`);
  c["PointsRecipient"] = pointsRecipient;

  // ── Step 4: YearRingCoreVaultV01 ────────────────────────────────────────
  HDR("Step 4 · YearRingCoreVaultV01");
  const vaultAddr = await deploy("YearRingCoreVaultV01", "YearRingCoreVaultV01", [
    usdcAddr,
    cfg.vaultName,
    cfg.vaultSymbol,
    treasuryAddr,
    ADMIN_ADDR,
    cfg.mgmtFeeBpsPerMonth,
  ]);
  console.log(`  ℹ  symbol=${cfg.vaultSymbol}  mgmtFee=${cfg.mgmtFeeBpsPerMonth} bps/month`);

  // ── Step 5: LockLedgerV02 ───────────────────────────────────────────────
  HDR("Step 5 · LockLedgerV02");
  const ledgerAddr = await deploy("LockLedgerV02", "LockLedgerV02", [
    vaultAddr,      // vaultShares_ = yrCORE ERC20
    ADMIN_ADDR,
    GUARDIAN_ADDR,
  ]);

  // ── Step 6: LockBenefitV02 ──────────────────────────────────────────────
  HDR("Step 6 · LockBenefitV02");
  const benefitAddr = await deploy("LockBenefitV02", "LockBenefitV02", [ledgerAddr]);

  // ── Step 7: LockPointsRebateManagerV02 ─────────────────────────────────
  HDR("Step 7 · LockPointsRebateManagerV02");
  const managerAddr = await deploy("LockPointsRebateManagerV02", "LockPointsRebateManagerV02", [
    ledgerAddr,    // ledger_
    benefitAddr,   // benefit_
    pointsAddr,    // pointsToken_
    vaultAddr,     // vaultShares_ (yrCORE ERC20 = vault contract)
    vaultAddr,     // vault_ (used for convertToAssets)
    treasuryAddr,  // treasury_
    ADMIN_ADDR,    // admin_
    GUARDIAN_ADDR, // emergency_
  ]);

  // ── Step 8: BeneficiaryModuleV02 ────────────────────────────────────────
  HDR("Step 8 · BeneficiaryModuleV02");
  const beneficiaryAddr = await deploy("BeneficiaryModuleV02", "BeneficiaryModuleV02", [
    ledgerAddr,
    ADMIN_ADDR,
  ]);

  // ── Step 9: UserStateEngineV02 ──────────────────────────────────────────
  HDR("Step 9 · UserStateEngineV02");
  const userStateAddr = await deploy("UserStateEngineV02", "UserStateEngineV02", [ledgerAddr]);

  // ── Step 10: MetricsLayerV02 ────────────────────────────────────────────
  HDR("Step 10 · MetricsLayerV02");
  const metricsAddr = await deploy("MetricsLayerV02", "MetricsLayerV02", [
    vaultAddr,
    ledgerAddr,
  ]);

  // ── Step 11: GovernanceSignalV02 ────────────────────────────────────────
  HDR("Step 11 · GovernanceSignalV02");
  const governanceAddr = await deploy("GovernanceSignalV02", "GovernanceSignalV02", [
    pointsAddr,
    cfg.votingThreshold,
    cfg.votingPeriod,
    ADMIN_ADDR,
  ]);
  console.log(`  ℹ  votingThreshold=${ethers.formatEther(cfg.votingThreshold)} YRPTS  votingPeriod=${Number(cfg.votingPeriod) / 86400}d`);

  // ── Step 12: ClaimLedger ────────────────────────────────────────────────
  HDR("Step 12 · ClaimLedger");
  const claimLedgerAddr = await deploy("ClaimLedger", "ClaimLedger", [ADMIN_ADDR]);
  console.log("  ℹ  ClaimLedger is not part of the main exit path (V2 uses claimExitAssets)");

  // ── Step 13: StrategyManagerV01 ─────────────────────────────────────────
  HDR("Step 13 · StrategyManagerV01");
  const stratMgrAddr = await deploy("StrategyManagerV01", "StrategyManagerV01", [
    usdcAddr,    // underlying_
    vaultAddr,   // vault_
    ADMIN_ADDR,  // admin_
  ]);

  // ── Step 14: Strategy ───────────────────────────────────────────────────
  HDR("Step 14 · Strategy");
  let strategyAddr: string;
  if (network.name === "base") {
    strategyAddr = await deploy("AaveV3StrategyV01", "AaveV3StrategyV01", [
      usdcAddr,
      stratMgrAddr,
      cfg.aavePool,
      cfg.aUsdc,
      cfg.aaveReferralCode,
    ]);
    console.log("  ℹ  AaveV3StrategyV01 bound to Aave Pool on Base Mainnet");
  } else {
    strategyAddr = await deploy("DummyStrategy", "DummyStrategy", [usdcAddr]);
    console.log("  ℹ  DummyStrategy (local/fork only — simulates yield via admin mint)");
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  console.log("  DEPLOYMENT COMPLETE — All contracts deployed");
  console.log("=".repeat(68));
  console.log(`  USDC                       ${usdcAddr}`);
  console.log(`  TreasuryV02                ${treasuryAddr}`);
  console.log(`  PointsToken (YRPTS)        ${pointsAddr}`);
  console.log(`  YearRingCoreVaultV01       ${vaultAddr}`);
  console.log(`  LockLedgerV02              ${ledgerAddr}`);
  console.log(`  LockBenefitV02             ${benefitAddr}`);
  console.log(`  LockPointsRebateManagerV02 ${managerAddr}`);
  console.log(`  BeneficiaryModuleV02       ${beneficiaryAddr}`);
  console.log(`  UserStateEngineV02         ${userStateAddr}`);
  console.log(`  MetricsLayerV02            ${metricsAddr}`);
  console.log(`  GovernanceSignalV02        ${governanceAddr}`);
  console.log(`  ClaimLedger                ${claimLedgerAddr}`);
  console.log(`  StrategyManagerV01         ${stratMgrAddr}`);
  console.log(`  Strategy                   ${strategyAddr}`);
  console.log("=".repeat(68));
  console.log(`\n  Saved → ${outPath}`);
  console.log("\n  Next steps:");
  console.log("    1. npx hardhat run scripts/closed_beta/setup_roles.ts --network " + network.name);
  console.log("    2. npx hardhat run scripts/closed_beta/verify_deployment.ts --network " + network.name);
  console.log("    3. npx hardhat run scripts/closed_beta/export_addresses.ts --network " + network.name);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
