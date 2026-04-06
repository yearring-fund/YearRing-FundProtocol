/**
 * lib.ts — shared constants and helpers for liveRun scripts
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Step3 operational limits (single source of truth: docs/LIVE_RUN_LIMITS.md) ─
export const PER_USER_CAP = 2_000.0;   // USDC
export const TVL_CAP      = 20_000.0;  // USDC
export const DAILY_CAP    = 5_000.0;   // USDC

// ── Wallet gas thresholds (single source of truth: docs/LIVE_RUN_MONITORING.md §4.5) ─
export const ADMIN_MIN_ETH     = 0.009;    // ETH — minimum startup balance for ADMIN
export const GUARDIAN_MIN_ETH  = 0.001;    // ETH — minimum startup balance for GUARDIAN
export const ADMIN_WARN_ETH    = 0.00045;  // ETH — 5% of ADMIN_MIN_ETH, trigger refill warning
export const GUARDIAN_WARN_ETH = 0.00005;  // ETH — 5% of GUARDIAN_MIN_ETH, trigger refill warning

// ── Step3 allowlist ────────────────────────────────────────────────────────────
export const ALLOWLIST: Record<string, string> = {
  "User-A": "0xa7C381eA23E12B83500A5D3eEE850068740B0339",
  "User-B": "0x9d84145F057C2fd532250891E9b02BDe0C92CcB4",
  "User-C": "0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B",
  "User-D": "0x747062942aC7e66BD162FAE8F05c7d2a8C9e8DFe",
  "User-E": "0x6248C59f517e096258C611578a19F80e594E379B",
};

// ── ABIs ───────────────────────────────────────────────────────────────────────
export const VAULT_ABI = [
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function availableToInvest() view returns (uint256)",
  "function systemMode() view returns (uint8)",
  "function depositsPaused() view returns (bool)",
  "function redeemsPaused() view returns (bool)",
  "function isAllowed(address) view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function EMERGENCY_ROLE() view returns (bytes32)",
];
export const MANAGER_ABI = [
  "function totalManagedAssets() view returns (uint256)",
  "function idleUnderlying() view returns (uint256)",
  "function investCap() view returns (uint256)",
  "function minIdle() view returns (uint256)",
  "function paused() view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function EMERGENCY_ROLE() view returns (bytes32)",
];
export const STRATEGY_ABI = [
  "function totalUnderlying() view returns (uint256)",
];

// ── Deployment loader ──────────────────────────────────────────────────────────
export function loadDeployment() {
  const p = path.join(__dirname, "../../deployments/base.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ── Daily tracker ──────────────────────────────────────────────────────────────
const DAILY_FILE = path.join(__dirname, "../../evidence/daily_deposits.json");

export function readDailyTracker(): { date: string; total: number } {
  try {
    if (fs.existsSync(DAILY_FILE)) return JSON.parse(fs.readFileSync(DAILY_FILE, "utf8"));
  } catch {}
  return { date: "", total: 0 };
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Formatters ─────────────────────────────────────────────────────────────────
export const u6  = (v: bigint) => parseFloat(ethers.formatUnits(v, 6));
export const u18 = (v: bigint) => parseFloat(ethers.formatUnits(v, 18));

// ── Progress bar ───────────────────────────────────────────────────────────────
export function progressBar(value: number, cap: number): string {
  const p   = cap > 0 ? Math.min(value / cap * 100, 100) : 0;
  const fill = Math.floor(p / 5);
  const bar  = "█".repeat(fill) + "░".repeat(20 - fill);
  const flag = p >= 100 ? " ⛔ AT CAP" : p >= 80 ? " ⚠️  near cap" : "";
  return `${bar} ${p.toFixed(1)}%${flag}`;
}

// ── Evidence writer ────────────────────────────────────────────────────────────
const EVIDENCE_DIR = path.join(__dirname, "../../evidence");

export function saveEvidence(filename: string, data: object): string {
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fullPath = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  return fullPath;
}

// ── System mode label ──────────────────────────────────────────────────────────
export const MODE_LABELS = ["Normal ✅", "Paused ⚠️", "EmergencyExit ⛔"];
