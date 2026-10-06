/**
 * exportLiveRunSnapshot.ts — Step3 full JSON snapshot export
 *
 * Reads all system state and exports a structured JSON file to evidence/.
 * Use for periodic archival, incident investigation, or compliance records.
 *
 * Usage:
 *   npx hardhat run scripts/liveRun/exportLiveRunSnapshot.ts --network base
 */
import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();
import {
  loadDeployment, VAULT_ABI, MANAGER_ABI, STRATEGY_ABI, ALLOWLIST,
  u6, u18, readDailyTracker, todayUTC, saveEvidence,
  PER_USER_CAP, TVL_CAP, DAILY_CAP,
} from "./lib";

async function main() {
  const dep      = loadDeployment();
  const provider = ethers.provider;

  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,    provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI,  provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,  STRATEGY_ABI, provider);

  // ── Role reads ──────────────────────────────────────────────────────────────
  const [VAULT_ADMIN, VAULT_EMERGENCY, MGR_ADMIN, MGR_EMERGENCY] = await Promise.all([
    vault.DEFAULT_ADMIN_ROLE(), vault.EMERGENCY_ROLE(),
    manager.DEFAULT_ADMIN_ROLE(), manager.EMERGENCY_ROLE(),
  ]);
  const admin    = dep.config.admin;
  const guardian = dep.config.guardian;

  // ── System reads ────────────────────────────────────────────────────────────
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

  const tvl      = u6(totalAssets);
  const pps      = u6(ppsRaw);
  const investCap = u6(investCapRaw);
  const stratDep  = u6(stratUnderlying);

  // ── Daily tracker ───────────────────────────────────────────────────────────
  const tracker   = readDailyTracker();
  const today     = todayUTC();
  const dailyUsed = tracker.date === today ? tracker.total : 0;

  // ── Per-user positions ──────────────────────────────────────────────────────
  const users: object[] = [];
  for (const [label, addr] of Object.entries(ALLOWLIST)) {
    const [shares, allowed] = await Promise.all([
      vault.balanceOf(addr),
      vault.isAllowed(addr),
    ]);
    const valueRaw = shares > 0n ? await vault.convertToAssets(shares) : 0n;
    const value    = u6(valueRaw);
    users.push({
      label,
      address: addr,
      allowed,
      shares_raw:   shares.toString(),
      shares_fmt:   u18(shares),
      value_usdc:   value,
      headroom_usdc: Math.max(0, PER_USER_CAP - value),
      pct_of_cap:   PER_USER_CAP > 0 ? value / PER_USER_CAP * 100 : 0,
    });
  }

  // ── Build snapshot ──────────────────────────────────────────────────────────
  const snapshot = {
    meta: {
      timestamp:   new Date().toISOString(),
      network:     "base",
      blockNumber: await provider.getBlockNumber(),
      contracts:   dep.contracts,
    },
    roles: {
      admin,
      guardian,
      vault_admin_ok:    vaultHasAdmin,
      vault_guardian_ok: vaultHasGuardian,
      mgr_admin_ok:      mgrHasAdmin,
      mgr_guardian_ok:   mgrHasGuardian,
    },
    systemStatus: {
      systemMode:    Number(systemMode),
      depositsPaused: depPaused,
      redeemsPaused:  redPaused,
      managerPaused,
      depositsEffectivelyBlocked: depPaused || Number(systemMode) !== 0,
    },
    vault: {
      totalAssets_usdc:  tvl,
      totalSupply_fbusdc: u18(totalSupply),
      pricePerShare_usdc: pps,
      availableToInvest:  u6(availToInvest),
    },
    manager: {
      totalManagedAssets: u6(managerTotal),
      idleUnderlying:     u6(managerIdle),
      investCap,
      minIdle:            u6(minIdleRaw),
    },
    strategy: {
      totalUnderlying: stratDep,
    },
    limits: {
      tvl_cap:      TVL_CAP,
      tvl_used:     tvl,
      tvl_pct:      TVL_CAP > 0 ? tvl / TVL_CAP * 100 : 0,
      invest_cap:   investCap,
      invest_used:  stratDep,
      invest_pct:   investCap > 0 ? stratDep / investCap * 100 : 0,
      daily_cap:    DAILY_CAP,
      daily_used:   dailyUsed,
      daily_pct:    DAILY_CAP > 0 ? dailyUsed / DAILY_CAP * 100 : 0,
      daily_date:   today,
      per_user_cap: PER_USER_CAP,
    },
    users,
  };

  // ── Print summary ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(64));
  console.log("  exportLiveRunSnapshot  —  " + snapshot.meta.timestamp);
  console.log("  Block:", snapshot.meta.blockNumber);
  console.log("─".repeat(64));
  console.log(`  systemMode    : ${["Normal ✅", "Paused ⚠️", "EmergencyExit ⛔"][Number(systemMode)]}`);
  console.log(`  TVL           : ${tvl.toFixed(6)} USDC  (${(tvl / TVL_CAP * 100).toFixed(1)}% of cap)`);
  console.log(`  Strategy      : ${stratDep.toFixed(6)} USDC`);
  console.log(`  PPS           : ${pps.toFixed(6)} USDC/fbUSDC`);
  console.log(`  Roles OK      : vault[${vaultHasAdmin ? "✓" : "✗"}admin ${vaultHasGuardian ? "✓" : "✗"}guardian]  mgr[${mgrHasAdmin ? "✓" : "✗"}admin ${mgrHasGuardian ? "✓" : "✗"}guardian]`);
  console.log(`  Users         : ${users.length} allowlisted`);

  // ── Save ────────────────────────────────────────────────────────────────────
  const outPath = saveEvidence(`liverun_snapshot_${Date.now()}.json`, snapshot);
  console.log("─".repeat(64));
  console.log("  Snapshot saved:", outPath);
  console.log("═".repeat(64) + "\n");
}

main().catch(console.error);
