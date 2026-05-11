/**
 * transfer_admin.ts — YearRing Closed Beta: Admin Role Transfer to Multisig
 *
 * Transfers DEFAULT_ADMIN_ROLE and EMERGENCY_ROLE from the deployer EOA to a
 * designated multisig / ProtocolTimelock address on all protocol contracts.
 *
 * IMPORTANT: Run AFTER setup_roles.ts + verify_deployment.ts have both passed.
 *            The deployer must still hold DEFAULT_ADMIN_ROLE at the time this runs.
 *
 * Execution order (safety-first):
 *   Phase 1: Grant DEFAULT_ADMIN_ROLE → multisig (all contracts)
 *   Phase 2: Grant EMERGENCY_ROLE → guardian (contracts that have it)
 *   Phase 3: Revoke EMERGENCY_ROLE from deployer
 *   Phase 4: Revoke DEFAULT_ADMIN_ROLE from deployer  ← last step
 *   Phase 5: Post-check deployer holds NO admin roles
 *   Phase 6: Post-check multisig holds DEFAULT_ADMIN_ROLE on all contracts
 *
 * Rationale for ordering:
 *   - Grant always precedes revoke. Never revoke before granting to successor.
 *   - DEFAULT_ADMIN_ROLE revoke is the final step; deployer needs it to execute all prior grants/revokes.
 *   - After Phase 4 the deployer is a plain EOA with no protocol permissions.
 *
 * Required env vars:
 *   MULTISIG_ADDRESS   — target admin (multisig or ProtocolTimelock)
 *   GUARDIAN_ADDRESS   — target emergency guardian (may equal MULTISIG_ADDRESS)
 *   PRIVATE_KEY        — deployer key (must currently hold DEFAULT_ADMIN_ROLE)
 *
 * Usage:
 *   npx hardhat run scripts/closed_beta/transfer_admin.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEP  = () => console.log("-".repeat(68));
const HDR  = (s: string) => { SEP(); console.log("  " + s); SEP(); };
const OK   = (msg: string) => console.log(`  ✓  ${msg}`);
const SKIP = (msg: string) => console.log(`  –  ${msg}`);
const INFO = (msg: string) => console.log(`  ℹ  ${msg}`);

let failures = 0;
function assertFalse(label: string, val: boolean) {
  if (!val) { OK(label); } else { console.log(`  ✗  ${label} (still holds role!)`); failures++; }
}
function assertTrue(label: string, val: boolean) {
  if (val) { OK(label); } else { console.log(`  ✗  ${label} (does NOT hold role!)`); failures++; }
}

const AC_ABI = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function grantRole(bytes32,address) external",
  "function revokeRole(bytes32,address) external",
  "function renounceRole(bytes32,address) external",
];
const EMERGENCY_ABI = [
  ...AC_ABI,
  "function EMERGENCY_ROLE() view returns (bytes32)",
];
const GOV_ABI = [
  ...EMERGENCY_ABI,
  "function PROPOSER_ROLE() view returns (bytes32)",
];

async function main() {
  // ── Validate env ────────────────────────────────────────────────────────────
  const multisigAddr = process.env.MULTISIG_ADDRESS;
  const guardianAddr = process.env.GUARDIAN_ADDRESS || multisigAddr;

  if (!multisigAddr || !ethers.isAddress(multisigAddr))
    throw new Error(`Invalid or missing MULTISIG_ADDRESS: ${multisigAddr}`);
  if (!guardianAddr || !ethers.isAddress(guardianAddr))
    throw new Error(`Invalid or missing GUARDIAN_ADDRESS: ${guardianAddr}`);

  // ── Load deployment record ──────────────────────────────────────────────────
  const deploymentsPath = path.join(
    __dirname, "../../deployments", `closed_beta_${network.name}.json`
  );
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `Deployment record not found: ${deploymentsPath}\n` +
      `Run deploy_core_beta.ts → setup_roles.ts → verify_deployment.ts first.`
    );
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts as Record<string, string>;
  function addr(key: string): string {
    const a = c[key];
    if (!a) throw new Error(`Missing contract address for: ${key}`);
    return a;
  }

  const [deployer] = await ethers.getSigners();
  const strategyKey = c["AaveV3StrategyV01"] ? "AaveV3StrategyV01" : "DummyStrategy";

  console.log("\n" + "=".repeat(68));
  console.log("  YearRing Closed Beta — Admin Role Transfer");
  console.log("=".repeat(68));
  console.log("  Network  :", network.name);
  console.log("  Deployer :", deployer.address, "← loses DEFAULT_ADMIN_ROLE");
  console.log("  Multisig :", multisigAddr,  "← gains DEFAULT_ADMIN_ROLE");
  console.log("  Guardian :", guardianAddr,  "← gains EMERGENCY_ROLE");
  console.log("=".repeat(68));
  console.log("\n  ⚠  This is irreversible. Deployer will have NO protocol admin rights after.");
  console.log("     Ensure multisig is operational and guardian key is secure before proceeding.\n");

  // ── Pre-flight: deployer must hold DEFAULT_ADMIN_ROLE on Vault ─────────────
  const vaultAddr = addr("YearRingCoreVaultV01");
  const vaultAc = new ethers.Contract(vaultAddr, AC_ABI, deployer);
  const DEFAULT_ADMIN_ROLE = await vaultAc.DEFAULT_ADMIN_ROLE();
  if (!(await vaultAc.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))) {
    throw new Error(
      `Deployer ${deployer.address} does NOT hold DEFAULT_ADMIN_ROLE on YearRingCoreVaultV01.\n` +
      `Admin may have already been transferred, or ADMIN_ADDRESS was set differently at deploy.\n` +
      `Inspect the deployment record and confirm the correct signer.`
    );
  }
  OK("Pre-flight: deployer holds DEFAULT_ADMIN_ROLE on YearRingCoreVaultV01");

  // ── Contract registry ───────────────────────────────────────────────────────
  // [label, address, hasEmergency, isGovernance]
  const contracts: Array<[string, string, boolean, boolean]> = [
    ["YearRingCoreVaultV01",       addr("YearRingCoreVaultV01"),         true,  false],
    ["TreasuryV02",                addr("TreasuryV02"),                  true,  false],
    ["LockLedgerV02",              addr("LockLedgerV02"),                true,  false],
    ["LockPointsRebateManagerV02", addr("LockPointsRebateManagerV02"),   true,  false],
    ["BeneficiaryModuleV02",       addr("BeneficiaryModuleV02"),         false, false],
    ["StrategyManagerV01",         addr("StrategyManagerV01"),           true,  false],
    ["GovernanceSignalV02",        addr("GovernanceSignalV02"),          false, true ],
    ["ClaimLedger",                addr("ClaimLedger"),                  false, false],
  ];

  // ── PHASE 1: Grant DEFAULT_ADMIN_ROLE to multisig ──────────────────────────
  HDR("Phase 1 · Grant DEFAULT_ADMIN_ROLE → Multisig (all contracts)");

  for (const [label, address] of contracts) {
    const ct = new ethers.Contract(address, AC_ABI, deployer);
    if (await ct.hasRole(DEFAULT_ADMIN_ROLE, multisigAddr)) {
      SKIP(`${label}: multisig already has DEFAULT_ADMIN_ROLE`);
    } else {
      await (await ct.grantRole(DEFAULT_ADMIN_ROLE, multisigAddr)).wait();
      OK(`${label}: grantRole(DEFAULT_ADMIN_ROLE → multisig)`);
    }
  }

  // ── PHASE 2: Grant EMERGENCY_ROLE to guardian ───────────────────────────────
  HDR("Phase 2 · Grant EMERGENCY_ROLE → Guardian (deployer still has DEFAULT_ADMIN_ROLE)");

  for (const [label, address, hasEmergency] of contracts) {
    if (!hasEmergency) continue;
    const ct = new ethers.Contract(address, EMERGENCY_ABI, deployer);
    const EMERGENCY_ROLE = await ct.EMERGENCY_ROLE();

    if (await ct.hasRole(EMERGENCY_ROLE, guardianAddr)) {
      SKIP(`${label}: guardian already has EMERGENCY_ROLE`);
    } else {
      await (await ct.grantRole(EMERGENCY_ROLE, guardianAddr)).wait();
      OK(`${label}: grantRole(EMERGENCY_ROLE → guardian)`);
    }
  }

  // GovernanceSignalV02: grant PROPOSER_ROLE to multisig
  {
    const govCt = new ethers.Contract(addr("GovernanceSignalV02"), GOV_ABI, deployer);
    const PROPOSER_ROLE = await govCt.PROPOSER_ROLE();
    if (await govCt.hasRole(PROPOSER_ROLE, multisigAddr)) {
      SKIP("GovernanceSignalV02: multisig already has PROPOSER_ROLE");
    } else {
      await (await govCt.grantRole(PROPOSER_ROLE, multisigAddr)).wait();
      OK("GovernanceSignalV02: grantRole(PROPOSER_ROLE → multisig)");
    }
  }

  // ── PHASE 3: Revoke EMERGENCY_ROLE from deployer ───────────────────────────
  HDR("Phase 3 · Revoke EMERGENCY_ROLE from Deployer");

  for (const [label, address, hasEmergency] of contracts) {
    if (!hasEmergency) continue;
    const ct = new ethers.Contract(address, EMERGENCY_ABI, deployer);
    const EMERGENCY_ROLE = await ct.EMERGENCY_ROLE();

    if (!(await ct.hasRole(EMERGENCY_ROLE, deployer.address))) {
      SKIP(`${label}: deployer already lacks EMERGENCY_ROLE`);
    } else {
      await (await ct.revokeRole(EMERGENCY_ROLE, deployer.address)).wait();
      OK(`${label}: revokeRole(EMERGENCY_ROLE from deployer)`);
    }
  }

  // GovernanceSignalV02: revoke PROPOSER_ROLE from deployer
  {
    const govCt = new ethers.Contract(addr("GovernanceSignalV02"), GOV_ABI, deployer);
    const PROPOSER_ROLE = await govCt.PROPOSER_ROLE();
    if (!(await govCt.hasRole(PROPOSER_ROLE, deployer.address))) {
      SKIP("GovernanceSignalV02: deployer already lacks PROPOSER_ROLE");
    } else {
      await (await govCt.revokeRole(PROPOSER_ROLE, deployer.address)).wait();
      OK("GovernanceSignalV02: revokeRole(PROPOSER_ROLE from deployer)");
    }
  }

  // ── PHASE 4: Revoke DEFAULT_ADMIN_ROLE from deployer (LAST STEP) ──────────
  HDR("Phase 4 · Revoke DEFAULT_ADMIN_ROLE from Deployer (irreversible — final step)");
  INFO("Deployer renounces DEFAULT_ADMIN_ROLE on all contracts.");

  for (const [label, address] of contracts) {
    const ct = new ethers.Contract(address, AC_ABI, deployer);
    if (!(await ct.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))) {
      SKIP(`${label}: deployer already lacks DEFAULT_ADMIN_ROLE`);
    } else {
      // Use renounceRole (msg.sender == account) — safer than revokeRole for own role.
      await (await ct.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
      OK(`${label}: renounceRole(DEFAULT_ADMIN_ROLE)`);
    }
  }

  // ── PHASE 5: Post-check deployer holds NO admin roles ─────────────────────
  HDR("Phase 5 · Post-Check: Deployer Holds No Admin Roles");

  for (const [label, address, hasEmergency] of contracts) {
    const ct = new ethers.Contract(address, hasEmergency ? EMERGENCY_ABI : AC_ABI, ethers.provider);
    assertFalse(`${label}: deployer NOT DEFAULT_ADMIN_ROLE`, await ct.hasRole(DEFAULT_ADMIN_ROLE, deployer.address));
    if (hasEmergency) {
      const EMERGENCY_ROLE = await ct.EMERGENCY_ROLE();
      assertFalse(`${label}: deployer NOT EMERGENCY_ROLE`, await ct.hasRole(EMERGENCY_ROLE, deployer.address));
    }
  }

  // ── PHASE 6: Post-check multisig holds DEFAULT_ADMIN_ROLE everywhere ───────
  HDR("Phase 6 · Post-Check: Multisig Holds DEFAULT_ADMIN_ROLE (all contracts)");

  for (const [label, address] of contracts) {
    const ct = new ethers.Contract(address, AC_ABI, ethers.provider);
    assertTrue(`${label}: multisig IS DEFAULT_ADMIN_ROLE`, await ct.hasRole(DEFAULT_ADMIN_ROLE, multisigAddr));
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(68));
  if (failures === 0) {
    console.log("  ADMIN TRANSFER COMPLETE ✓");
    console.log("  Deployer EOA has no remaining protocol admin rights.");
    console.log(`  Protocol admin: ${multisigAddr}`);
    console.log(`  Guardian:       ${guardianAddr}`);
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗`);
    console.log("  Investigate before proceeding to user onboarding.");
  }
  console.log("=".repeat(68));

  console.log("\n  ── Next Steps ─────────────────────────────────────────────");
  console.log("  1. Run check_base_state.ts --network base to verify final state.");
  console.log("  2. Update ROLE_RECORD.md: fill in multisig address, mark deployer revoked.");
  console.log("  3. Update DEPLOYMENT_RECORD.md: record transfer tx hashes.");
  console.log("  4. Confirm multisig can execute a test transaction (e.g., read-only call).");
  console.log("  5. Begin closed beta user onboarding (addToAllowlist via multisig).\n");

  if (failures > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
