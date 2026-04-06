/**
 * emergency_pause.ts — Step3 one-button emergency pause
 *
 * Pauses ALL deposit and invest entry points with a single command.
 * Does NOT pause redeems — exit priority is always preserved.
 *
 * Actions taken:
 *   1. vault.pauseDeposits()         — blocks new deposits (EMERGENCY_ROLE)
 *   2. vault.setMode(Paused=1)       — blocks deposits + transferToStrategyManager (EMERGENCY_ROLE)
 *   3. manager.pause()               — blocks invest() (EMERGENCY_ROLE)
 *
 * Redeems are intentionally NOT paused. Use PAUSE_REDEEMS=true env var only
 * in extreme circumstances (e.g., suspected re-entrancy on redeem path).
 *
 * Usage:
 *   npx hardhat run scripts/step3/emergency_pause.ts --network base
 *   PAUSE_REDEEMS=true npx hardhat run scripts/step3/emergency_pause.ts --network base
 *
 * Required signer: must hold EMERGENCY_ROLE on both vault and manager.
 */
import { ethers } from "hardhat";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

const PAUSE_REDEEMS = process.env.PAUSE_REDEEMS === "true";

const VAULT_ABI = [
  "function pauseDeposits() external",
  "function pauseRedeems() external",
  "function setMode(uint8) external",
  "function depositsPaused() view returns (bool)",
  "function redeemsPaused() view returns (bool)",
  "function systemMode() view returns (uint8)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function EMERGENCY_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];
const MANAGER_ABI = [
  "function pause() external",
  "function paused() view returns (bool)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function EMERGENCY_ROLE() view returns (bytes32)",
];

function loadDeployment() {
  const p = path.join(__dirname, "../../deployments/base.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const dep    = loadDeployment();
  const [signer] = await ethers.getSigners();

  const vault   = new ethers.Contract(dep.contracts.FundVaultV01,       VAULT_ABI,   signer);
  const manager = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI, signer);

  const VAULT_EMERGENCY   = await vault.EMERGENCY_ROLE();
  const MGR_EMERGENCY     = await manager.EMERGENCY_ROLE();

  // ── Role check ────────────────────────────────────────────────────────────
  const hasVaultEmergency   = await vault.hasRole(VAULT_EMERGENCY,   signer.address);
  const hasManagerEmergency = await manager.hasRole(MGR_EMERGENCY,   signer.address);

  console.log("\n" + "═".repeat(60));
  console.log("  EMERGENCY PAUSE — Step3");
  console.log("  Signer:", signer.address);
  console.log("═".repeat(60));
  console.log(`\n  Vault EMERGENCY_ROLE   : ${hasVaultEmergency   ? "✅ signer holds" : "❌ MISSING"}`);
  console.log(`  Manager EMERGENCY_ROLE : ${hasManagerEmergency ? "✅ signer holds" : "❌ MISSING"}`);

  if (!hasVaultEmergency || !hasManagerEmergency) {
    throw new Error(
      "Signer does not hold EMERGENCY_ROLE on vault and/or manager.\n" +
      "This script must be run by the GUARDIAN wallet."
    );
  }

  // ── Pre-state ─────────────────────────────────────────────────────────────
  const [depPausedBefore, redPausedBefore, modeBefore, mgrPausedBefore] = await Promise.all([
    vault.depositsPaused(), vault.redeemsPaused(), vault.systemMode(), manager.paused(),
  ]);

  console.log("\n  PRE-STATE:");
  console.log(`    depositsPaused : ${depPausedBefore}`);
  console.log(`    redeemsPaused  : ${redPausedBefore}`);
  console.log(`    systemMode     : ${modeBefore} (0=Normal, 1=Paused, 2=EmergencyExit)`);
  console.log(`    manager.paused : ${mgrPausedBefore}`);

  const txs: { label: string; hash: string }[] = [];

  // ── 1. Pause deposits (independent flag) ─────────────────────────────────
  if (!depPausedBefore) {
    console.log("\n  [1/3] Pausing vault deposits...");
    const tx = await vault.pauseDeposits({ gasLimit: 100000 });
    await tx.wait();
    console.log("  ✅ pauseDeposits tx:", tx.hash);
    txs.push({ label: "vault.pauseDeposits", hash: tx.hash });
  } else {
    console.log("\n  [1/3] Vault deposits already paused — skipped.");
  }

  // ── 2. Set vault mode = Paused (also blocks transferToStrategyManager) ───
  if (Number(modeBefore) === 0) {
    console.log("\n  [2/3] Setting vault systemMode → Paused (1)...");
    const tx = await vault.setMode(1, { gasLimit: 150000 });
    await tx.wait();
    console.log("  ✅ setMode(1) tx:", tx.hash);
    txs.push({ label: "vault.setMode(Paused)", hash: tx.hash });
  } else {
    console.log(`\n  [2/3] Vault mode is already ${Number(modeBefore)} (not Normal) — skipped.`);
  }

  // ── 3. Pause manager invest() ─────────────────────────────────────────────
  if (!mgrPausedBefore) {
    console.log("\n  [3/3] Pausing manager (blocks invest())...");
    const tx = await manager.pause({ gasLimit: 100000 });
    await tx.wait();
    console.log("  ✅ manager.pause tx:", tx.hash);
    txs.push({ label: "manager.pause", hash: tx.hash });
  } else {
    console.log("\n  [3/3] Manager already paused — skipped.");
  }

  // ── Optional: pause redeems (extreme case only) ───────────────────────────
  if (PAUSE_REDEEMS) {
    console.log("\n  [OPT] PAUSE_REDEEMS=true — Pausing vault redeems...");
    console.log("  ⚠️  WARNING: This blocks user withdrawals. Use only in extreme emergency.");
    if (!redPausedBefore) {
      const tx = await vault.pauseRedeems({ gasLimit: 100000 });
      await tx.wait();
      console.log("  ✅ pauseRedeems tx:", tx.hash);
      txs.push({ label: "vault.pauseRedeems", hash: tx.hash });
    } else {
      console.log("  Redeems already paused — skipped.");
    }
  } else {
    console.log("\n  [OPT] Redeems NOT paused (exit priority preserved — use PAUSE_REDEEMS=true to override).");
  }

  // ── Post-state ────────────────────────────────────────────────────────────
  const [depPausedAfter, redPausedAfter, modeAfter, mgrPausedAfter] = await Promise.all([
    vault.depositsPaused(), vault.redeemsPaused(), vault.systemMode(), manager.paused(),
  ]);

  console.log("\n  POST-STATE:");
  console.log(`    depositsPaused : ${depPausedAfter}   ${depPausedAfter ? "⛔" : "✅"}`);
  console.log(`    redeemsPaused  : ${redPausedAfter}  ${!redPausedAfter ? "✅ (exit open)" : "⛔ REDEEMS BLOCKED"}`);
  console.log(`    systemMode     : ${modeAfter} (${Number(modeAfter) === 1 ? "Paused ⛔" : Number(modeAfter) === 0 ? "Normal" : "EmergencyExit"})`);
  console.log(`    manager.paused : ${mgrPausedAfter}  ${mgrPausedAfter ? "⛔ (invest blocked)" : "✅"}`);

  console.log("\n  Transactions:");
  for (const t of txs) console.log(`    ${t.label.padEnd(30)} : ${t.hash}`);

  // ── Evidence ──────────────────────────────────────────────────────────────
  const EVIDENCE_DIR = path.join(__dirname, "../../evidence");
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    action: "emergency_pause",
    timestamp: new Date().toISOString(),
    signer: signer.address,
    pauseRedeems: PAUSE_REDEEMS,
    pre: { depPausedBefore, redPausedBefore, modeBefore: Number(modeBefore), mgrPausedBefore },
    post: { depPausedAfter, redPausedAfter, modeAfter: Number(modeAfter), mgrPausedAfter },
    txs,
  };
  const outPath = path.join(EVIDENCE_DIR, `emergency_pause_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log("\n  Evidence saved:", outPath);
  console.log("\n" + "═".repeat(60));
  console.log("  NEXT STEPS:");
  console.log("  1. Investigate the incident");
  console.log("  2. Run: npx hardhat run scripts/step2/state.ts --network base");
  console.log("  3. If safe to resume: ADMIN unpause manually (EMERGENCY_ROLE cannot unpause)");
  console.log("  4. If funds at risk: ADMIN call manager.emergencyExit()");
  console.log("═".repeat(60) + "\n");
}

main().catch(console.error);
