/**
 * seed_deposit_v2_1.ts
 * ────────────────────
 * Performs the initial 10-USDC seed deposit into YearRingCoreVaultV21
 * using the ALICE_PRIVATE_KEY account (customA).
 *
 * Steps:
 *   1. Admin adds Alice to vault allowlist
 *   2. Alice approves vault to spend 10 USDC
 *   3. Alice calls vault.deposit(10_000_000, alice)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/seed_deposit_v2_1.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEED = 10_000_000n; // 10 USDC (6-dec)

async function main() {
  const [deployer] = await ethers.getSigners();

  // Alice (customA) — index 1 in TESTNET_ACCOUNTS
  const signers = await ethers.getSigners();
  const alice = signers[1];

  const jsonPath = path.join(__dirname, "../../deployments/v2_1_base.json");
  const deployment = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const c = deployment.contracts as Record<string, string>;

  const vaultAddr = c["YearRingCoreVaultV21"];
  const usdcAddr  = c["USDC"];

  const vault = await ethers.getContractAt("YearRingCoreVaultV21", vaultAddr);
  const usdc  = await ethers.getContractAt("IERC20", usdcAddr);

  console.log("\n======================================================================");
  console.log("  V2.1 Seed Deposit");
  console.log("======================================================================");
  console.log(`  Network  : ${network.name}`);
  console.log(`  Admin    : ${deployer.address}`);
  console.log(`  Alice    : ${alice.address}`);
  console.log(`  Vault    : ${vaultAddr}`);
  console.log(`  Amount   : 10 USDC`);
  console.log("======================================================================\n");

  // ── 1. Add Alice to vault allowlist (admin tx) ────────────────────────────
  process.stdout.write("  vault.setAllowlist(alice, true)  [admin] … ");
  await (await vault.connect(deployer).setAllowlist(alice.address, true)).wait();
  console.log("done");

  // ── 2. Alice approves vault ───────────────────────────────────────────────
  process.stdout.write("  usdc.approve(vault, 10 USDC)     [alice] … ");
  await (await usdc.connect(alice).approve(vaultAddr, SEED)).wait();
  console.log("done");

  // ── 3. Alice deposits 10 USDC → gets yrUSDC ──────────────────────────────
  process.stdout.write("  vault.deposit(10 USDC, alice)    [alice] … ");
  await (await vault.connect(alice).deposit(SEED, alice.address)).wait();
  console.log("done");

  const totalAssets = await vault.totalAssets();
  const totalSupply = await vault.totalSupply();
  console.log(`\n  ✓  totalAssets = ${totalAssets} (6-dec USDC)`);
  console.log(`  ✓  totalSupply = ${totalSupply} (18-dec yrUSDC)`);
  console.log("  ✓  PPS established: 1 USDC = 1 yrUSDC");
  console.log("\n  Vault is now seeded and ready for user deposits.\n");
}

main().catch(err => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
