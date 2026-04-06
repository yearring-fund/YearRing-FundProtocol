/**
 * withdraw.ts — redeem all user shares from FundVault back to wallet
 * Usage: SHARES=1000 npx hardhat run scripts/step2/withdraw.ts --network base
 *        (SHARES in fbUSDC units, default = all user shares)
 */
import { ethers } from "hardhat";
import { loadDeployment, getContracts, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const { vault } = await getContracts(dep);

  console.log("=".repeat(60));
  console.log("Step2 — Withdraw (redeem shares → USDC to wallet)");
  console.log("=".repeat(60));

  // --- pre-state ---
  const pre = await snapshot("pre_withdraw", dep, signer.address);
  printSnapshot(pre);

  const totalShares = await vault.balanceOf(signer.address);
  const sharesRaw = process.env.SHARES
    ? ethers.parseUnits(process.env.SHARES, 18)
    : totalShares;

  if (sharesRaw === 0n) {
    console.log("\nNo shares to redeem. Aborting.");
    return;
  }
  console.log(`\nRedeeming: ${ethers.formatUnits(sharesRaw, 18)} fbUSDC`);

  // estimated assets
  const estimatedAssets = await vault.convertToAssets(sharesRaw);
  console.log(`Estimated USDC out: ${ethers.formatUnits(estimatedAssets, 6)} USDC`);

  // --- redeem ---
  const redeemTx = await vault.connect(signer).redeem(sharesRaw, signer.address, signer.address, { gasLimit: 400000 });
  const redeemReceipt = await redeemTx.wait();
  console.log("redeem tx:", redeemTx.hash, "block:", redeemReceipt?.blockNumber);

  // --- post-state ---
  const post = await snapshot("post_withdraw", dep, signer.address);
  printSnapshot(post);

  const usdcReceived = post.userUsdc - pre.userUsdc;
  console.log(`\nUSDC received: ${usdcReceived.toFixed(6)} USDC`);

  // --- evidence ---
  const record = {
    action: "withdraw",
    timestamp: new Date().toISOString(),
    shares_redeemed: ethers.formatUnits(sharesRaw, 18),
    estimated_usdc: ethers.formatUnits(estimatedAssets, 6),
    usdc_received: usdcReceived.toFixed(6),
    redeem_tx: redeemTx.hash,
    block: redeemReceipt?.blockNumber,
    pre,
    post,
  };
  saveEvidence(`withdraw_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", { action: "withdraw", tx: redeemTx.hash, shares: ethers.formatUnits(sharesRaw, 18), usdc_received: usdcReceived.toFixed(6), ts: new Date().toISOString() });
}

main().catch(console.error);
