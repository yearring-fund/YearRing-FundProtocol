/**
 * update_frontend_addresses.ts — Sync contract addresses from deployments/base.json
 * into docs/v02/index.html after a redeploy.
 *
 * Usage:
 *   npx hardhat run scripts/v2/update_frontend_addresses.ts --network base
 */

import * as fs from "fs";
import * as path from "path";

async function main() {
  const network = process.env.HARDHAT_NETWORK || "base";
  const deploymentsPath = path.join(__dirname, `../../deployments/${network}.json`);
  const frontendPath    = path.join(__dirname, `../../docs/v02/index.html`);

  if (!fs.existsSync(deploymentsPath)) throw new Error(`No deployment at ${deploymentsPath}`);
  if (!fs.existsSync(frontendPath))    throw new Error(`Frontend not found at ${frontendPath}`);

  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const required = [
    "USDC", "FundVaultV01", "RewardToken", "LockLedgerV02", "LockBenefitV02",
    "LockRewardManagerV02", "BeneficiaryModuleV02", "UserStateEngineV02", "MetricsLayerV02",
  ];
  for (const k of required) {
    if (!c[k]) throw new Error(`Missing ${k} in ${deploymentsPath}`);
  }

  let html = fs.readFileSync(frontendPath, "utf8");

  // Replace the entire ADDR block
  const addrBlock = `const ADDR = {
  USDC:                 '${c.USDC}',
  FundVaultV01:         '${c.FundVaultV01}',
  RewardToken:          '${c.RewardToken}',
  LockLedgerV02:        '${c.LockLedgerV02}',
  LockBenefitV02:       '${c.LockBenefitV02}',
  LockRewardManagerV02: '${c.LockRewardManagerV02}',
  BeneficiaryModuleV02: '${c.BeneficiaryModuleV02}',
  UserStateEngineV02:   '${c.UserStateEngineV02}',
  MetricsLayerV02:      '${c.MetricsLayerV02}',
  GovernanceSignalV02:  '${c.GovernanceSignalV02 || ""}',
  ClaimLedger:          '${c.ClaimLedger || ""}',
}`;

  const addrRegex = /const ADDR = \{[\s\S]*?\}/;
  if (!addrRegex.test(html)) throw new Error("Could not find ADDR block in index.html");

  html = html.replace(addrRegex, addrBlock);
  fs.writeFileSync(frontendPath, html);

  console.log("✓ docs/v02/index.html ADDR block updated:");
  console.log("  FundVaultV01        :", c.FundVaultV01);
  console.log("  LockLedgerV02       :", c.LockLedgerV02);
  console.log("  LockRewardManagerV02:", c.LockRewardManagerV02);
  console.log("  (all other addresses updated too)");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
