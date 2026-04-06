/**
 * checkWhitelist.ts — Step3 allowlist status and positions
 *
 * For each allowlisted address: on-chain isAllowed, shares, vault value,
 * per-user cap utilization, headroom.
 * Also checks that no unexpected addresses appear to be allowlisted.
 *
 * Usage:
 *   npx hardhat run scripts/liveRun/checkWhitelist.ts --network base
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();
import {
  loadDeployment, VAULT_ABI, ALLOWLIST,
  u6, u18, progressBar, PER_USER_CAP,
} from "./lib";

async function main() {
  const dep      = loadDeployment();
  const provider = ethers.provider;
  const vault    = new ethers.Contract(dep.contracts.FundVaultV01, VAULT_ABI, provider);

  const SEP  = "─".repeat(64);
  const SEP2 = "═".repeat(64);

  console.log("\n" + SEP2);
  console.log("  Step3 Whitelist Check  —  " + new Date().toISOString());
  console.log(SEP2);
  console.log(`\n  Per-user cap: ${PER_USER_CAP} USDC`);
  console.log(SEP);

  let anyIssue = false;

  for (const [label, addr] of Object.entries(ALLOWLIST)) {
    const [shares, allowed] = await Promise.all([
      vault.balanceOf(addr),
      vault.isAllowed(addr),
    ]);
    const valueRaw  = shares > 0n ? await vault.convertToAssets(shares) : 0n;
    const value     = u6(valueRaw);
    const shareFmt  = u18(shares);
    const headroom  = Math.max(0, PER_USER_CAP - value);
    const pctUsed   = value / PER_USER_CAP * 100;

    let statusTag = "";
    if (!allowed)           { statusTag = "⚠️  NOT allowlisted (on-chain)"; anyIssue = true; }
    else if (pctUsed >= 100) { statusTag = "⛔ AT PER-USER CAP";             anyIssue = true; }
    else if (pctUsed >= 80)  { statusTag = "⚠️  near per-user cap";          anyIssue = true; }
    else                     { statusTag = "✅"; }

    console.log(`\n  ${label.padEnd(8)} ${addr}`);
    console.log(`    allowlist  : ${allowed ? "✅ on-chain confirmed" : "❌ NOT in allowlist"}`);
    console.log(`    shares     : ${shareFmt.toFixed(6)} fbUSDC`);
    console.log(`    value      : ${value.toFixed(6)} USDC`);
    console.log(`    headroom   : ${headroom.toFixed(2)} USDC  ${statusTag}`);
    console.log(`    utilization: ${progressBar(value, PER_USER_CAP)}`);
  }

  console.log("\n" + SEP);
  console.log(anyIssue
    ? "  ⚠️  One or more allowlist entries need attention (see above)."
    : "  ✅ All allowlist entries nominal.");
  console.log(SEP2 + "\n");
}

main().catch(console.error);
