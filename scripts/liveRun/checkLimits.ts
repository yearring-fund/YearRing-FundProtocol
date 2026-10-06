/**
 * checkLimits.ts — Step3 limits utilization check
 *
 * Reads all limit parameters and current utilization.
 * Flags any limit that is ≥ 80% or exceeded.
 *
 * Usage:
 *   npx hardhat run scripts/liveRun/checkLimits.ts --network base
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();
import {
  loadDeployment, VAULT_ABI, MANAGER_ABI, STRATEGY_ABI, ALLOWLIST,
  u6, u18, progressBar, readDailyTracker, todayUTC,
  PER_USER_CAP, TVL_CAP, DAILY_CAP,
} from "./lib";

async function main() {
  const dep      = loadDeployment();
  const provider = ethers.provider;

  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,    provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI,  provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,  STRATEGY_ABI, provider);

  const [totalAssets, investCapRaw, stratUnderlying] = await Promise.all([
    vault.totalAssets(), manager.investCap(), strategy.totalUnderlying(),
  ]);

  const tvl       = u6(totalAssets);
  const investCap = u6(investCapRaw);
  const stratDep  = u6(stratUnderlying);

  const tracker   = readDailyTracker();
  const today     = todayUTC();
  const dailyUsed = tracker.date === today ? tracker.total : 0;

  const SEP  = "─".repeat(64);
  const SEP2 = "═".repeat(64);

  console.log("\n" + SEP2);
  console.log("  Step3 Limits Check  —  " + new Date().toISOString());
  console.log(SEP2);

  // ── Global limits ────────────────────────────────────────────────────────────
  console.log("\n  GLOBAL LIMITS");
  console.log(SEP);

  const limits = [
    { label: "TVL (totalAssets)",       used: tvl,       cap: TVL_CAP,    note: "script-layer soft cap" },
    { label: "Strategy deployed",       used: stratDep,  cap: investCap,  note: "on-chain investCap ⛓" },
    { label: "Daily deposits",          used: dailyUsed, cap: DAILY_CAP,  note: `script-layer (${today})` },
  ];

  let anyAlert = false;
  for (const { label, used, cap, note } of limits) {
    const pct = cap > 0 ? used / cap * 100 : 0;
    const flag = pct >= 100 ? "⛔ AT CAP" : pct >= 80 ? "⚠️  near cap" : "✅";
    if (pct >= 80) anyAlert = true;
    console.log(`\n  ${label.padEnd(24)} ${used.toFixed(2)} / ${cap.toFixed(0)} USDC  (${note})`);
    console.log(`  ${"".padEnd(24)} ${progressBar(used, cap)}  ${flag}`);
  }

  // ── Per-user limits ───────────────────────────────────────────────────────────
  console.log(`\n\n  PER-USER CAP: ${PER_USER_CAP} USDC`);
  console.log(SEP);

  for (const [label, addr] of Object.entries(ALLOWLIST)) {
    const shares   = await vault.balanceOf(addr);
    const valueRaw = shares > 0n ? await vault.convertToAssets(shares) : 0n;
    const value    = u6(valueRaw);
    const headroom = Math.max(0, PER_USER_CAP - value);
    const pct      = value / PER_USER_CAP * 100;
    if (pct >= 80) anyAlert = true;

    const flag = pct >= 100 ? "⛔ AT CAP" : pct >= 80 ? "⚠️  near cap" : "✅";
    console.log(`  ${label.padEnd(8)} ${addr.slice(0,10)}…  ${value.toFixed(2).padStart(9)} / ${PER_USER_CAP} USDC  headroom: ${headroom.toFixed(2).padStart(8)} USDC  ${flag}`);
  }

  console.log("\n" + SEP);
  console.log(anyAlert
    ? "  ⚠️  One or more limits at or near threshold — review before next deposit."
    : "  ✅ All limits nominal.");
  console.log(SEP2 + "\n");
}

main().catch(console.error);
