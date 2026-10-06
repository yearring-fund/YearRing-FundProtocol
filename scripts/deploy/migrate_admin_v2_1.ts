/**
 * migrate_admin_v2_1.ts
 * ──────────────────────
 * Migrates DEFAULT_ADMIN_ROLE from deployer to multisig on all V2.1 contracts.
 *
 * Flow (per contract):
 *   1. grant DEFAULT_ADMIN_ROLE → multisig
 *   2. verify multisig has role on-chain
 *   3. revoke DEFAULT_ADMIN_ROLE from deployer
 *   4. verify deployer no longer has role
 *
 * Safety:
 *   - Grant happens BEFORE revoke. If grant fails, script aborts (no role loss).
 *   - Each contract is verified before moving to the next.
 *   - DEPLOYER retains DEFAULT_ADMIN_ROLE until all contracts have been granted.
 *
 * Usage:
 *   npx hardhat run scripts/deploy/migrate_admin_v2_1.ts --network base
 *
 * WARNING: This is irreversible. Ensure multisig is operational before running.
 *          Test with a dry run first: set DRY_RUN=true in env.
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
  const DRY_RUN = process.env.DRY_RUN === "true";

  console.log("\n" + "=".repeat(70));
  console.log("  V2.1 DEFAULT_ADMIN_ROLE Migration");
  console.log("=".repeat(70));
  console.log(`  Network  : ${network.name}`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Multisig : ${MULTISIG}`);
  console.log(`  Mode     : ${DRY_RUN ? "DRY RUN (no txs)" : "LIVE"}`);
  console.log("=".repeat(70) + "\n");

  if (!DRY_RUN) {
    console.log("  ⚠  LIVE mode — transactions will be submitted.");
    console.log("  ⚠  Grant happens before revoke. Script aborts if grant fails.");
    console.log("  ⚠  Ensure multisig is operational before proceeding.\n");
  }

  const results: Array<{
    contract: string;
    grantDone: boolean;
    multisigHasRole: boolean;
    revokeDone: boolean;
    deployerLostRole: boolean;
  }> = [];

  // ── Phase 1: GRANT to multisig (all contracts) ────────────────────────────
  console.log("  Phase 1 — Grant DEFAULT_ADMIN_ROLE to multisig\n");

  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const alreadyHas = await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG);

    process.stdout.write(`  ${label.padEnd(38)} grant … `);
    if (alreadyHas) {
      console.log("skipped (already has role)");
    } else if (DRY_RUN) {
      console.log("dry-run");
    } else {
      await (await c.grantRole(DEFAULT_ADMIN_ROLE, MULTISIG)).wait();
      console.log("done");
    }

    const nowHas = DRY_RUN ? alreadyHas : await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG);
    if (!DRY_RUN && !nowHas) {
      console.error(`\n  [FATAL] Grant verification failed for ${label}. Aborting.`);
      process.exit(1);
    }
    results.push({ contract: label, grantDone: true, multisigHasRole: nowHas, revokeDone: false, deployerLostRole: false });
  }

  console.log("\n  ✓  All grants complete. Verifying multisig roles...\n");

  // ── Phase 2: Verify multisig has role on ALL contracts before any revoke ──
  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const has = DRY_RUN ? true : await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG);
    console.log(`  ${label.padEnd(38)} multisig has role: ${has ? "✓" : "✗ FAIL"}`);
    if (!DRY_RUN && !has) {
      console.error(`\n  [FATAL] Multisig missing role on ${label}. Aborting revoke phase.`);
      process.exit(1);
    }
  }

  console.log("\n  ✓  Multisig verified on all contracts.\n");

  // ── Phase 3: REVOKE from deployer ─────────────────────────────────────────
  console.log("  Phase 3 — Revoke DEFAULT_ADMIN_ROLE from deployer\n");

  for (let i = 0; i < CONTRACTS.length; i++) {
    const { label, name, address } = CONTRACTS[i];
    const c = await ethers.getContractAt(name, address);
    const stillHas = await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

    process.stdout.write(`  ${label.padEnd(38)} revoke … `);
    if (!stillHas) {
      console.log("skipped (already revoked)");
    } else if (DRY_RUN) {
      console.log("dry-run");
    } else {
      await (await c.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
      console.log("done");
    }

    const lostRole = DRY_RUN ? true : !(await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address));
    if (!DRY_RUN && !lostRole) {
      console.error(`\n  [FATAL] Revoke verification failed for ${label}.`);
      process.exit(1);
    }
    results[i].revokeDone = true;
    results[i].deployerLostRole = lostRole;
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(DRY_RUN ? "  DRY RUN COMPLETE" : "  MIGRATION COMPLETE");
  console.log("=".repeat(70));
  console.log();
  console.log("  Contract".padEnd(42) + "grant  multisig  revoke  deployer-lost");
  console.log("  " + "-".repeat(68));
  for (const r of results) {
    console.log(
      `  ${r.contract.padEnd(40)}` +
      `${r.grantDone ? "✓" : "✗"}      ` +
      `${r.multisigHasRole ? "✓" : "✗"}         ` +
      `${r.revokeDone ? "✓" : "✗"}       ` +
      `${r.deployerLostRole ? "✓" : "✗"}`
    );
  }
  console.log();

  if (!DRY_RUN) {
    // Append to migration record
    const recordPath = path.join(__dirname, "../../docs/deployment/V2_1_ADMIN_MIGRATION_RECORD.md");
    const ts = new Date().toISOString();
    const append = `\n## Migration Executed\n\n- **Timestamp:** ${ts}\n- **Deployer:** ${deployer.address}\n- **Multisig:** ${MULTISIG}\n- **Result:** All ${CONTRACTS.length} contracts migrated\n`;
    fs.appendFileSync(recordPath, append);
    console.log(`  Record updated: ${recordPath}\n`);
  }
}

main().catch(err => {
  console.error("\n[FATAL]", err);
  process.exit(1);
});
