/**
 * treasury_approve.ts — Treasury approvals for LockRewardManagerV02
 *
 * Grants MaxUint256 allowance from treasury to LockRewardManagerV02 for:
 *   1. fbUSDC (FundVaultV01 shares) — rebate transfers
 *   2. RWT (RewardToken) — upfront issuance
 *
 * Requires TREASURY_PRIVATE_KEY in .env matching TREASURY_ADDRESS.
 *
 * Usage:
 *   npx hardhat run scripts/v2/treasury_approve.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const signers = await ethers.getSigners();

  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`No deployment at ${deploymentsPath}.`);
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const treasuryAddr = dep.config?.treasury;
  if (!treasuryAddr) throw new Error("treasury not set in deployment config.");

  const treasurySigner = signers.find(
    s => s.address.toLowerCase() === treasuryAddr.toLowerCase()
  );
  if (!treasurySigner) {
    throw new Error(
      `Treasury signer not found.\n` +
      `  Expected : ${treasuryAddr}\n` +
      `  Available: ${signers.map(s => s.address).join(", ")}\n` +
      `Make sure TREASURY_PRIVATE_KEY is set correctly in .env.`
    );
  }

  console.log("\n" + "=".repeat(62));
  console.log("  Treasury Approvals for LockRewardManagerV02");
  console.log("=".repeat(62));
  console.log("Network   :", network.name);
  console.log("Treasury  :", treasuryAddr);
  console.log("LockRewardMgr:", c.LockRewardManagerV02);

  const vault   = await ethers.getContractAt("FundVaultV01", c.FundVaultV01);
  const rwToken = await ethers.getContractAt("RewardToken",  c.RewardToken);

  // fbUSDC approval
  console.log("\nStep 1 — fbUSDC approval");
  const fbAllowance = await vault.allowance(treasuryAddr, c.LockRewardManagerV02);
  if (fbAllowance >= ethers.MaxUint256 / 2n) {
    console.log("  Already MaxUint256 ✓");
  } else {
    const tx = await vault.connect(treasurySigner).approve(c.LockRewardManagerV02, ethers.MaxUint256);
    await tx.wait();
    console.log("  Set to MaxUint256 ✓  tx:", tx.hash);
  }

  // RWT approval
  console.log("\nStep 2 — RWT approval");
  const rwtAllowance = await rwToken.allowance(treasuryAddr, c.LockRewardManagerV02);
  if (rwtAllowance >= ethers.MaxUint256 / 2n) {
    console.log("  Already MaxUint256 ✓");
  } else {
    const tx = await rwToken.connect(treasurySigner).approve(c.LockRewardManagerV02, ethers.MaxUint256);
    await tx.wait();
    console.log("  Set to MaxUint256 ✓  tx:", tx.hash);
  }

  // Update deployment JSON
  const fbFinal  = await vault.allowance(treasuryAddr, c.LockRewardManagerV02);
  const rwtFinal = await rwToken.allowance(treasuryAddr, c.LockRewardManagerV02);
  if (!dep.v2Setup) dep.v2Setup = {};
  dep.v2Setup.fbUSDCApproved = fbFinal >= ethers.MaxUint256 / 2n;
  dep.v2Setup.rwtApproved    = rwtFinal >= ethers.MaxUint256 / 2n;
  dep.v2Setup.treasuryApprovalAt = new Date().toISOString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));

  console.log("\n" + "=".repeat(62));
  console.log("  fbUSDC approved:", dep.v2Setup.fbUSDCApproved ? "✓" : "✗");
  console.log("  RWT approved   :", dep.v2Setup.rwtApproved    ? "✓" : "✗");
  console.log("=".repeat(62));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
