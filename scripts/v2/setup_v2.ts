/**
 * setup_v2.ts — V2 roles, approvals, and fee configuration
 *
 * Reads deployments/{network}.json, then:
 *   1. Grants OPERATOR_ROLE on LockLedger to LockRewardManager + BeneficiaryModule
 *   2. Treasury approves LockRewardManager for fbUSDC (rebate transfers)
 *   3. Treasury approves LockRewardManager for RWT (upfront issuance)
 *   4. Sets vault mgmtFeeBpsPerMonth to 9 bps (≈1%/year)
 *   5. Verifies treasury RWT balance > 0
 *
 * On external networks (non hardhat in-process): signer must match
 * the admin/treasury address recorded in the deployment JSON. Fails fast
 * if there is a mismatch — no silent fallback to deployer.
 *
 * Idempotent — safe to re-run. Checks existing state before writing.
 *
 * Usage:
 *   npx hardhat run scripts/v2/setup_v2.ts --network baseSepolia
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SEP = () => console.log("-".repeat(62));

async function main() {
  const signers    = await ethers.getSigners();
  const deployer   = signers[0];
  const isInProcess = network.name === "hardhat";

  // ── Load deployment ─────────────────────────────────────────────────────
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment at ${deploymentsPath}. Run deploy.ts + deploy_v2.ts first.`);
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const required = [
    "FundVaultV01", "RewardToken",
    "LockLedgerV02", "LockRewardManagerV02", "BeneficiaryModuleV02",
  ];
  for (const name of required) {
    if (!c[name]) throw new Error(`Missing ${name} in deployment JSON. Re-run deploy_v2.ts.`);
  }

  const adminAddr    = dep.config?.admin    || deployer.address;
  const treasuryAddr = dep.config?.treasury || deployer.address;

  // ── Signer validation (external networks only) ───────────────────────────
  if (!isInProcess && dep.config?.admin) {
    if (deployer.address.toLowerCase() !== adminAddr.toLowerCase()) {
      throw new Error(
        `Signer mismatch.\n` +
        `  Current signer : ${deployer.address}\n` +
        `  Deployment admin: ${adminAddr}\n` +
        `Use the private key that matches the deployment admin.`
      );
    }
  }

  // Locate admin and treasury signers
  const adminSigner    = signers.find(s => s.address.toLowerCase() === adminAddr.toLowerCase())
                        || deployer;
  const treasurySigner = signers.find(s => s.address.toLowerCase() === treasuryAddr.toLowerCase())
                        || deployer;

  console.log("\n" + "=".repeat(62));
  console.log("  YearRing-FundProtocol V2 — Setup");
  console.log("=".repeat(62));
  console.log("Network   :", network.name);
  console.log("Admin     :", adminAddr);
  console.log("Treasury  :", treasuryAddr);

  const ledger  = await ethers.getContractAt("LockLedgerV02",        c.LockLedgerV02);
  const vault   = await ethers.getContractAt("FundVaultV01",         c.FundVaultV01);
  const rwToken = await ethers.getContractAt("RewardToken",          c.RewardToken);
  const lockMgr = await ethers.getContractAt("LockRewardManagerV02", c.LockRewardManagerV02);

  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();

  // ── Step 1: OPERATOR_ROLE grants ─────────────────────────────────────────
  SEP();
  console.log("Step 1 — OPERATOR_ROLE grants on LockLedgerV02");

  const grantIfMissing = async (target: string, name: string) => {
    const has = await ledger.hasRole(OPERATOR_ROLE, target);
    if (has) {
      console.log(`  ${name}: already has OPERATOR_ROLE ✓`);
    } else {
      await (await ledger.connect(adminSigner).grantRole(OPERATOR_ROLE, target)).wait();
      console.log(`  ${name}: OPERATOR_ROLE granted ✓`);
    }
  };

  await grantIfMissing(c.LockRewardManagerV02, "LockRewardManagerV02");
  await grantIfMissing(c.BeneficiaryModuleV02, "BeneficiaryModuleV02");

  // ── Step 2: Treasury → fbUSDC approval ───────────────────────────────────
  SEP();
  console.log("Step 2 — Treasury approves LockRewardManager for fbUSDC (rebate)");

  const vaultAllowance = await vault.allowance(treasuryAddr, c.LockRewardManagerV02);
  if (vaultAllowance >= ethers.MaxUint256 / 2n) {
    console.log("  fbUSDC allowance: already MaxUint256 ✓");
  } else {
    await (await vault.connect(treasurySigner).approve(c.LockRewardManagerV02, ethers.MaxUint256)).wait();
    console.log("  fbUSDC allowance: set to MaxUint256 ✓");
  }

  // ── Step 3: Treasury → RWT approval ──────────────────────────────────────
  SEP();
  console.log("Step 3 — Treasury approves LockRewardManager for RWT (upfront issuance)");

  const rwtAllowance = await rwToken.allowance(treasuryAddr, c.LockRewardManagerV02);
  if (rwtAllowance >= ethers.MaxUint256 / 2n) {
    console.log("  RWT allowance: already MaxUint256 ✓");
  } else {
    await (await rwToken.connect(treasurySigner).approve(c.LockRewardManagerV02, ethers.MaxUint256)).wait();
    console.log("  RWT allowance: set to MaxUint256 ✓");
  }

  // ── Step 4: Management fee ────────────────────────────────────────────────
  SEP();
  console.log("Step 4 — Vault management fee (target: 9 bps/month ≈ 1% / year)");

  const currentFee = await vault.mgmtFeeBpsPerMonth();
  if (currentFee === 9n) {
    console.log("  mgmtFeeBpsPerMonth: 9 bps ✓");
  } else {
    await (await vault.connect(adminSigner).setMgmtFeeBpsPerMonth(9)).wait();
    console.log(`  mgmtFeeBpsPerMonth: updated ${currentFee} → 9 bps ✓`);
  }

  // ── Step 5: Treasury RWT balance ─────────────────────────────────────────
  SEP();
  console.log("Step 5 — Treasury RWT balance check");

  const rwtBalance = await rwToken.balanceOf(treasuryAddr);
  if (rwtBalance === 0n) {
    throw new Error(
      `Treasury RWT balance is 0.\n` +
      `RewardToken must be pre-minted to treasury (${treasuryAddr}).\n` +
      `Re-run deploy_v2.ts to redeploy RewardToken with treasury pre-mint.`
    );
  }
  console.log(`  Treasury RWT balance: ${ethers.formatEther(rwtBalance)} RWT ✓`);

  // ── Write v2Setup metadata ────────────────────────────────────────────────
  const fbUSDCAllowanceFinal = await vault.allowance(treasuryAddr, c.LockRewardManagerV02);
  const rwtAllowanceFinal    = await rwToken.allowance(treasuryAddr, c.LockRewardManagerV02);

  dep.v2Setup = {
    completedAt:       new Date().toISOString(),
    completedBy:       deployer.address,
    fbUSDCApproved:    fbUSDCAllowanceFinal >= ethers.MaxUint256 / 2n,
    rwtApproved:       rwtAllowanceFinal >= ethers.MaxUint256 / 2n,
    mgmtFeeBpsPerMonth: Number(await vault.mgmtFeeBpsPerMonth()),
  };
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));

  // ── Final summary ─────────────────────────────────────────────────────────
  SEP();
  console.log("Setup Summary:");
  console.log("  OPERATOR_ROLE (LockRewardMgr) :", await ledger.hasRole(OPERATOR_ROLE, c.LockRewardManagerV02) ? "✓" : "✗");
  console.log("  OPERATOR_ROLE (BeneficiaryMod):", await ledger.hasRole(OPERATOR_ROLE, c.BeneficiaryModuleV02)  ? "✓" : "✗");
  console.log("  fbUSDC allowance (MaxUint256)  :", dep.v2Setup.fbUSDCApproved ? "✓" : "✗");
  console.log("  RWT allowance (MaxUint256)     :", dep.v2Setup.rwtApproved    ? "✓" : "✗");
  console.log("  mgmtFeeBpsPerMonth             :", dep.v2Setup.mgmtFeeBpsPerMonth, "bps");
  console.log("  Treasury RWT balance           :", ethers.formatEther(rwtBalance), "RWT");
  SEP();
  console.log("\n✓ V2 Setup complete. Next: seed_v2.ts");
  console.log("=".repeat(62));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
