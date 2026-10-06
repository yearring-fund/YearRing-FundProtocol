/**
 * monitor.ts — Step3 live-run monitoring snapshot
 *
 * Reads current on-chain state for all allowlisted addresses and
 * checks against Step3 operational limits. Prints a dashboard and
 * saves evidence to evidence/monitor_<ts>.json.
 *
 * Usage:
 *   npx hardhat run scripts/step3/monitor.ts --network base
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ── Step3 operational limits (must match deposit.ts) ──────────────────────
const PER_USER_CAP  = 2_000.0;
const TVL_CAP       = 20_000.0;
const DAILY_CAP     = 5_000.0;
const INVEST_CAP    = 20_000.0;

// ── Allowlisted addresses for Step3 ───────────────────────────────────────
const ALLOWLIST: Record<string, string> = {
  "User-A": "0xa7C381eA23E12B83500A5D3eEE850068740B0339",
  "User-B": "0x9d84145F057C2fd532250891E9b02BDe0C92CcB4",
  "User-C": "0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B",
  "User-D": "0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe",
  "User-E": "0x6248C59f517e096258C611578a19F80e594E379B",
};

const EVIDENCE_DIR = path.join(__dirname, "../../evidence");
const DAILY_FILE   = path.join(EVIDENCE_DIR, "daily_deposits.json");

function loadDeployment() {
  const p = path.join(__dirname, "../../deployments/base.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readDailyTracker(): { date: string; total: number } {
  try {
    if (fs.existsSync(DAILY_FILE)) return JSON.parse(fs.readFileSync(DAILY_FILE, "utf8"));
  } catch {}
  return { date: "", total: 0 };
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function pct(value: number, cap: number): string {
  const p = cap > 0 ? (value / cap * 100) : 0;
  const bar = "█".repeat(Math.floor(p / 5)) + "░".repeat(20 - Math.floor(p / 5));
  return `${bar} ${p.toFixed(1)}%`;
}

function warn(label: string, value: number, cap: number, threshold = 0.8): string {
  if (cap === 0) return "";
  if (value / cap >= 1.0)   return `  ⛔ ${label} EXCEEDED`;
  if (value / cap >= threshold) return `  ⚠️  ${label} approaching cap (${(value/cap*100).toFixed(0)}%)`;
  return "";
}

const VAULT_ABI = [
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function systemMode() view returns (uint8)",
  "function depositsPaused() view returns (bool)",
  "function redeemsPaused() view returns (bool)",
  "function isAllowed(address) view returns (bool)",
];
const MANAGER_ABI = [
  "function totalManagedAssets() view returns (uint256)",
  "function investCap() view returns (uint256)",
  "function paused() view returns (bool)",
];
const STRATEGY_ABI = [
  "function totalUnderlying() view returns (uint256)",
];

async function main() {
  const dep = loadDeployment();
  const provider = ethers.provider;

  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,    provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI,  provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,  STRATEGY_ABI, provider);

  const [
    totalAssets, totalSupply, ppsRaw, systemMode,
    depPaused, redPaused, managerTotal, investCapRaw, managerPaused, stratUnderlying,
  ] = await Promise.all([
    vault.totalAssets(), vault.totalSupply(), vault.pricePerShare(),
    vault.systemMode(), vault.depositsPaused(), vault.redeemsPaused(),
    manager.totalManagedAssets(), manager.investCap(), manager.paused(),
    strategy.totalUnderlying(),
  ]);

  const u6  = (v: bigint) => parseFloat(ethers.formatUnits(v, 6));
  const u18 = (v: bigint) => parseFloat(ethers.formatUnits(v, 18));
  const tvl     = u6(totalAssets);
  const pps     = u6(ppsRaw);
  const investCap = u6(investCapRaw);

  const SEP = "─".repeat(64);
  console.log("\n" + "═".repeat(64));
  console.log("  Step3 Monitor  —  Base Mainnet  —  " + new Date().toISOString());
  console.log("═".repeat(64));

  // ── System status ─────────────────────────────────────────────────────
  const modeLabels = ["Normal ✅", "Paused ⚠️", "EmergencyExit ⛔"];
  console.log(`\n  Vault     : ${dep.contracts.FundVaultV01}`);
  console.log(`  Mode      : ${modeLabels[Number(systemMode)]}`);
  console.log(`  Deposits  : ${depPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  Redeems   : ${redPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  Manager   : ${managerPaused ? "PAUSED ⛔" : "Active ✅"}`);

  // ── Global limits ────────────────────────────────────────────────────
  console.log(`\n${SEP}`);
  console.log("  GLOBAL LIMITS");
  console.log(SEP);
  console.log(`  TVL (totalAssets)   : ${tvl.toFixed(6)} / ${TVL_CAP} USDC`);
  console.log(`  ${pct(tvl, TVL_CAP)}`);
  const warnTvl = warn("TVL", tvl, TVL_CAP);
  if (warnTvl) console.log(warnTvl);

  console.log(`  Strategy deployed   : ${u6(stratUnderlying).toFixed(6)} / ${investCap} USDC (investCap)`);
  console.log(`  PricePerShare       : ${pps.toFixed(6)} USDC/fbUSDC`);
  console.log(`  Total shares supply : ${u18(totalSupply).toFixed(6)} fbUSDC`);

  // ── Daily cap ────────────────────────────────────────────────────────
  const tracker   = readDailyTracker();
  const today     = todayUTC();
  const dailyUsed = tracker.date === today ? tracker.total : 0;
  console.log(`\n  Daily deposits (${today}) : ${dailyUsed.toFixed(2)} / ${DAILY_CAP} USDC`);
  console.log(`  ${pct(dailyUsed, DAILY_CAP)}`);
  const warnDaily = warn("Daily cap", dailyUsed, DAILY_CAP);
  if (warnDaily) console.log(warnDaily);

  // ── Per-user positions ───────────────────────────────────────────────
  console.log(`\n${SEP}`);
  console.log("  USER POSITIONS  (per-user cap: " + PER_USER_CAP + " USDC)");
  console.log(SEP);

  const userRows: object[] = [];
  for (const [label, addr] of Object.entries(ALLOWLIST)) {
    const [shares, allowed] = await Promise.all([
      vault.balanceOf(addr),
      vault.isAllowed(addr),
    ]);
    const valueRaw = shares > 0n ? await vault.convertToAssets(shares) : 0n;
    const value    = u6(valueRaw);
    const shareFmt = u18(shares);
    const warnUser = warn("Per-user", value, PER_USER_CAP);
    console.log(`  ${label.padEnd(8)} ${addr.slice(0,10)}…  ${allowed ? "✅" : "❌"} allowlist`);
    console.log(`           shares: ${shareFmt.toFixed(6)} fbUSDC  value: ${value.toFixed(6)} USDC`);
    console.log(`           ${pct(value, PER_USER_CAP)}`);
    if (warnUser) console.log(`          ${warnUser}`);
    userRows.push({ label, addr, allowed, shares: shareFmt, value_usdc: value });
  }

  console.log(`\n${"═".repeat(64)}\n`);

  // ── Evidence ─────────────────────────────────────────────────────────
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const snapshot = {
    timestamp: new Date().toISOString(),
    tvl, pps, totalSupply: u18(totalSupply),
    stratDeployed: u6(stratUnderlying),
    investCap, tvlCap: TVL_CAP, perUserCap: PER_USER_CAP,
    dailyCap: DAILY_CAP, dailyUsed,
    systemMode: Number(systemMode),
    depositsPaused: depPaused, redeemsPaused: redPaused, managerPaused,
    users: userRows,
  };
  const outPath = path.join(EVIDENCE_DIR, `monitor_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log("Evidence saved:", outPath);
}

main().catch(console.error);
