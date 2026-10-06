import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("FundVaultV01", dep.contracts.FundVaultV01);

  const totalShares = await vault.balanceOf(signer.address);
  console.log("Total shares:", ethers.formatUnits(totalShares, 18), "fbUSDC");

  const convertedAssets = await vault.convertToAssets(totalShares);
  console.log("convertToAssets(all):", ethers.formatUnits(convertedAssets, 6), "USDC");

  const totalAssets = await vault.totalAssets();
  console.log("vault.totalAssets:", ethers.formatUnits(totalAssets, 6), "USDC");

  // Check vault USDC balance
  const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
  const usdc = new ethers.Contract(dep.contracts.USDC, usdcAbi, ethers.provider);
  const vaultUsdc = await usdc.balanceOf(dep.contracts.FundVaultV01);
  console.log("Vault idle USDC:", ethers.formatUnits(vaultUsdc, 6), "USDC");
  console.log("Shortfall:", ethers.formatUnits(convertedAssets - vaultUsdc, 6), "USDC");

  // staticCall full redeem
  console.log("\nstaticCall redeem(all shares)...");
  try {
    await vault.connect(signer).redeem.staticCall(totalShares, signer.address, signer.address);
    console.log("OK");
  } catch (e: any) {
    console.log("revert:", e.shortMessage || e.message);
    if (e.reason) console.log("reason:", e.reason);
  }

  // Try redeeming less (vaultUsdc worth of shares)
  const safeShares = vaultUsdc * totalShares / (totalAssets + 1n);
  console.log("\nSafe shares (based on idle USDC):", ethers.formatUnits(safeShares, 18));
  console.log("\nstaticCall redeem(safe shares)...");
  try {
    await vault.connect(signer).redeem.staticCall(safeShares, signer.address, signer.address);
    console.log("OK");
  } catch (e: any) {
    console.log("revert:", e.shortMessage || e.message);
  }
}
main().catch(console.error);
