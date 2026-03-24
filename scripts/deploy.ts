/**
 * deploy.ts — FinancialBase V01 full deployment
 *
 * Deploys:
 *   MockUSDC (local only)  →  FundVaultV01  →  StrategyManagerV01
 *   →  AaveV3StrategyV01 (mainnet/testnet) or DummyStrategy (local)
 *
 * Wire-up:
 *   vault.setModules(strategyManager)
 *   vault.setExternalTransfersEnabled(true)
 *   vault.setReserveRatioBps(...)
 *   vault.setMgmtFeeBpsPerMonth(...)
 *   strategyManager: pause → setStrategy → unpause
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network hardhat
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 *   npx hardhat run scripts/deploy.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { getConfig } from "./config";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const cfg = getConfig(network.name);
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------
  const admin    = cfg.useDeployerAsAdmin ? deployer.address : (process.env.ADMIN_ADDRESS    || "");
  const guardian = cfg.useDeployerAsAdmin ? deployer.address : (process.env.GUARDIAN_ADDRESS || "");
  const treasury = cfg.useDeployerAsAdmin ? deployer.address : (process.env.TREASURY_ADDRESS || "");

  if (!admin || !guardian || !treasury) {
    throw new Error("ADMIN_ADDRESS, GUARDIAN_ADDRESS, TREASURY_ADDRESS must be set in .env");
  }

  console.log("=".repeat(60));
  console.log("FinancialBase V01 — Deployment");
  console.log("=".repeat(60));
  console.log("Network  :", network.name);
  console.log("Deployer :", deployer.address);
  console.log("Admin    :", admin);
  console.log("Guardian :", guardian);
  console.log("Treasury :", treasury);
  console.log("-".repeat(60));

  // ---------------------------------------------------------------------------
  // 1. USDC
  // ---------------------------------------------------------------------------
  let usdcAddress: string;

  if (isLocal) {
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log("MockUSDC            :", usdcAddress);
  } else {
    usdcAddress = cfg.usdc;
    if (!usdcAddress) throw new Error("usdc address missing in config");
    console.log("USDC (existing)     :", usdcAddress);
  }

  // ---------------------------------------------------------------------------
  // 2. FundVaultV01
  // ---------------------------------------------------------------------------
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    usdcAddress,
    "FinancialBase Fund",
    "fbUSDC",
    treasury,
    guardian,
    admin
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("FundVaultV01        :", vaultAddress);

  // ---------------------------------------------------------------------------
  // 3. StrategyManagerV01
  // ---------------------------------------------------------------------------
  const manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
    usdcAddress,
    vaultAddress,
    admin,
    guardian
  );
  await manager.waitForDeployment();
  const managerAddress = await manager.getAddress();
  console.log("StrategyManagerV01  :", managerAddress);

  // ---------------------------------------------------------------------------
  // 4. Strategy  (AaveV3StrategyV01 on live networks, DummyStrategy locally)
  // ---------------------------------------------------------------------------
  let strategyAddress: string;
  let strategyName: string;

  if (isLocal) {
    const dummy = await (await ethers.getContractFactory("DummyStrategy")).deploy(usdcAddress);
    await dummy.waitForDeployment();
    strategyAddress = await dummy.getAddress();
    strategyName = "DummyStrategy";
  } else {
    if (!cfg.aavePool || !cfg.aUsdc) {
      throw new Error("aavePool and aUsdc must be set in config for live networks");
    }
    const aave = await (await ethers.getContractFactory("AaveV3StrategyV01")).deploy(
      usdcAddress,
      managerAddress,
      cfg.aavePool,
      cfg.aUsdc,
      cfg.aaveReferralCode
    );
    await aave.waitForDeployment();
    strategyAddress = await aave.getAddress();
    strategyName = "AaveV3StrategyV01";
  }
  console.log(`${strategyName.padEnd(20)}:`, strategyAddress);

  // ---------------------------------------------------------------------------
  // 5. Wire-up
  // ---------------------------------------------------------------------------
  console.log("-".repeat(60));
  console.log("Wiring up...");

  // 5a. Set StrategyManager in vault
  await (await vault.setModules(managerAddress)).wait();
  console.log("  vault.setModules ✓");

  // 5b. Enable external transfers
  await (await vault.setExternalTransfersEnabled(true)).wait();
  console.log("  vault.setExternalTransfersEnabled(true) ✓");

  // 5c. Reserve ratio
  await (await vault.setReserveRatioBps(cfg.reserveRatioBps)).wait();
  console.log(`  vault.setReserveRatioBps(${cfg.reserveRatioBps}) ✓`);

  // 5d. Management fee
  if (cfg.mgmtFeeBpsPerMonth > 0) {
    await (await vault.setMgmtFeeBpsPerMonth(cfg.mgmtFeeBpsPerMonth)).wait();
    console.log(`  vault.setMgmtFeeBpsPerMonth(${cfg.mgmtFeeBpsPerMonth}) ✓`);
  }

  // 5e. Set strategy in manager (requires pause)
  await (await manager.pause()).wait();
  await (await manager.setStrategy(strategyAddress)).wait();
  await (await manager.unpause()).wait();
  console.log("  manager: pause → setStrategy → unpause ✓");

  // ---------------------------------------------------------------------------
  // 6. Save deployment
  // ---------------------------------------------------------------------------
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const deployment = {
    network: network.name,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MockUSDC:           isLocal ? usdcAddress : undefined,
      USDC:               usdcAddress,
      FundVaultV01:       vaultAddress,
      StrategyManagerV01: managerAddress,
      [strategyName]:     strategyAddress,
    },
    config: {
      admin,
      guardian,
      treasury,
      reserveRatioBps:      cfg.reserveRatioBps,
      mgmtFeeBpsPerMonth:   cfg.mgmtFeeBpsPerMonth,
    },
  };

  const outPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("-".repeat(60));
  console.log("Deployment saved to:", outPath);
  console.log("\n=== Summary ===");
  console.log(JSON.stringify(deployment.contracts, null, 2));
  console.log("\nNext: run deploy_rewards.ts to deploy RewardToken + MerkleRewardsDistributorV01");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
