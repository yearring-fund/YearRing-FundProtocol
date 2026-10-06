/**
 * checkSystemState.ts — Step3 unified system state check
 *
 * Covers: roles, vault status, strategy status, NAV, limits, daily tracker.
 * Prints a structured dashboard. No transactions.
 *
 * Usage:
 *   npx hardhat run scripts/liveRun/checkSystemState.ts --network base
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();
import {
  loadDeployment, VAULT_ABI, MANAGER_ABI, STRATEGY_ABI,
  u6, u18, progressBar, readDailyTracker, todayUTC,
  TVL_CAP, DAILY_CAP, MODE_LABELS,
  ADMIN_MIN_ETH, GUARDIAN_MIN_ETH, ADMIN_WARN_ETH, GUARDIAN_WARN_ETH,
} from "./lib";

async function main() {
  const dep      = loadDeployment();
  const provider = ethers.provider;

  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,    provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI,  provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,  STRATEGY_ABI, provider);

  // ── Role constants ──────────────────────────────────────────────────────────
  const [VAULT_ADMIN, VAULT_EMERGENCY, MGR_ADMIN, MGR_EMERGENCY] = await Promise.all([
    vault.DEFAULT_ADMIN_ROLE(), vault.EMERGENCY_ROLE(),
    manager.DEFAULT_ADMIN_ROLE(), manager.EMERGENCY_ROLE(),
  ]);
  const admin    = dep.config.admin;
  const guardian = dep.config.guardian;

  // ── Parallel reads ──────────────────────────────────────────────────────────
  const [
    totalAssets, totalSupply, ppsRaw, systemMode,
    depPaused, redPaused, availToInvest,
    managerTotal, managerIdle, investCapRaw, minIdleRaw, managerPaused,
    stratUnderlying,
    vaultHasAdmin, vaultHasGuardian, mgrHasAdmin, mgrHasGuardian,
  ] = await Promise.all([
    vault.totalAssets(), vault.totalSupply(), vault.pricePerShare(),
    vault.systemMode(), vault.depositsPaused(), vault.redeemsPaused(),
    vault.availableToInvest(),
    manager.totalManagedAssets(), manager.idleUnderlying(),
    manager.investCap(), manager.minIdle(), manager.paused(),
    strategy.totalUnderlying(),
    vault.hasRole(VAULT_ADMIN, admin),    vault.hasRole(VAULT_EMERGENCY, guardian),
    manager.hasRole(MGR_ADMIN, admin),    manager.hasRole(MGR_EMERGENCY, guardian),
  ]);

  const tvl       = u6(totalAssets);
  const pps       = u6(ppsRaw);
  const investCap = u6(investCapRaw);
  const stratDep  = u6(stratUnderlying);
  const mgrIdle   = u6(managerIdle);
  const avail     = u6(availToInvest);

  const tracker   = readDailyTracker();
  const today     = todayUTC();
  const dailyUsed = tracker.date === today ? tracker.total : 0;

  const SEP  = "─".repeat(64);
  const SEP2 = "═".repeat(64);

  console.log("\n" + SEP2);
  console.log("  Step3 System State Check  —  " + new Date().toISOString());
  console.log("  Network: Base Mainnet");
  console.log(SEP2);

  // ── Roles ───────────────────────────────────────────────────────────────────
  console.log("\n  ROLES");
  console.log(SEP);
  const roleChecks: [string, boolean][] = [
    [`vault   : ADMIN  (${admin.slice(0,10)}…) has DEFAULT_ADMIN_ROLE`,  vaultHasAdmin],
    [`vault   : GUARDIAN (${guardian.slice(0,10)}…) has EMERGENCY_ROLE`, vaultHasGuardian],
    [`manager : ADMIN  has DEFAULT_ADMIN_ROLE`,                           mgrHasAdmin],
    [`manager : GUARDIAN has EMERGENCY_ROLE`,                             mgrHasGuardian],
  ];
  let roleOk = true;
  for (const [label, ok] of roleChecks) {
    console.log(`  [${ok ? "✓" : "✗"}] ${label}`);
    if (!ok) roleOk = false;
  }
  if (!roleOk) console.log("\n  ⛔ ROLE CHECK FAILED — verify deployments/base.json and on-chain state");

  // ── System status ────────────────────────────────────────────────────────────
  console.log("\n  SYSTEM STATUS");
  console.log(SEP);
  console.log(`  systemMode     : ${MODE_LABELS[Number(systemMode)]}`);
  console.log(`  depositsPaused : ${depPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  redeemsPaused  : ${redPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  manager.paused : ${managerPaused ? "PAUSED ⛔ (invest blocked)" : "Active ✅"}`);

  const depositsEffectivelyBlocked = depPaused || Number(systemMode) !== 0;
  if (depositsEffectivelyBlocked && !redPaused) {
    console.log("\n  ℹ️  Deposits currently blocked — redeems remain open (exit priority preserved).");
  }

  // ── NAV / Vault ──────────────────────────────────────────────────────────────
  console.log("\n  VAULT / NAV");
  console.log(SEP);
  console.log(`  totalAssets    : ${tvl.toFixed(6)} USDC`);
  console.log(`  totalSupply    : ${u18(totalSupply).toFixed(6)} fbUSDC`);
  console.log(`  pricePerShare  : ${pps.toFixed(6)} USDC/fbUSDC`);
  console.log(`  availToInvest  : ${avail.toFixed(6)} USDC`);

  // ── Strategy ─────────────────────────────────────────────────────────────────
  console.log("\n  STRATEGY (Aave V3)");
  console.log(SEP);
  console.log(`  totalUnderlying (deployed) : ${stratDep.toFixed(6)} USDC`);
  console.log(`  manager idle               : ${mgrIdle.toFixed(6)} USDC`);
  console.log(`  manager totalManagedAssets : ${u6(managerTotal).toFixed(6)} USDC`);
  console.log(`  investCap                  : ${investCap.toFixed(2)} USDC`);
  console.log(`  minIdle                    : ${u6(minIdleRaw).toFixed(2)} USDC`);

  // ── Global limits ────────────────────────────────────────────────────────────
  console.log("\n  LIMITS");
  console.log(SEP);
  console.log(`  TVL   : ${tvl.toFixed(2)} / ${TVL_CAP} USDC`);
  console.log(`          ${progressBar(tvl, TVL_CAP)}`);
  console.log(`  Invest: ${stratDep.toFixed(2)} / ${investCap.toFixed(0)} USDC (on-chain cap)`);
  console.log(`          ${progressBar(stratDep, investCap > 0 ? investCap : TVL_CAP)}`);
  console.log(`  Daily : ${dailyUsed.toFixed(2)} / ${DAILY_CAP} USDC (${today})`);
  console.log(`          ${progressBar(dailyUsed, DAILY_CAP)}`);

  // ── Gas / ETH balances ───────────────────────────────────────────────────────
  console.log("\n  GAS BALANCES");
  console.log(SEP);
  const [adminEth, guardianEth] = await Promise.all([
    provider.getBalance(admin),
    provider.getBalance(guardian),
  ]);
  const fmtEth = (b: bigint) => parseFloat(ethers.formatEther(b)).toFixed(6);
  const adminEthF    = parseFloat(ethers.formatEther(adminEth));
  const guardianEthF = parseFloat(ethers.formatEther(guardianEth));

  const adminStatus = adminEthF >= ADMIN_MIN_ETH
    ? "✅ OK"
    : adminEthF >= ADMIN_WARN_ETH
      ? "⚠️  LOW — refill recommended"
      : "⛔ CRITICAL — below warning threshold";

  const guardianStatus = guardianEthF >= GUARDIAN_MIN_ETH
    ? "✅ OK"
    : guardianEthF >= GUARDIAN_WARN_ETH
      ? "⚠️  LOW — refill recommended"
      : "⛔ CRITICAL — below warning threshold";

  console.log(`  ADMIN    : ${fmtEth(adminEth)} ETH  (min ${ADMIN_MIN_ETH}, warn <${ADMIN_WARN_ETH})  ${adminStatus}`);
  console.log(`  GUARDIAN : ${fmtEth(guardianEth)} ETH  (min ${GUARDIAN_MIN_ETH}, warn <${GUARDIAN_WARN_ETH})  ${guardianStatus}`);

  console.log("\n" + SEP2 + "\n");
}

main().catch(console.error);
