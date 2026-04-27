/**
 * verify_canonical_addresses.ts
 *
 * Read-only script. Determines the canonical on-chain addresses for
 * LockRewardManagerV02 and LockLedgerV02 by comparing candidates from
 * deployments/base.json and ADDRESSES.md, then querying Base mainnet.
 *
 * Usage:
 *   npx hardhat run scripts/verify_canonical_addresses.ts --network base
 *
 * No writes are performed. Safe to run at any time.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

function HDR(s: string) {
  console.log("\n" + "─".repeat(64));
  console.log("  " + s);
  console.log("─".repeat(64));
}
function OK(s: string)   { console.log("  ✅  " + s); }
function WARN(s: string) { console.log("  ⚠️   " + s); }
function INFO(s: string) { console.log("  ℹ️   " + s); }
function ERR(s: string)  { console.log("  ❌  " + s); }

// ── Load deployments/base.json ───────────────────────────────────────────────

function loadDeployment(): Record<string, string> {
  const p = path.join(__dirname, "../deployments/base.json");
  if (!fs.existsSync(p)) throw new Error("deployments/base.json not found");
  return (JSON.parse(fs.readFileSync(p, "utf-8")).contracts ?? {}) as Record<string, string>;
}

// ── Parse ADDRESSES.md ───────────────────────────────────────────────────────

function parseAddressesMd(): Record<string, string> {
  const p = path.join(__dirname, "../ADDRESSES.md");
  const text = fs.readFileSync(p, "utf-8");
  const out: Record<string, string> = {};
  const re = /\|\s*([\w]+)\s*\|\s*`(0x[0-9a-fA-F]{40})`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// ── ABIs (minimal, view-only) ────────────────────────────────────────────────

const ACCESS_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const LOCK_REWARD_MANAGER_ABI = [
  ...ACCESS_ABI,
  "function ledger()   view returns (address)",
  "function vault()    view returns (address)",
  "function treasury() view returns (address)",
  "function rewardToken() view returns (address)",
  "function vaultShares() view returns (address)",
];

const LOCK_LEDGER_ABI = [
  ...ACCESS_ABI,
  "function vaultShares()    view returns (address)",
  "function nextLockId()     view returns (uint256)",
  "function totalLockedShares() view returns (uint256)",
];

// ── Core check ───────────────────────────────────────────────────────────────

interface ContractInfo {
  label:        string;
  address:      string;
  hasCode:      boolean;
  adminIsDeployer?: boolean;
  adminIsTimelock?: boolean;
  refs:         Record<string, string>;   // field → value read from chain
  error?:       string;
}

async function probe(
  provider: ethers.Provider,
  deployer: string,
  timelock: string,
  address:  string,
  label:    string,
  abi:      string[],
  fields:   string[],          // view functions with no args to call
): Promise<ContractInfo> {
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const info: ContractInfo = { label, address, hasCode: false, refs: {} };

  // 1. getCode
  try {
    const code = await provider.getCode(address);
    info.hasCode = code !== "0x" && code.length > 2;
  } catch (e: any) {
    info.error = `getCode failed: ${e.message}`;
    return info;
  }

  if (!info.hasCode) return info;

  // 2. Role checks
  try {
    const ct = new ethers.Contract(address, ACCESS_ABI, provider);
    info.adminIsDeployer = await ct.hasRole(DEFAULT_ADMIN_ROLE, deployer);
    info.adminIsTimelock = await ct.hasRole(DEFAULT_ADMIN_ROLE, timelock);
  } catch (e: any) {
    info.error = `hasRole failed: ${e.message}`;
  }

  // 3. Ref fields
  const ct2 = new ethers.Contract(address, abi, provider);
  for (const fn of fields) {
    try {
      const val = await (ct2 as any)[fn]();
      info.refs[fn] = val.toString();
    } catch {
      info.refs[fn] = "<call failed>";
    }
  }

  return info;
}

function printInfo(info: ContractInfo) {
  const code = info.hasCode ? "✅ contract" : "❌ NO CODE (EOA or not deployed)";
  console.log(`\n  [${info.label}]  ${info.address}`);
  console.log(`    Code      : ${code}`);
  if (!info.hasCode) return;
  console.log(`    adminIsDeployer : ${info.adminIsDeployer}`);
  console.log(`    adminIsTimelock : ${info.adminIsTimelock}`);
  for (const [k, v] of Object.entries(info.refs)) {
    console.log(`    ${k.padEnd(18)}: ${v}`);
  }
  if (info.error) console.log(`    ⚠️  error : ${info.error}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = ethers.provider;
  const network  = await provider.getNetwork();

  if (network.chainId !== 8453n) {
    ERR(`Wrong network. Expected Base mainnet (8453), got ${network.chainId}.`);
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  const dep = loadDeployment();
  const amd = parseAddressesMd();

  const timelock = dep.ProtocolTimelockV02 ?? amd["ProtocolTimelockV02"] ?? "";

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   verify_canonical_addresses — YearRing Fund Protocol       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\nNetwork   : Base mainnet (${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Timelock  : ${timelock || "<not found>"}`);

  // ── Section 1: LockRewardManagerV02 candidates ───────────────────────────
  HDR("1 / 3   LockRewardManagerV02 candidates");

  const lrmCandidates: [string, string][] = [];
  if (dep.LockRewardManagerV02) lrmCandidates.push([dep.LockRewardManagerV02, "deployments/base.json"]);
  if (amd["LockRewardManagerV02"] && amd["LockRewardManagerV02"] !== dep.LockRewardManagerV02)
    lrmCandidates.push([amd["LockRewardManagerV02"], "ADDRESSES.md"]);

  const lrmInfos: ContractInfo[] = [];
  for (const [addr, src] of lrmCandidates) {
    INFO(`Probing ${src}: ${addr}`);
    const info = await probe(
      provider, deployer.address, timelock, addr,
      `LockRewardManagerV02 (${src})`,
      LOCK_REWARD_MANAGER_ABI,
      ["ledger", "vault", "treasury", "rewardToken", "vaultShares"],
    );
    printInfo(info);
    lrmInfos.push(info);
  }

  // ── Section 2: LockLedgerV02 candidates ──────────────────────────────────
  HDR("2 / 3   LockLedgerV02 candidates");

  const llCandidates: [string, string][] = [];
  if (dep.LockLedgerV02) llCandidates.push([dep.LockLedgerV02, "deployments/base.json"]);
  if (amd["LockLedgerV02"] && amd["LockLedgerV02"] !== dep.LockLedgerV02)
    llCandidates.push([amd["LockLedgerV02"], "ADDRESSES.md"]);

  const llInfos: ContractInfo[] = [];
  for (const [addr, src] of llCandidates) {
    INFO(`Probing ${src}: ${addr}`);
    const info = await probe(
      provider, deployer.address, timelock, addr,
      `LockLedgerV02 (${src})`,
      LOCK_LEDGER_ABI,
      ["vaultShares", "nextLockId", "totalLockedShares"],
    );
    printInfo(info);
    llInfos.push(info);
  }

  // ── Section 3: Cross-reference check ─────────────────────────────────────
  HDR("3 / 3   Cross-reference & Canonical Recommendation");

  // Find candidates with code
  const lrmActive = lrmInfos.filter(i => i.hasCode);
  const llActive  = llInfos.filter(i => i.hasCode);

  // Determine canonical LRM: prefer the one whose .ledger() points to an active LL
  const llActiveAddrs = llActive.map(i => i.address.toLowerCase());
  const llDepAddr  = dep.LockLedgerV02?.toLowerCase();
  const llAmdAddr  = amd["LockLedgerV02"]?.toLowerCase();

  let canonicalLRM: ContractInfo | undefined;
  let canonicalLL:  ContractInfo | undefined;

  for (const lrm of lrmActive) {
    const ledgerRef = lrm.refs["ledger"]?.toLowerCase();
    if (ledgerRef && llActiveAddrs.includes(ledgerRef)) {
      canonicalLRM = lrm;
      canonicalLL  = llActive.find(i => i.address.toLowerCase() === ledgerRef);
      break;
    }
  }

  // Fallback: if only one candidate has code on each side, use it
  if (!canonicalLRM && lrmActive.length === 1) canonicalLRM = lrmActive[0];
  if (!canonicalLL  && llActive.length  === 1) canonicalLL  = llActive[0];

  console.log();
  if (canonicalLRM) {
    OK(`Canonical LockRewardManagerV02 : ${canonicalLRM.address}  (source: ${canonicalLRM.label})`);
  } else {
    ERR("Could not determine canonical LockRewardManagerV02 — manual review required.");
  }

  if (canonicalLL) {
    OK(`Canonical LockLedgerV02        : ${canonicalLL.address}  (source: ${canonicalLL.label})`);
  } else {
    ERR("Could not determine canonical LockLedgerV02 — manual review required.");
  }

  // Cross-ref consistency
  if (canonicalLRM && canonicalLL) {
    const lrmLedger = canonicalLRM.refs["ledger"]?.toLowerCase();
    if (lrmLedger === canonicalLL.address.toLowerCase()) {
      OK("LockRewardManagerV02.ledger() points to canonical LockLedgerV02 ✓");
    } else {
      WARN(`LockRewardManagerV02.ledger() = ${canonicalLRM.refs["ledger"]} — does NOT match canonical LockLedgerV02.`);
    }
  }

  // deployments/base.json vs ADDRESSES.md agreement
  console.log();
  const lrmMatch = dep.LockRewardManagerV02?.toLowerCase() === amd["LockRewardManagerV02"]?.toLowerCase();
  const llMatch  = dep.LockLedgerV02?.toLowerCase()         === amd["LockLedgerV02"]?.toLowerCase();

  if (lrmMatch) {
    OK("LockRewardManagerV02: deployments/base.json === ADDRESSES.md");
  } else {
    WARN(`LockRewardManagerV02 mismatch:`);
    console.log(`        deployments/base.json : ${dep.LockRewardManagerV02}`);
    console.log(`        ADDRESSES.md          : ${amd["LockRewardManagerV02"]}`);
    if (canonicalLRM) console.log(`        → Canonical           : ${canonicalLRM.address}`);
  }

  if (llMatch) {
    OK("LockLedgerV02: deployments/base.json === ADDRESSES.md");
  } else {
    WARN(`LockLedgerV02 mismatch:`);
    console.log(`        deployments/base.json : ${dep.LockLedgerV02}`);
    console.log(`        ADDRESSES.md          : ${amd["LockLedgerV02"]}`);
    if (canonicalLL) console.log(`        → Canonical           : ${canonicalLL.address}`);
  }

  // Final recommendation
  console.log();
  if (canonicalLRM && canonicalLL && !lrmMatch || !llMatch) {
    console.log("  📋  Recommended action:");
    console.log(`       Update deployments/base.json and ADDRESSES.md to use:`);
    if (!lrmMatch) console.log(`         LockRewardManagerV02 = ${canonicalLRM?.address}`);
    if (!llMatch)  console.log(`         LockLedgerV02        = ${canonicalLL?.address}`);
  } else if (lrmMatch && llMatch) {
    OK("Both files are already consistent — no update needed.");
  }

  console.log("\n  ✋  Read-only run complete. No writes performed.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
