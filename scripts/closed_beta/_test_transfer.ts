import { ethers } from "hardhat";
async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0x2D2C7BbE92571FF28A23e44d19232e9137F3a310";
  const VAULT_ABI = [
    "function transferToStrategyManager(uint256) external",
    "function availableToInvest() view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function externalTransfersEnabled() view returns (bool)",
    "function systemMode() view returns (uint8)",
  ];
  const vault = new ethers.Contract(VAULT, VAULT_ABI, deployer);

  const [avail, total, extEnabled, mode] = await Promise.all([
    vault.availableToInvest(),
    vault.totalAssets(),
    vault.externalTransfersEnabled(),
    vault.systemMode(),
  ]);
  console.log("availableToInvest:", ethers.formatUnits(avail,6), "USDC");
  console.log("totalAssets      :", ethers.formatUnits(total,6), "USDC");
  console.log("externalTransfers:", extEnabled);
  console.log("systemMode       :", mode.toString(), "(0=Normal)");

  const amt = avail > 1n ? avail - 1n : avail;
  console.log("\ntesting callStatic transferToStrategyManager(" + ethers.formatUnits(amt,6) + ")...");
  try {
    await vault.transferToStrategyManager.staticCall(amt);
    console.log("staticCall: SUCCESS ✓");
  } catch(e: any) {
    console.log("staticCall FAILED:", e.message?.slice(0,200));
    if (e.data) console.log("revert data:", e.data);
  }
}
main().catch(console.error);
