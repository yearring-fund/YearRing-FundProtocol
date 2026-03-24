/**
 * deploy_rewards.ts — Deploy RewardToken + MerkleRewardsDistributorV01
 *
 * Reads vault address from existing deployment file produced by deploy.ts.
 * Transfers full premint from treasury to distributor.
 *
 * Usage:
 *   npx hardhat run scripts/deploy_rewards.ts --network hardhat
 *   npx hardhat run scripts/deploy_rewards.ts --network baseSepolia
 *   npx hardhat run scripts/deploy_rewards.ts --network base
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

  // ---------------------------------------------------------------------------
  // Load existing deployment
  // ---------------------------------------------------------------------------
  const deploymentsPath = path.join(__dirname, `../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment at ${deploymentsPath} — run deploy.ts first`);
  }
  const existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const vaultAddress = existing.contracts.FundVaultV01;
  const admin        = existing.config.admin;
  const guardian     = existing.config.guardian;
  const treasury     = existing.config.treasury;

  if (!vaultAddress) throw new Error("FundVaultV01 address missing in deployment file");

  console.log("=".repeat(60));
  console.log("FinancialBase V01 — Rewards Deployment");
  console.log("=".repeat(60));
  console.log("Network  :", network.name);
  console.log("Deployer :", deployer.address);
  console.log("Vault    :", vaultAddress);
  console.log("Admin    :", admin);
  console.log("Treasury :", treasury);
  console.log("-".repeat(60));

  // ---------------------------------------------------------------------------
  // 1. RewardToken
  // ---------------------------------------------------------------------------
  const rewardToken = await (await ethers.getContractFactory("RewardToken")).deploy(
    cfg.rewardTokenName,
    cfg.rewardTokenSymbol,
    cfg.rewardPremint,
    treasury
  );
  await rewardToken.waitForDeployment();
  const rewardTokenAddress = await rewardToken.getAddress();
  console.log("RewardToken                  :", rewardTokenAddress);
  console.log("  Premint                    :", ethers.formatEther(cfg.rewardPremint), cfg.rewardTokenSymbol);

  // ---------------------------------------------------------------------------
  // 2. MerkleRewardsDistributorV01
  // ---------------------------------------------------------------------------
  const distributor = await (await ethers.getContractFactory("MerkleRewardsDistributorV01")).deploy(
    rewardTokenAddress,
    vaultAddress,
    cfg.epochCap,
    cfg.maxEpochCap,
    admin,
    guardian
  );
  await distributor.waitForDeployment();
  const distributorAddress = await distributor.getAddress();
  console.log("MerkleRewardsDistributorV01  :", distributorAddress);
  console.log("  epochCap                   :", ethers.formatEther(cfg.epochCap), cfg.rewardTokenSymbol);
  console.log("  maxEpochCap                :", ethers.formatEther(cfg.maxEpochCap), cfg.rewardTokenSymbol);

  // ---------------------------------------------------------------------------
  // 3. Fund distributor (treasury transfers full premint)
  //    On local: deployer == treasury, can do it automatically
  //    On mainnet: treasury must sign — print instructions instead
  // ---------------------------------------------------------------------------
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  if (isLocal || cfg.useDeployerAsAdmin) {
    const rt = await ethers.getContractAt("RewardToken", rewardTokenAddress);
    await (await rt.transfer(distributorAddress, cfg.rewardPremint)).wait();
    console.log("  Premint transferred to distributor ✓");
  } else {
    console.log("\n⚠️  ACTION REQUIRED:");
    console.log("  Treasury must transfer reward tokens to distributor:");
    console.log(`  RewardToken.transfer(${distributorAddress}, ${cfg.rewardPremint})`);
  }

  // ---------------------------------------------------------------------------
  // 4. Update deployment file
  // ---------------------------------------------------------------------------
  existing.contracts.RewardToken                  = rewardTokenAddress;
  existing.contracts.MerkleRewardsDistributorV01  = distributorAddress;
  existing.config.rewardPremint                   = cfg.rewardPremint.toString();
  existing.config.epochCap                        = cfg.epochCap.toString();
  existing.config.maxEpochCap                     = cfg.maxEpochCap.toString();

  fs.writeFileSync(deploymentsPath, JSON.stringify(existing, null, 2));

  console.log("-".repeat(60));
  console.log("Deployment updated:", deploymentsPath);
  console.log("\nNext: run build_merkle.ts to generate epoch claims");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
