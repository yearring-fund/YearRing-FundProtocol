/**
 * reset_v2.ts — Archive V2 deployment state and redeploy from scratch
 *
 * hardhat (in-process):  No reset needed — each run starts a fresh EVM.
 *                        Re-run run_demo.ts directly.
 *
 * External networks:     Archives current V2 addresses to dep.archivedV2[],
 *                        cleans demo metadata (seed, v2, v2Setup), then
 *                        automatically runs deploy_v2 → setup_v2 → seed_v2
 *                        in sequence.
 *
 * Usage:
 *   npx hardhat run scripts/v2/reset_v2.ts --network baseSepolia
 *   DEPLOY_OPTIONAL_MODULES=true npx hardhat run scripts/v2/reset_v2.ts --network baseSepolia
 */

import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const SEP = () => console.log("-".repeat(62));

// V2 keys managed by the minimal demo build.
// Must stay in sync with deploy_v2.ts MINIMAL_KEYS.
const MINIMAL_V2_KEYS = [
  "RewardToken",
  "LockLedgerV02",
  "LockBenefitV02",
  "LockRewardManagerV02",
  "BeneficiaryModuleV02",
  "UserStateEngineV02",
  "MetricsLayerV02",
];
const OPTIONAL_V2_KEYS = ["GovernanceSignalV02"]; // LockPointsV02 deprecated — never deploy
const ALL_V2_KEYS = [...MINIMAL_V2_KEYS, ...OPTIONAL_V2_KEYS];

async function main() {
  // hardhat (in-process): no-op
  if (network.name === "hardhat") {
    SEP();
    console.log("LOCAL HARDHAT — No reset needed.");
    console.log("");
    console.log("Each `npx hardhat run` starts a fresh in-memory EVM.");
    console.log("To re-run the full demo:");
    console.log("");
    console.log("  npx hardhat run scripts/v2/run_demo.ts");
    console.log("");
    return;
  }

  // External networks (localhost, baseSepolia, base, …)
  console.log("\n" + "=".repeat(62));
  console.log("  YearRing-FundProtocol V2 — Reset / Redeploy");
  console.log("=".repeat(62));
  console.log("Network :", network.name);

  SEP();
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);

  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment at ${deploymentsPath}. Run deploy.ts first.`);
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // ── Archive existing V2 addresses ────────────────────────────────────────
  const archived: Record<string, string> = {};
  for (const key of ALL_V2_KEYS) {
    if (dep.contracts?.[key]) {
      archived[key] = dep.contracts[key];
      delete dep.contracts[key];
    }
  }

  if (Object.keys(archived).length > 0) {
    if (!dep.archivedV2) dep.archivedV2 = [];
    dep.archivedV2.push({
      archivedAt: new Date().toISOString(),
      contracts:  archived,
    });
    console.log("Archived V2 addresses (orphaned on-chain, recorded for reference):");
    for (const [k, v] of Object.entries(archived)) {
      console.log(`  ${k.padEnd(26)}: ${v}`);
    }
  } else {
    console.log("No V2 contracts found to archive.");
  }

  // ── Clean demo metadata ───────────────────────────────────────────────────
  const cleaned: string[] = [];
  for (const key of ["seed", "v2", "v2Setup"] as const) {
    if ((dep as any)[key]) {
      delete (dep as any)[key];
      cleaned.push(key);
    }
  }
  if (cleaned.length > 0) {
    console.log("Cleaned metadata fields:", cleaned.join(", "));
  }

  // Save cleaned base deployment
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  console.log("Deployment JSON cleaned. V01 contracts preserved.");

  // ── Run deploy → setup → seed ─────────────────────────────────────────────
  SEP();
  console.log("Running deploy_v2 → setup_v2 → seed_v2 ...");

  const projectRoot  = path.join(__dirname, "../..");
  const optionalFlag = process.env.DEPLOY_OPTIONAL_MODULES === "true"
    ? "DEPLOY_OPTIONAL_MODULES=true "
    : "";

  const scripts = [
    `scripts/v2/deploy_v2.ts`,
    `scripts/v2/setup_v2.ts`,
    `scripts/v2/seed_v2.ts`,
  ];

  for (const script of scripts) {
    SEP();
    console.log(`Running: ${optionalFlag}npx hardhat run ${script} --network ${network.name}`);
    console.log("");
    try {
      execSync(
        `${optionalFlag}npx hardhat run ${script} --network ${network.name}`,
        { cwd: projectRoot, stdio: "inherit" }
      );
    } catch (err: any) {
      throw new Error(
        `Script failed: ${script}\n` +
        `Fix the error above, then re-run reset_v2.ts or continue manually:\n` +
        `  npx hardhat run scripts/v2/setup_v2.ts --network ${network.name}\n` +
        `  npx hardhat run scripts/v2/seed_v2.ts  --network ${network.name}`
      );
    }
  }

  SEP();
  console.log("✓ Reset complete — fresh V2 deployment seeded.");
  console.log("  State snapshot:");
  console.log(`  npx hardhat run scripts/v2/run_demo.ts --network ${network.name}`);
  console.log("=".repeat(62));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
