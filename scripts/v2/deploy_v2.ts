/**
 * deploy_v2.ts — V2 Commitment Layer deployment (minimal demo build)
 *
 * Default deploys only modules required for the live demo:
 *   RewardToken, LockLedgerV02, LockBenefitV02, LockRewardManagerV02,
 *   BeneficiaryModuleV02, UserStateEngineV02, MetricsLayerV02
 *
 * Optional modules (GovernanceSignalV02):
 *   Set DEPLOY_OPTIONAL_MODULES=true to include.
 *
 * Deprecated (never deploy): LockPointsV02
 *
 * Idempotent by default — skips modules already present in deployment JSON.
 *   Set FORCE_REDEPLOY=true to re-deploy all V2 modules.
 *
 * Usage:
 *   npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia
 *   DEPLOY_OPTIONAL_MODULES=true npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia
 *   FORCE_REDEPLOY=true npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { v2DemoConfig } from "../config";

const SEP  = () => console.log("-".repeat(62));
const HDR  = (s: string) => { SEP(); console.log("  " + s); SEP(); };

const FORCE    = process.env.FORCE_REDEPLOY          === "true";
const OPTIONAL = process.env.DEPLOY_OPTIONAL_MODULES === "true";

async function main() {
  const [deployer] = await ethers.getSigners();

  // ── Load deployment JSON ─────────────────────────────────────────────────
  const deploymentsDir  = path.join(__dirname, "../../deployments");
  const deploymentsPath = path.join(deploymentsDir, `${network.name}.json`);

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `No deployment file at ${deploymentsPath}.\n` +
      `Run  npx hardhat run scripts/deploy.ts --network ${network.name}  first.`
    );
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  if (!dep.contracts) dep.contracts = {};
  const c = dep.contracts;

  // ── V01 presence checks ──────────────────────────────────────────────────
  const missing = (["FundVaultV01", "StrategyManagerV01"] as const)
    .filter(k => !c[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing V01 contracts: ${missing.join(", ")}.\n` +
      `Run  npx hardhat run scripts/deploy.ts --network ${network.name}  first.`
    );
  }
  if (!c["DummyStrategy"] && !c["AaveV3StrategyV01"]) {
    throw new Error(
      `Missing strategy contract (DummyStrategy or AaveV3StrategyV01).\n` +
      `Run  npx hardhat run scripts/deploy.ts --network ${network.name}  first.`
    );
  }

  const vaultAddress = c.FundVaultV01;
  const admin    = dep.config?.admin    || deployer.address;
  const guardian = dep.config?.guardian || deployer.address;
  const treasury = dep.config?.treasury || deployer.address;

  console.log("\n" + "=".repeat(62));
  console.log("  YearRing-FundProtocol V2 — Contract Deployment");
  console.log(`  Mode: demo-minimal${OPTIONAL ? " + optional modules" : ""}`);
  if (FORCE) console.log("  ⚠  FORCE_REDEPLOY=true — re-deploying all V2 modules");
  console.log("=".repeat(62));
  console.log("Network   :", network.name);
  console.log("Deployer  :", deployer.address);
  console.log("Vault     :", vaultAddress);
  console.log("Admin     :", admin);
  console.log("Treasury  :", treasury);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function save() {
    fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  }

  // Deploy a contract or reuse existing address.
  // Returns [address, isNew]
  async function deployOrReuse(
    key: string,
    deployFn: () => Promise<string>
  ): Promise<[string, boolean]> {
    if (c[key] && !FORCE) {
      console.log(`  ${key}: already deployed at ${c[key]} (skipping)`);
      return [c[key], false];
    }
    const addr = await deployFn();
    c[key] = addr;
    save();   // incremental write
    return [addr, true];
  }

  // ── 1. RewardToken ───────────────────────────────────────────────────────
  HDR("1 / 7   RewardToken");
  const [rewardTokenAddress] = await deployOrReuse("RewardToken", async () => {
    const rwt = await (await ethers.getContractFactory("RewardToken")).deploy(
      "YearRing Reward Token", "RWT", v2DemoConfig.rewardTotalSupply, treasury
    );
    await rwt.waitForDeployment();
    const addr = await rwt.getAddress();
    console.log("  RewardToken       :", addr);
    console.log("  Total supply      :", ethers.formatEther(v2DemoConfig.rewardTotalSupply), "RWT");
    return addr;
  });

  // ── 2. LockLedgerV02 ─────────────────────────────────────────────────────
  HDR("2 / 7   LockLedgerV02");
  const [ledgerAddress] = await deployOrReuse("LockLedgerV02", async () => {
    const ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
      vaultAddress, admin, guardian
    );
    await ledger.waitForDeployment();
    const addr = await ledger.getAddress();
    console.log("  LockLedgerV02     :", addr);
    return addr;
  });

  // ── 3. LockBenefitV02 ────────────────────────────────────────────────────
  HDR("3 / 7   LockBenefitV02");
  const [benefitAddress] = await deployOrReuse("LockBenefitV02", async () => {
    const benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(ledgerAddress);
    await benefit.waitForDeployment();
    const addr = await benefit.getAddress();
    console.log("  LockBenefitV02    :", addr);
    return addr;
  });

  // ── 4. LockRewardManagerV02 ──────────────────────────────────────────────
  HDR("4 / 7   LockRewardManagerV02");
  const [lockMgrAddress] = await deployOrReuse("LockRewardManagerV02", async () => {
    const lockMgr = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
      ledgerAddress, benefitAddress, rewardTokenAddress,
      vaultAddress,  // vaultShares_
      vaultAddress,  // vault_ (fee reading)
      treasury, admin, guardian
    );
    await lockMgr.waitForDeployment();
    const addr = await lockMgr.getAddress();
    console.log("  LockRewardMgr     :", addr);
    return addr;
  });

  // ── 5. BeneficiaryModuleV02 ──────────────────────────────────────────────
  HDR("5 / 7   BeneficiaryModuleV02");
  await deployOrReuse("BeneficiaryModuleV02", async () => {
    const benModule = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
      ledgerAddress, admin
    );
    await benModule.waitForDeployment();
    const addr = await benModule.getAddress();
    console.log("  BeneficiaryModule :", addr);
    return addr;
  });

  // ── 6. View modules ───────────────────────────────────────────────────────
  HDR("6 / 7   View modules (UserStateEngineV02 + MetricsLayerV02)");
  await deployOrReuse("UserStateEngineV02", async () => {
    const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(ledgerAddress);
    await engine.waitForDeployment();
    const addr = await engine.getAddress();
    console.log("  UserStateEngine   :", addr);
    return addr;
  });

  await deployOrReuse("MetricsLayerV02", async () => {
    const metrics = await (await ethers.getContractFactory("MetricsLayerV02")).deploy(
      vaultAddress, ledgerAddress
    );
    await metrics.waitForDeployment();
    const addr = await metrics.getAddress();
    console.log("  MetricsLayerV02   :", addr);
    return addr;
  });

  // ── 7. Optional modules ───────────────────────────────────────────────────
  HDR("7 / 7   Optional modules" + (OPTIONAL ? "" : " (skipped — set DEPLOY_OPTIONAL_MODULES=true to include)"));
  // LockPointsV02 — DEPRECATED, never deploy
  if (OPTIONAL) {
    await deployOrReuse("GovernanceSignalV02", async () => {
      const governance = await (await ethers.getContractFactory("GovernanceSignalV02")).deploy(
        rewardTokenAddress, v2DemoConfig.votingThreshold, Number(v2DemoConfig.votingPeriod), admin
      );
      await governance.waitForDeployment();
      const addr = await governance.getAddress();
      console.log("  GovernanceSignal  :", addr);
      return addr;
    });
  } else {
    console.log("  GovernanceSignalV02: not deployed (optional)");
  }

  // ── Deployment metadata ───────────────────────────────────────────────────
  dep.v2 = {
    mode:                   "demo-minimal",
    optionalModulesDeployed: OPTIONAL,
    deployedAt:              new Date().toISOString(),
    deployedBy:              deployer.address,
  };
  save();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(62));
  console.log("  V2 Deployment complete.");
  console.log("  Mode    : " + dep.v2.mode + (OPTIONAL ? " + optional" : ""));
  console.log("  Saved   :", deploymentsPath);
  console.log("  Next    : npx hardhat run scripts/v2/setup_v2.ts --network", network.name);
  console.log("=".repeat(62));

  // Print newly-deployed addresses
  const minimalKeys = [
    "RewardToken", "LockLedgerV02", "LockBenefitV02", "LockRewardManagerV02",
    "BeneficiaryModuleV02", "UserStateEngineV02", "MetricsLayerV02",
  ];
  const optionalKeys = ["GovernanceSignalV02"]; // LockPointsV02 deprecated
  const allKeys = OPTIONAL ? [...minimalKeys, ...optionalKeys] : minimalKeys;
  const summary: Record<string, string> = {};
  for (const k of allKeys) { if (c[k]) summary[k] = c[k]; }
  console.log("\nV2 Contract addresses:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
