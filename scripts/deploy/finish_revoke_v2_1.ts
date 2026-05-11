/**
 * finish_revoke_v2_1.ts
 * ──────────────────────
 * Completes DEFAULT_ADMIN_ROLE revoke from deployer on all V2.1 contracts
 * that still have deployer as admin (skips already-revoked ones).
 *
 * Usage:
 *   npx hardhat run scripts/deploy/finish_revoke_v2_1.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const MULTISIG = "0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8";

const CONTRACTS: Array<{ label: string; name: string; address: string }> = [
  { label: "YearRingCoreVaultV21",    name: "YearRingCoreVaultV21",    address: "0x53e45AcB32aCD80F3d215a007fD8FE87390746F8" },
  { label: "CoreStrategyManagerV21",  name: "CoreStrategyManagerV21",  address: "0xc615c0c37524e9997622337cC973aC24C40e0548" },
  { label: "TreasuryV21",             name: "TreasuryV21",             address: "0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2" },
  { label: "AccessStrategyManagerV21",name: "AccessStrategyManagerV21",address: "0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0" },
  { label: "LockManagerV21",          name: "LockManagerV21",          address: "0xCDc679865b5161C7b7cf75584551F5B57828d59F" },
  { label: "RebateManagerV21",        name: "RebateManagerV21",        address: "0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD" },
  { label: "EligibilityModuleV21",    name: "EligibilityModuleV21",    address: "0x7ee0ED49A008e6feA8d196492699a87f878a2022" },
  { label: "PointsLedgerV01",         name: "PointsLedgerV01",         address: "0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe" },
];

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n======================================================================");
  console.log("  V2.1 Admin Revoke — Resume");
  console.log("======================================================================");
  console.log(`  Network  : ${network.name}`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Multisig : ${MULTISIG}`);
  console.log("======================================================================\n");

  // Pre-check: verify multisig has role on all contracts before revoking
  console.log("  Pre-check: multisig role verification\n");
  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const ms = await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG);
    console.log(`  ${label.padEnd(38)} multisig: ${ms ? "✓" : "✗ MISSING — ABORT"}`);
    if (!ms) {
      console.error("\n  [FATAL] Multisig missing role. Do not revoke. Aborting.");
      process.exit(1);
    }
  }
  console.log("\n  ✓ All multisig roles confirmed.\n");

  console.log("  Revoking DEFAULT_ADMIN_ROLE from deployer:\n");
  const summary: Array<{ label: string; status: string }> = [];

  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const stillHas = await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

    process.stdout.write(`  ${label.padEnd(38)} revoke … `);
    if (!stillHas) {
      console.log("skipped (already revoked)");
      summary.push({ label, status: "already done" });
    } else {
      await (await c.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
      const lostRole = !(await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address));
      console.log(lostRole ? "done ✓" : "FAILED ✗");
      if (!lostRole) { console.error("\n  [FATAL] Revoke verification failed."); process.exit(1); }
      summary.push({ label, status: "revoked" });
    }
  }

  console.log("\n======================================================================");
  console.log("  REVOKE COMPLETE");
  console.log("======================================================================\n");
  for (const { label, status } of summary) {
    console.log(`  ${label.padEnd(38)} ${status}`);
  }

  // Append to migration record
  const recordPath = path.join(__dirname, "../../docs/deployment/V2_1_ADMIN_MIGRATION_RECORD.md");
  const ts = new Date().toISOString();
  const append = `\n## Revoke Phase Completed (resume run)\n\n- **Timestamp:** ${ts}\n- **Deployer:** ${deployer.address}\n- **Multisig:** ${MULTISIG}\n- **Result:** All ${CONTRACTS.length} contracts — deployer revoked\n`;
  fs.appendFileSync(recordPath, append);
  console.log(`\n  Record updated: docs/deployment/V2_1_ADMIN_MIGRATION_RECORD.md\n`);
}

main().catch(err => { console.error("\n[FATAL]", err); process.exit(1); });
