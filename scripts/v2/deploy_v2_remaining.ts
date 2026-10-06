/**
 * deploy_v2_remaining.ts — Deploy remaining V2 contracts not covered by deploy_v2.ts
 *
 * Deploys (idempotent — skips if already present):
 *   1. GovernanceSignalV02
 *   2. ProtocolTimelockV02
 *   3. ClaimLedger
 *
 * Usage:
 *   npx hardhat run scripts/v2/deploy_v2_remaining.ts --network base
 *   FORCE_REDEPLOY=true npx hardhat run scripts/v2/deploy_v2_remaining.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { v2DemoConfig } from "../config";

const SEP = () => console.log("-".repeat(62));
const HDR = (s: string) => { SEP(); console.log("  " + s); SEP(); };

const FORCE = process.env.FORCE_REDEPLOY === "true";

async function main() {
  const [deployer] = await ethers.getSigners();

  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment file at ${deploymentsPath}. Run deploy.ts + deploy_v2.ts first.`);
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  if (!dep.contracts) dep.contracts = {};
  const c = dep.contracts;

  const required = ["FundVaultV01", "RewardToken", "LockLedgerV02"];
  for (const name of required) {
    if (!c[name]) throw new Error(`Missing ${name} in deployment JSON. Run deploy.ts + deploy_v2.ts first.`);
  }

  const admin    = dep.config?.admin    || deployer.address;
  const guardian = dep.config?.guardian || deployer.address;

  console.log("\n" + "=".repeat(62));
  console.log("  YearRing-FundProtocol V2 — Remaining Contracts");
  console.log("=".repeat(62));
  console.log("Network  :", network.name);
  console.log("Deployer :", deployer.address);
  console.log("Admin    :", admin);
  console.log("Guardian :", guardian);

  function save() {
    fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  }

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
    save();
    return [addr, true];
  }

  // ── 1. GovernanceSignalV02 ────────────────────────────────────────────────
  HDR("1 / 3   GovernanceSignalV02");
  await deployOrReuse("GovernanceSignalV02", async () => {
    const gov = await (await ethers.getContractFactory("GovernanceSignalV02")).deploy(
      c.RewardToken,
      v2DemoConfig.votingThreshold,
      Number(v2DemoConfig.votingPeriod),
      admin
    );
    await gov.waitForDeployment();
    const addr = await gov.getAddress();
    console.log("  GovernanceSignalV02 :", addr);
    return addr;
  });

  // ── 2. ProtocolTimelockV02 ───────────────────────────────────────────────
  HDR("2 / 3   ProtocolTimelockV02");
  await deployOrReuse("ProtocolTimelockV02", async () => {
    // proposers: admin (multisig on mainnet)
    // executors: address(0) → anyone can execute after delay
    // admin_:    deployer (can renounce TIMELOCK_ADMIN_ROLE post-setup)
    const timelock = await (await ethers.getContractFactory("ProtocolTimelockV02")).deploy(
      [admin],          // proposers
      [ethers.ZeroAddress], // executors — permissionless
      deployer.address  // initial timelock admin
    );
    await timelock.waitForDeployment();
    const addr = await timelock.getAddress();
    console.log("  ProtocolTimelockV02 :", addr);
    console.log("  MIN_DELAY           : 24h");
    console.log("  Proposer            :", admin);
    console.log("  Executor            : address(0) (permissionless)");
    console.log("  Timelock admin      :", deployer.address);
    console.log("  NOTE: after full governance setup, revoke deployer TIMELOCK_ADMIN_ROLE");
    return addr;
  });

  // ── 3. ClaimLedger ───────────────────────────────────────────────────────
  HDR("3 / 3   ClaimLedger");
  await deployOrReuse("ClaimLedger", async () => {
    const claimLedger = await (await ethers.getContractFactory("ClaimLedger")).deploy(admin);
    await claimLedger.waitForDeployment();
    const addr = await claimLedger.getAddress();
    console.log("  ClaimLedger         :", addr);
    console.log("  Admin               :", admin);
    console.log("  NOTE: grant VAULT_ROLE to FundVaultV01 when Exit mode is activated");
    return addr;
  });

  // ── Update metadata ───────────────────────────────────────────────────────
  dep.v2remaining = {
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };
  save();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(62));
  console.log("  Remaining V2 contracts deployed.");
  console.log("  Saved:", deploymentsPath);
  console.log("=".repeat(62));

  const keys = ["GovernanceSignalV02", "ProtocolTimelockV02", "ClaimLedger"];
  const summary: Record<string, string> = {};
  for (const k of keys) { if (c[k]) summary[k] = c[k]; }
  console.log("\nAddresses:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
