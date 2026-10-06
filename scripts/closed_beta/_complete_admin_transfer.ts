/**
 * _complete_admin_transfer.ts
 *
 * One-time completion script: renounce DEFAULT_ADMIN_ROLE from deployer
 * on the 5 contracts that were not reached before the process was killed.
 * Also runs Phase 5/6 post-checks.
 *
 * Context: transfer_admin.ts Phase 4 completed on:
 *   ✓ YearRingCoreVaultV01   (already renounced)
 *   ✓ TreasuryV02            (already renounced)
 *   ✓ LockLedgerV02          (already renounced)
 *
 * Remaining:
 *   ⚠ LockPointsRebateManagerV02
 *   ⚠ BeneficiaryModuleV02
 *   ⚠ StrategyManagerV01
 *   ⚠ GovernanceSignalV02
 *   ⚠ ClaimLedger
 */

import { ethers } from "hardhat";

const DEPLOYER  = "0x087ea7F67d9282f0bdC43627b855F79789C6824C";
const MULTISIG  = "0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8";

const REMAINING: [string, string][] = [
  ["LockPointsRebateManagerV02", "0x03987638d7a0522c2e1521714e46D486628c87a0"],
  ["BeneficiaryModuleV02",       "0xcb201afB89E4f5820b3ab19476501ca0A005bab5"],
  ["StrategyManagerV01",         "0x7359388D2402a1C7494bE45ecC20c95C837f8692"],
  ["GovernanceSignalV02",        "0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0"],
  ["ClaimLedger",                "0x311A7b06CF01c0E2Cb22935723B2496F2F493C91"],
];

const ALL_8: [string, string][] = [
  ["YearRingCoreVaultV01",       "0x2D2C7BbE92571FF28A23e44d19232e9137F3a310"],
  ["TreasuryV02",                "0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083"],
  ["LockLedgerV02",              "0x66A4d021642bE3d0916aabA69c415E6D62333A23"],
  ["LockPointsRebateManagerV02", "0x03987638d7a0522c2e1521714e46D486628c87a0"],
  ["BeneficiaryModuleV02",       "0xcb201afB89E4f5820b3ab19476501ca0A005bab5"],
  ["StrategyManagerV01",         "0x7359388D2402a1C7494bE45ecC20c95C837f8692"],
  ["GovernanceSignalV02",        "0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0"],
  ["ClaimLedger",                "0x311A7b06CF01c0E2Cb22935723B2496F2F493C91"],
];

const AC_ABI = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function renounceRole(bytes32,address) external",
];

const OK   = (s: string) => console.log(`  ✓  ${s}`);
const SKIP = (s: string) => console.log(`  –  ${s}`);
const INFO = (s: string) => console.log(`  ℹ  ${s}`);
const FAIL = (s: string) => { console.log(`  ✗  ${s}`); failures++; };

let failures = 0;

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 8453n) throw new Error(`Wrong chain: ${chainId}`);

  console.log("=".repeat(60));
  console.log("  Complete Admin Transfer — Phase 4 Remaining Contracts");
  console.log("=".repeat(60));
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Multisig : ${MULTISIG}`);

  // Get DEFAULT_ADMIN_ROLE value
  const first = new ethers.Contract(REMAINING[0][1], AC_ABI, deployer);
  const DAR = await first.DEFAULT_ADMIN_ROLE();

  console.log("\n--- Phase 4 (continued) · renounce DEFAULT_ADMIN_ROLE from deployer ---");
  for (const [name, addr] of REMAINING) {
    const ct = new ethers.Contract(addr, AC_ABI, deployer);
    const hasIt = await ct.hasRole(DAR, deployer.address);
    if (!hasIt) {
      SKIP(`${name}: deployer already lacks DEFAULT_ADMIN_ROLE`);
    } else {
      const tx = await ct.renounceRole(DAR, deployer.address);
      const rcpt = await tx.wait();
      OK(`${name}: renounceRole ✓  (tx: ${rcpt.hash}  block: ${rcpt.blockNumber})`);
    }
  }

  console.log("\n--- Phase 5 · Post-check: deployer holds NO DEFAULT_ADMIN_ROLE ---");
  for (const [name, addr] of ALL_8) {
    const ct = new ethers.Contract(addr, AC_ABI, ethers.provider);
    const has = await ct.hasRole(DAR, DEPLOYER);
    if (!has) OK(`${name}: deployer NOT admin ✓`);
    else FAIL(`${name}: deployer STILL HAS admin ✗`);
  }

  console.log("\n--- Phase 6 · Post-check: multisig holds DEFAULT_ADMIN_ROLE on all 8 ---");
  for (const [name, addr] of ALL_8) {
    const ct = new ethers.Contract(addr, AC_ABI, ethers.provider);
    const has = await ct.hasRole(DAR, MULTISIG);
    if (has) OK(`${name}: multisig IS admin ✓`);
    else FAIL(`${name}: multisig NOT admin ✗`);
  }

  console.log("\n" + "=".repeat(60));
  if (failures === 0) {
    console.log("  ADMIN TRANSFER COMPLETE ✓");
    console.log(`  Deployer ${DEPLOYER} has NO remaining admin rights.`);
    console.log(`  Protocol admin: ${MULTISIG}`);
  } else {
    console.log(`  ${failures} CHECK(S) FAILED ✗ — investigate before user onboarding.`);
    process.exit(1);
  }
  console.log("=".repeat(60));
}

main().catch(e => { console.error(e); process.exit(1); });
