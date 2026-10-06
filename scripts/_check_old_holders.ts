import { ethers } from "hardhat";

const OLD_VAULT = "0x8acaec738F9559F8b025c4372d827D3CD3928322";

async function main() {
  const signers = await ethers.getSigners();
  const vault   = await ethers.getContractAt("FundVaultV01", OLD_VAULT);

  console.log("Old vault:", OLD_VAULT);
  console.log("=".repeat(50));

  let totalFound = 0n;
  for (const s of signers) {
    const bal = await vault.balanceOf(s.address);
    if (bal === 0n) continue;
    const preview = await vault.previewRedeem(bal);
    totalFound += preview;
    console.log(`${s.address}`);
    console.log(`  shares: ${ethers.formatUnits(bal, 18)}`);
    console.log(`  USDC  : ${ethers.formatUnits(preview, 6)}`);
  }

  const totalAssets = await vault.totalAssets();
  console.log("\ntotalAssets :", ethers.formatUnits(totalAssets, 6), "USDC");
  console.log("found above :", ethers.formatUnits(totalFound, 6), "USDC");
  const unaccounted = totalAssets - totalFound;
  if (unaccounted > 1000n) {
    console.log("unaccounted :", ethers.formatUnits(unaccounted, 6), "USDC — held by external address");
  }
}
main().catch(console.error);
