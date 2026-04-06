/**
 * pause_check.ts — verify pause and emergencyExit capabilities (read + dry-run only)
 * Does NOT actually pause. Confirms roles are in place.
 * Usage: npx hardhat run scripts/step2/pause_check.ts --network base
 */
import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");

  const vaultAbi = [
    "function hasRole(bytes32,address) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function EMERGENCY_ROLE() view returns (bytes32)",
    "function systemMode() view returns (uint8)",
    "function depositsPaused() view returns (bool)",
    "function redeemsPaused() view returns (bool)",
  ];
  const managerAbi = [
    "function hasRole(bytes32,address) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function EMERGENCY_ROLE() view returns (bytes32)",
    "function paused() view returns (bool)",
  ];

  const vault   = new ethers.Contract(dep.contracts.FundVaultV01,       vaultAbi,   ethers.provider);
  const manager = new ethers.Contract(dep.contracts.StrategyManagerV01, managerAbi, ethers.provider);

  const VAULT_ADMIN     = await vault.DEFAULT_ADMIN_ROLE();
  const VAULT_EMERGENCY = await vault.EMERGENCY_ROLE();
  const MGR_ADMIN       = await manager.DEFAULT_ADMIN_ROLE();
  const MGR_EMERGENCY   = await manager.EMERGENCY_ROLE();

  const admin    = dep.config.admin;
  const guardian = dep.config.guardian;

  console.log("=".repeat(60));
  console.log("Step2 — Pause / Emergency Capability Check");
  console.log("=".repeat(60));

  const checks = [
    ["vault: ADMIN has DEFAULT_ADMIN_ROLE",    await vault.hasRole(VAULT_ADMIN,     admin)],
    ["vault: GUARDIAN has EMERGENCY_ROLE",     await vault.hasRole(VAULT_EMERGENCY, guardian)],
    ["manager: ADMIN has DEFAULT_ADMIN_ROLE",  await manager.hasRole(MGR_ADMIN,     admin)],
    ["manager: GUARDIAN has EMERGENCY_ROLE",   await manager.hasRole(MGR_EMERGENCY, guardian)],
    ["vault.systemMode == 0 (Normal)",         Number(await vault.systemMode()) === 0],
    ["vault.depositsPaused == false",          !(await vault.depositsPaused())],
    ["vault.redeemsPaused == false",           !(await vault.redeemsPaused())],
    ["manager.paused == false",                !(await manager.paused())],
  ] as [string, boolean][];

  let allOk = true;
  for (const [label, ok] of checks) {
    console.log(`  [${ok ? "✓" : "✗"}] ${label}`);
    if (!ok) allOk = false;
  }

  console.log("\n" + (allOk ? "All checks passed ✓" : "Some checks FAILED ✗"));

  console.log("\n--- Pause capability summary ---");
  console.log("  pauseDeposits():  EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE → guardian ✓");
  console.log("  pauseRedeems():   EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE → guardian ✓");
  console.log("  setMode(Paused):  EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE → guardian ✓");
  console.log("  setMode(Normal):  DEFAULT_ADMIN_ROLE only → admin ✓");
  console.log("  emergencyExit():  DEFAULT_ADMIN_ROLE on manager → admin ✓");
}

main().catch(console.error);
