/**
 * update_frontend_config.ts
 *
 * Reads deployments/{network}.json and patches two frontend source files:
 *
 *   frontend/src/contracts/addresses.ts   — contract addresses (required)
 *   frontend/src/contracts/demoPersonas.ts — seeded demo wallet addresses (optional)
 *
 * Usage:
 *   npx hardhat run scripts/update_frontend_config.ts --network baseSepolia
 *   npx hardhat run scripts/update_frontend_config.ts --network localhost
 *
 * Prerequisites:
 *   - Run deploy.ts + v2/deploy_v2.ts + v2/setup_v2.ts first (populates contracts)
 *   - Run v2/seed_v2.ts first if DemoStateSection should auto-populate persona addresses
 */

import * as fs from "fs";
import * as path from "path";
import { network } from "hardhat";

async function main() {
  const deploymentsPath = path.join(__dirname, `../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment at ${deploymentsPath}.`);
  }

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const required = [
    "MockUSDC", "FundVaultV01", "RewardToken", "LockLedgerV02",
    "LockBenefitV02", "LockRewardManagerV02", "BeneficiaryModuleV02",
    "UserStateEngineV02", "MetricsLayerV02",
  ];
  const missing = required.filter(k => !c[k]);
  if (missing.length > 0) {
    throw new Error(`Missing addresses: ${missing.join(", ")}\nRun deploy_v2.ts first.`);
  }

  // Patch the Vite project's addresses.ts
  const addrsTsPath = path.join(__dirname, "../frontend/src/contracts/addresses.ts");
  if (!fs.existsSync(addrsTsPath)) {
    throw new Error(
      `frontend/src/contracts/addresses.ts not found.\n` +
      `Expected path: ${addrsTsPath}\n` +
      `Make sure the Vite project exists under frontend/ and addresses.ts has been created.`
    );
  }

  let src = fs.readFileSync(addrsTsPath, "utf8");

  const replacements: [string, string][] = [
    ["USDC:",                  c.MockUSDC                || ""],
    ["FundVaultV01:",          c.FundVaultV01            || ""],
    ["RewardToken:",           c.RewardToken             || ""],
    ["LockLedgerV02:",         c.LockLedgerV02           || ""],
    ["LockBenefitV02:",        c.LockBenefitV02          || ""],
    ["LockRewardManagerV02:",  c.LockRewardManagerV02    || ""],
    ["BeneficiaryModuleV02:",  c.BeneficiaryModuleV02    || ""],
    ["UserStateEngineV02:",    c.UserStateEngineV02      || ""],
    ["MetricsLayerV02:",       c.MetricsLayerV02         || ""],
    ["GovernanceSignalV02:",   c.GovernanceSignalV02     || ""],
  ];

  for (const [key, addr] of replacements) {
    // Match:  KEY  "..." as `0x${string}`,
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${escaped}\\s*)"[^"]*"`, "g");
    src = src.replace(re, `$1"${addr}"`);
  }

  fs.writeFileSync(addrsTsPath, src);

  console.log("frontend/src/contracts/addresses.ts updated with addresses from", deploymentsPath);
  console.log("\nAddresses written:");
  for (const [key, addr] of replacements) {
    console.log(`  ${key.replace(":", "").padEnd(24)} ${addr || "(missing)"}`);
  }

  // Patch demoPersonas.ts with seeded persona addresses (optional — requires seed_v2.ts to have run)
  const personasPath = path.join(__dirname, "../frontend/src/contracts/demoPersonas.ts");
  if (fs.existsSync(personasPath)) {
    if (dep.seed) {
      let pSrc = fs.readFileSync(personasPath, "utf8");
      const personaReplacements: [string, string][] = [
        ["alice:", dep.seed.alice?.address || ""],
        ["bob:",   dep.seed.bob?.address   || ""],
        ["carol:", dep.seed.carol?.address || ""],
      ];
      for (const [key, addr] of personaReplacements) {
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re  = new RegExp(`(${esc}\\s*)"[^"]*"`, "g");
        pSrc = pSrc.replace(re, `$1"${addr}"`);
      }
      fs.writeFileSync(personasPath, pSrc);
      console.log("\nDemo personas written:");
      for (const [key, addr] of personaReplacements) {
        console.log(`  ${key.replace(":", "").padEnd(8)} ${addr || "(not seeded)"}`);
      }
    } else {
      console.log("\nWarning: seeded personas not written — dep.seed not found in deployment file.");
      console.log("  Run scripts/v2/seed_v2.ts first if DemoStateSection should auto-populate.");
    }
  }

  console.log("\nRun: cd frontend && npm run dev");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
