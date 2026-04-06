/**
 * query_limits.ts — Step3 limits & allowlist status reader
 *
 * Prints all Step3 operational parameters and allowlist position summary.
 * Read-only: no transactions, no evidence written.
 *
 * Usage:
 *   npx hardhat run scripts/step3/query_limits.ts --network base
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ── Step3 operational limits (single source of truth: LIVE_RUN_LIMITS.md) ─
const PER_USER_CAP = 2_000.0;  // USDC
const TVL_CAP      = 20_000.0; // USDC
const DAILY_CAP    = 5_000.0;  // USDC
const INVEST_CAP   = 20_000.0; // USDC (on-chain via investCap)

// ── Allowlisted addresses ──────────────────────────────────────────────────
const ALLOWLIST: Record<string, string> = {
  "User-A": "0xa7C381eA23E12B83500A5D3eEE850068740B0339",
  "User-B": "0x9d84145F057C2fd532250891E9b02BDe0C92CcB4",
  "User-C": "0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B",
  "User-D": "0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe",
  "User-E": "0x6248C59f517e096258C611578a19F80e594E379B",
};

const DAILY_FILE = path.join(__dirname, "../../evidence/daily_deposits.json");

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
  "function minIdle() view returns (uint256)",
  "function paused() view returns (bool)",
];
const STRATEGY_ABI = [
  "function totalUnderlying() view returns (uint256)",
];

async function main() {
  const dep      = loadDeployment();
  const provider = ethers.provider;

  const vault    = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,    provider);
  const manager  = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI,  provider);
  const strategy = new ethers.Contract(dep.contracts.AaveV3StrategyV01,  STRATEGY_ABI, provider);

  const [
    totalAssets, totalSupply, ppsRaw, systemMode,
    depPaused, redPaused,
    managerTotal, investCapRaw, minIdleRaw, managerPaused,
    stratUnderlying,
  ] = await Promise.all([
    vault.totalAssets(), vault.totalSupply(), vault.pricePerShare(),
    vault.systemMode(), vault.depositsPaused(), vault.redeemsPaused(),
    manager.totalManagedAssets(), manager.investCap(), manager.minIdle(), manager.paused(),
    strategy.totalUnderlying(),
  ]);

  const u6  = (v: bigint) => parseFloat(ethers.formatUnits(v, 6));
  const u18 = (v: bigint) => parseFloat(ethers.formatUnits(v, 18));

  const tvl       = u6(totalAssets);
  const pps       = u6(ppsRaw);
  const investCap = u6(investCapRaw);
  const minIdle   = u6(minIdleRaw);

  const tracker   = readDailyTracker();
  const today     = todayUTC();
  const dailyUsed = tracker.date === today ? tracker.total : 0;

  const SEP  = "─".repeat(60);
  const SEP2 = "═".repeat(60);

  console.log("\n" + SEP2);
  console.log("  Step3 Limits & Allowlist Query  —  " + new Date().toISOString());
  console.log(SEP2);

  // ── On-chain parameters ──────────────────────────────────────────────────
  console.log("\n  ON-CHAIN PARAMETERS");
  console.log(SEP);
  console.log(`  investCap (on-chain)  : ${investCap.toFixed(2)} USDC`);
  console.log(`  minIdle   (on-chain)  : ${minIdle.toFixed(2)} USDC`);
  console.log(`  systemMode            : ${["Normal ✅", "Paused ⚠️", "EmergencyExit ⛔"][Number(systemMode)]}`);
  console.log(`  depositsPaused        : ${depPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  redeemsPaused         : ${redPaused ? "PAUSED ⛔" : "Open ✅"}`);
  console.log(`  managerPaused         : ${managerPaused ? "PAUSED ⛔" : "Active ✅"}`);

  // ── Script-layer operational limits ─────────────────────────────────────
  console.log("\n  SCRIPT-LAYER LIMITS  (enforced by deposit.ts / monitor.ts)");
  console.log(SEP);
  console.log(`  PER_USER_CAP          : ${PER_USER_CAP.toFixed(2)} USDC`);
  console.log(`  TVL_CAP               : ${TVL_CAP.toFixed(2)} USDC`);
  console.log(`  DAILY_CAP             : ${DAILY_CAP.toFixed(2)} USDC`);
  console.log(`  INVEST_CAP (ref)      : ${INVEST_CAP.toFixed(2)} USDC  [matches on-chain]`);

  // ── Live usage ───────────────────────────────────────────────────────────
  console.log("\n  LIVE USAGE");
  console.log(SEP);
  console.log(`  TVL (totalAssets)     : ${tvl.toFixed(6)} / ${TVL_CAP} USDC  (${(tvl / TVL_CAP * 100).toFixed(1)}%)`);
  console.log(`  Strategy deployed     : ${u6(stratUnderlying).toFixed(6)} / ${investCap} USDC  (${(u6(stratUnderlying) / investCap * 100).toFixed(1)}%)`);
  console.log(`  PricePerShare         : ${pps.toFixed(6)} USDC/fbUSDC`);
  console.log(`  Total shares supply   : ${u18(totalSupply).toFixed(6)} fbUSDC`);
  console.log(`  Daily used (${today}) : ${dailyUsed.toFixed(2)} / ${DAILY_CAP} USDC  (${(dailyUsed / DAILY_CAP * 100).toFixed(1)}%)`);

  // ── Allowlist positions ──────────────────────────────────────────────────
  console.log("\n  ALLOWLIST POSITIONS  (per-user cap: " + PER_USER_CAP + " USDC)");
  console.log(SEP);

  for (const [label, addr] of Object.entries(ALLOWLIST)) {
    const [shares, allowed] = await Promise.all([
      vault.balanceOf(addr),
      vault.isAllowed(addr),
    ]);
    const valueRaw = shares > 0n ? await vault.convertToAssets(shares) : 0n;
    const value    = u6(valueRaw);
    const shareFmt = u18(shares);
    const headroom = Math.max(0, PER_USER_CAP - value);
    const pctUsed  = (value / PER_USER_CAP * 100).toFixed(1);
    const status   = !allowed ? "❌ NOT allowlisted" : value >= PER_USER_CAP ? "⛔ AT CAP" : value >= PER_USER_CAP * 0.8 ? "⚠️  near cap" : "✅";
    console.log(`  ${label.padEnd(8)} ${addr.slice(0, 10)}…  allowlist: ${allowed ? "✅" : "❌"}`);
    console.log(`           value: ${value.toFixed(2)} USDC  shares: ${shareFmt.toFixed(4)} fbUSDC  headroom: ${headroom.toFixed(2)} USDC  ${pctUsed}%  ${status}`);
  }

  console.log("\n" + SEP2 + "\n");
}

main().catch(console.error);
