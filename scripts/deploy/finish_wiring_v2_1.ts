/**
 * finish_wiring_v2_1.ts
 * ─────────────────────
 * One-shot script to complete the remaining Step 15 wiring calls
 * that were left incomplete due to an Infura RPC hang.
 *
 * Reads addresses from deployments/v2_1_base.json and executes:
 *   1. eligMod.setManagerConfig(asmAddr, true, 0, 0, false)
 *   2. vault.grantRole(KEEPER_ROLE, keeper)
 *   3. vault.setAllowlist(treasury, true)
 *   4. vault.setAllowlist(asmAddr, true)
 *   5. vault.setAllowlist(admin, true)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/finish_wiring_v2_1.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const KEEPER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));

async function main() {
  const [deployer] = await ethers.getSigners();

  const jsonPath = path.join(__dirname, "../../deployments/v2_1_base.json");
  const deployment = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const c = deployment.contracts as Record<string, string>;

  const vaultAddr       = c["YearRingCoreVaultV21"];
  const treasuryAddr    = c["TreasuryV21"];
  const asmAddr         = c["AccessStrategyManagerV21"];
  const eligModAddr     = c["EligibilityModuleV21"];
  const ADMIN_ADDR      = process.env.ADMIN_ADDRESS || deployer.address;
  const KEEPER_ADDR     = process.env.KEEPER_ADDRESS || deployer.address;

  console.log("\n======================================================================");
  console.log("  V2.1 Wiring Completion");
  console.log("======================================================================");
  console.log(`  Network   : ${network.name}`);
  console.log(`  Deployer  : ${deployer.address}`);
  console.log(`  Admin     : ${ADMIN_ADDR}`);
  console.log(`  Keeper    : ${KEEPER_ADDR}`);
  console.log(`  EligMod   : ${eligModAddr}`);
  console.log(`  Vault     : ${vaultAddr}`);
  console.log("======================================================================\n");

  const vault   = await ethers.getContractAt("YearRingCoreVaultV21",   vaultAddr);
  const eligMod = await ethers.getContractAt("EligibilityModuleV21",   eligModAddr);

  // ── 1. eligMod.setManagerConfig ──────────────────────────────────────────
  process.stdout.write("  eligMod.setManagerConfig(asmAddr, open) … ");
  await (await eligMod.setManagerConfig(asmAddr, true, 0, 0, false)).wait();
  console.log("done");

  // ── 2. vault.grantRole(KEEPER_ROLE, keeper) ───────────────────────────────
  process.stdout.write("  vault.grantRole(KEEPER_ROLE, keeper)    … ");
  await (await vault.grantRole(KEEPER_ROLE, KEEPER_ADDR)).wait();
  console.log("done");

  // ── 3. vault.setAllowlist(treasury, true) ────────────────────────────────
  process.stdout.write("  vault.setAllowlist(treasury, true)      … ");
  await (await vault.setAllowlist(treasuryAddr, true)).wait();
  console.log("done");

  // ── 4. vault.setAllowlist(asmAddr, true) ─────────────────────────────────
  process.stdout.write("  vault.setAllowlist(asmAddr, true)       … ");
  await (await vault.setAllowlist(asmAddr, true)).wait();
  console.log("done");

  // ── 5. vault.setAllowlist(admin, true) ───────────────────────────────────
  process.stdout.write("  vault.setAllowlist(admin, true)         … ");
  await (await vault.setAllowlist(ADMIN_ADDR, true)).wait();
  console.log("done");

  console.log("\n  ✓  All wiring complete.");
  console.log("  ⚠  Seed deposit still pending — fund via customA address.");
  console.log("     vault.deposit(≥10_000_000, receiver) before enabling user deposits.\n");
}

main().catch(err => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
