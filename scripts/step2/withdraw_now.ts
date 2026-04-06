import { ethers } from "hardhat";
import { loadDeployment, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();

  const vault = await ethers.getContractAt("FundVaultV01", dep.contracts.FundVaultV01);

  // Determine shares to redeem
  const totalShares = await vault.balanceOf(signer.address);
  const sharesRaw = process.env.SHARES
    ? ethers.parseUnits(process.env.SHARES, 18)
    : totalShares;

  console.log("=".repeat(60));
  console.log("Step2 — Redeem shares (explicit gasLimit)");
  console.log("Shares to redeem:", ethers.formatUnits(sharesRaw, 18), "fbUSDC");
  console.log("=".repeat(60));

  const pre = await snapshot("pre_withdraw", dep, signer.address);
  printSnapshot(pre);

  const estimatedUsdc = await vault.convertToAssets(sharesRaw);
  console.log("Estimated USDC out:", ethers.formatUnits(estimatedUsdc, 6));

  const tx = await vault.connect(signer).redeem(sharesRaw, signer.address, signer.address, { gasLimit: 400000 });
  const receipt = await tx.wait();
  console.log("redeem tx:", tx.hash, "block:", receipt?.blockNumber, "status:", receipt?.status);

  const post = await snapshot("post_withdraw", dep, signer.address);
  printSnapshot(post);

  const usdcReceived = post.userUsdc - pre.userUsdc;
  console.log(`\nUSDC received: ${usdcReceived.toFixed(6)} USDC`);

  const record = {
    action: "withdraw",
    timestamp: new Date().toISOString(),
    shares_redeemed: ethers.formatUnits(sharesRaw, 18),
    estimated_usdc: ethers.formatUnits(estimatedUsdc, 6),
    usdc_received: usdcReceived.toFixed(6),
    redeem_tx: tx.hash,
    block: receipt?.blockNumber,
    pre, post,
  };
  saveEvidence(`withdraw_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", {
    action: "withdraw", tx: tx.hash,
    shares: ethers.formatUnits(sharesRaw, 18),
    usdc_received: usdcReceived.toFixed(6),
    ts: new Date().toISOString(),
  });
}
main().catch(console.error);
