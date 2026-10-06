/**
 * revoke_remaining_v2_1.ts
 * ─────────────────────────
 * Revokes DEFAULT_ADMIN_ROLE from deployer on all contracts that still have it.
 * Uses manual receipt polling (no .wait()) to avoid Infura RPC hanging.
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

/** Poll for tx receipt every 2s, timeout 120s. */
async function waitForReceipt(provider: ethers.Provider, txHash: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt && receipt.status === 1) return;
    if (receipt && receipt.status === 0) throw new Error(`Tx reverted: ${txHash}`);
    await new Promise(r => setTimeout(r, 2_000));
  }
  throw new Error(`Timeout waiting for receipt: ${txHash}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider!;

  console.log("\n======================================================================");
  console.log("  V2.1 Admin Revoke — Final");
  console.log("======================================================================");
  console.log(`  Network  : ${network.name}`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Multisig : ${MULTISIG}`);
  console.log("======================================================================\n");

  // Pre-check
  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const ms = await c.hasRole(DEFAULT_ADMIN_ROLE, MULTISIG);
    if (!ms) { console.error(`[FATAL] Multisig missing role on ${label}`); process.exit(1); }
  }
  console.log("  ✓ Multisig confirmed on all contracts.\n");

  const results: string[] = [];

  for (const { label, name, address } of CONTRACTS) {
    const c = await ethers.getContractAt(name, address);
    const stillHas = await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

    process.stdout.write(`  ${label.padEnd(38)} `);

    if (!stillHas) {
      console.log("already revoked ✓");
      results.push(`${label}: already done`);
      continue;
    }

    // Send tx — no .wait()
    process.stdout.write("sending tx … ");
    const tx = await c.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
    process.stdout.write(`${tx.hash.slice(0, 12)}… confirming … `);

    // Poll receipt manually
    await waitForReceipt(provider, tx.hash);

    // Verify on-chain
    const lostRole = !(await c.hasRole(DEFAULT_ADMIN_ROLE, deployer.address));
    console.log(lostRole ? "✓" : "VERIFY FAILED ✗");
    if (!lostRole) { console.error(`\n[FATAL] Revoke verify failed for ${label}`); process.exit(1); }
    results.push(`${label}: revoked`);
  }

  console.log("\n======================================================================");
  console.log("  MIGRATION COMPLETE");
  console.log("======================================================================\n");
  results.forEach(r => console.log(`  ${r}`));

  // Append record
  const recordPath = path.join(__dirname, "../../docs/deployment/V2_1_ADMIN_MIGRATION_RECORD.md");
  const ts = new Date().toISOString();
  fs.appendFileSync(recordPath,
    `\n## Migration Complete\n\n- **Timestamp:** ${ts}\n- **Deployer:** ${deployer.address}\n- **Multisig:** ${MULTISIG}\n- **Result:** All 8 contracts — deployer revoked, multisig is sole admin\n`
  );
  console.log("  Record updated: docs/deployment/V2_1_ADMIN_MIGRATION_RECORD.md\n");
}

main().catch(err => { console.error("\n[FATAL]", err); process.exit(1); });
