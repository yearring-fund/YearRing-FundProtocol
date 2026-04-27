/**
 * transfer_admin_to_timelock.ts
 *
 * Migrates DEFAULT_ADMIN_ROLE from the deployer EOA to ProtocolTimelockV02
 * on every protocol contract that holds admin authority.
 *
 * Safety model after migration:
 *   • All non-emergency admin ops must go through Timelock (24h delay)
 *   • EMERGENCY_ROLE stays on guardian — can pause/setMode without timelock
 *   • PROPOSER_ROLE on Timelock stays on admin address — schedules ops
 *   • Deployer's TIMELOCK_ADMIN_ROLE is optionally renounced at the end
 *
 * Usage:
 *   # Dry-run (default) — shows every action, executes nothing
 *   npx hardhat run scripts/transfer_admin_to_timelock.ts --network base
 *
 *   # Live execution
 *   EXECUTE=true npx hardhat run scripts/transfer_admin_to_timelock.ts --network base
 *
 *   # Live + renounce deployer's TIMELOCK_ADMIN_ROLE at the end
 *   EXECUTE=true RENOUNCE_TIMELOCK_ADMIN=true npx hardhat run scripts/transfer_admin_to_timelock.ts --network base
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const EXECUTE               = process.env.EXECUTE              === "true";
const RENOUNCE_TIMELOCK_ADM = process.env.RENOUNCE_TIMELOCK_ADMIN === "true";

// Role bytes32 constants (keccak256 — matches contracts exactly)
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;                              // 0x00
const EMERGENCY_ROLE     = ethers.id("EMERGENCY_ROLE");
const PROPOSER_ROLE_TL   = ethers.id("PROPOSER_ROLE");                  // on TimelockController
const TIMELOCK_ADMIN_ROLE = ethers.id("TIMELOCK_ADMIN_ROLE");

// Minimal ABIs — only what this script needs
const ACCESS_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function renounceRole(bytes32 role, address account)",
];
const TIMELOCK_ABI = [
  ...ACCESS_ABI,
  "function getMinDelay() view returns (uint256)",
];

// ── Load deployment ──────────────────────────────────────────────────────────

function loadDeployment(): Record<string, string> {
  const p = path.join(__dirname, "../deployments/base.json");
  if (!fs.existsSync(p)) throw new Error("deployments/base.json not found");
  const d = JSON.parse(fs.readFileSync(p, "utf-8"));
  return d.contracts as Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function HDR(s: string) {
  console.log("\n" + "─".repeat(60));
  console.log("  " + s);
  console.log("─".repeat(60));
}

function OK(s: string)   { console.log("  ✅  " + s); }
function INFO(s: string) { console.log("  ℹ️   " + s); }
function WARN(s: string) { console.log("  ⚠️   " + s); }
function ACT(s: string)  { console.log("  🔧  " + s); }

async function doGrant(contract: ethers.Contract, role: bytes32, addr: string, label: string) {
  const already = await contract.hasRole(role, addr);
  if (already) {
    OK(`${label} already has role on ${await contract.getAddress()}`);
    return;
  }
  ACT(`grantRole(${label}) on ${await contract.getAddress()}`);
  if (EXECUTE) {
    const tx = await contract.grantRole(role, addr);
    await tx.wait();
    OK(`Granted. tx=${tx.hash}`);
  } else {
    INFO("(dry-run — skipped)");
  }
}

async function doRevoke(contract: ethers.Contract, role: bytes32, addr: string, label: string) {
  const has = await contract.hasRole(role, addr);
  if (!has) {
    OK(`${label} already lacks role on ${await contract.getAddress()} — nothing to revoke`);
    return;
  }
  ACT(`revokeRole(${label}) on ${await contract.getAddress()}`);
  if (EXECUTE) {
    const tx = await contract.revokeRole(role, addr);
    await tx.wait();
    OK(`Revoked. tx=${tx.hash}`);
  } else {
    INFO("(dry-run — skipped)");
  }
}

async function doRenounce(contract: ethers.Contract, role: bytes32, addr: string, label: string) {
  const has = await contract.hasRole(role, addr);
  if (!has) {
    OK(`${label} already lacks role — nothing to renounce`);
    return;
  }
  ACT(`renounceRole(${label}) by ${label}`);
  if (EXECUTE) {
    const tx = await contract.renounceRole(role, addr);
    await tx.wait();
    OK(`Renounced. tx=${tx.hash}`);
  } else {
    INFO("(dry-run — skipped)");
  }
}

// bytes32 is just a string in ethers v6
type bytes32 = string;

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();

  // Guard: this script must run on Base mainnet only
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 8453n) {
    console.error(`\n❌  Wrong network. This script must run on Base mainnet (chainId 8453).`);
    console.error(`   Detected chainId: ${chainId}`);
    console.error(`   Run with: npx hardhat run scripts/transfer_admin_to_timelock.ts --network base`);
    process.exit(1);
  }

  const c = loadDeployment();

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   transfer_admin_to_timelock — YearRing Fund Protocol    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\nMode      : ${EXECUTE ? "🔴 LIVE EXECUTION" : "🟡 DRY-RUN (set EXECUTE=true to execute)"}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Timelock  : ${c.ProtocolTimelockV02}`);

  // ── Step 0: Pre-flight checks ────────────────────────────────────────────
  HDR("Step 0 / 4   Pre-flight checks");

  const timelock = new ethers.Contract(c.ProtocolTimelockV02, TIMELOCK_ABI, deployer);
  const minDelay = await timelock.getMinDelay();
  INFO(`Timelock MIN_DELAY : ${Number(minDelay) / 3600}h`);

  const tlAdminOk     = await timelock.hasRole(TIMELOCK_ADMIN_ROLE, deployer.address);
  const tlProposerOk  = await timelock.hasRole(PROPOSER_ROLE_TL,    c.config?.admin ?? deployer.address);

  if (!tlAdminOk) {
    WARN("Deployer does NOT hold TIMELOCK_ADMIN_ROLE — cannot manage Timelock roles. Aborting.");
    process.exit(1);
  }
  OK(`Deployer holds TIMELOCK_ADMIN_ROLE on Timelock`);

  if (!tlProposerOk) {
    WARN("Admin address does NOT hold PROPOSER_ROLE on Timelock — granting now.");
  } else {
    OK(`Admin (${c.config?.admin ?? deployer.address}) holds PROPOSER_ROLE on Timelock`);
  }

  // ── Step 1: Ensure admin has PROPOSER_ROLE on Timelock ──────────────────
  HDR("Step 1 / 4   Ensure PROPOSER_ROLE on Timelock");
  INFO("Admin must retain PROPOSER_ROLE to schedule future operations.");

  // deployer was set as proposer at deploy time (and admin == deployer on this deployment),
  // so this is likely already set. Still verify + grant defensively.
  await doGrant(timelock, PROPOSER_ROLE_TL, deployer.address, "deployer/admin");

  // ── Step 2: Grant DEFAULT_ADMIN_ROLE to Timelock on each contract ────────
  HDR("Step 2 / 4   Grant DEFAULT_ADMIN_ROLE → Timelock");
  INFO("Grant first, verify, THEN revoke from deployer (never leave contracts admin-less).");

  const adminTargets: [string, string][] = [
    [c.FundVaultV01,         "FundVaultV01        "],
    [c.StrategyManagerV01,   "StrategyManagerV01  "],
    [c.LockLedgerV02,        "LockLedgerV02       "],
    [c.LockRewardManagerV02, "LockRewardManagerV02"],
    [c.BeneficiaryModuleV02, "BeneficiaryModuleV02"],
    [c.GovernanceSignalV02,  "GovernanceSignalV02 "],
    [c.ClaimLedger,          "ClaimLedger         "],
  ];

  for (const [addr, label] of adminTargets) {
    if (!addr) { WARN(`${label.trim()} address not in deployment — skipping`); continue; }
    const ct = new ethers.Contract(addr, ACCESS_ABI, deployer);
    await doGrant(ct, DEFAULT_ADMIN_ROLE, c.ProtocolTimelockV02, `Timelock → ${label.trim()}`);
  }

  // ── Step 3: Verify Timelock now has DEFAULT_ADMIN on all contracts ───────
  HDR("Step 3 / 4   Verify Timelock holds DEFAULT_ADMIN_ROLE");

  if (EXECUTE) {
    let allOk = true;
    for (const [addr, label] of adminTargets) {
      if (!addr) continue;
      const ct = new ethers.Contract(addr, ACCESS_ABI, deployer);
      const ok = await ct.hasRole(DEFAULT_ADMIN_ROLE, c.ProtocolTimelockV02);
      if (ok) { OK(`${label.trim()}: ✓`); }
      else    { WARN(`${label.trim()}: MISSING — aborting revoke step`); allOk = false; }
    }
    if (!allOk) {
      WARN("Verification failed. Deployer admin NOT revoked. Re-run after investigating.");
      process.exit(1);
    }
  } else {
    INFO("(dry-run — verification skipped)");
  }

  // ── Step 4: Revoke DEFAULT_ADMIN_ROLE from deployer ────────────────────
  HDR("Step 4 / 4   Revoke DEFAULT_ADMIN_ROLE from deployer");
  INFO("After this, the deployer EOA has NO admin authority on protocol contracts.");
  INFO("All admin ops must go through the Timelock (24h delay).");
  INFO("EMERGENCY_ROLE on guardian is unaffected — pause still bypasses Timelock.");

  for (const [addr, label] of adminTargets) {
    if (!addr) continue;
    const ct = new ethers.Contract(addr, ACCESS_ABI, deployer);
    await doRevoke(ct, DEFAULT_ADMIN_ROLE, deployer.address, `deployer ← ${label.trim()}`);
  }

  // ── Optional: renounce TIMELOCK_ADMIN_ROLE from deployer ────────────────
  if (RENOUNCE_TIMELOCK_ADM) {
    HDR("Optional   Renounce TIMELOCK_ADMIN_ROLE from deployer");
    WARN("After this, no one can change Timelock roles. This is irreversible.");
    WARN("Ensure PROPOSER_ROLE is on the correct multisig address before proceeding.");
    await doRenounce(timelock, TIMELOCK_ADMIN_ROLE, deployer.address, "deployer");
  } else {
    INFO("RENOUNCE_TIMELOCK_ADMIN not set — skipping TIMELOCK_ADMIN_ROLE renounce.");
    INFO("Deployer still holds TIMELOCK_ADMIN_ROLE; can modify Timelock roles.");
    INFO("Set RENOUNCE_TIMELOCK_ADMIN=true once a multisig holds PROPOSER_ROLE.");
  }

  // ── Final summary ────────────────────────────────────────────────────────
  HDR("Summary");
  if (EXECUTE) {
    OK("Migration complete. Verify on BaseScan:");
    for (const [addr, label] of adminTargets) {
      if (addr) console.log(`    ${label.trim()}: https://basescan.org/address/${addr}#readContract`);
    }
    console.log("\n  Next steps:");
    console.log("  1. Confirm DEFAULT_ADMIN_ROLE = Timelock on each contract (BaseScan → Access Control)");
    console.log("  2. Test a Timelock schedule→execute cycle on a non-critical param (e.g. mgmt fee)");
    console.log("  3. Once confident, set RENOUNCE_TIMELOCK_ADMIN=true and re-run to finalize");
  } else {
    INFO("Dry-run complete. Review the actions above, then set EXECUTE=true to apply.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
