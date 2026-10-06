/**
 * 从旧 FundVaultV01 取出所有 signers 的全部 shares
 */
import { ethers } from "hardhat";

const OLD_VAULT = "0x8acaec738F9559F8b025c4372d827D3CD3928322";

async function main() {
  const signers = await ethers.getSigners();
  const vault   = await ethers.getContractAt("FundVaultV01", OLD_VAULT);

  console.log("Redeeming all shares from old vault:", OLD_VAULT);
  console.log("=".repeat(50));

  for (const signer of signers) {
    const bal = await vault.balanceOf(signer.address);
    if (bal === 0n) continue;
    const preview = await vault.previewRedeem(bal);
    console.log(`\n${signer.address}`);
    console.log(`  shares : ${ethers.formatUnits(bal, 18)}`);
    console.log(`  preview: ${ethers.formatUnits(preview, 6)} USDC`);
    const tx = await vault.connect(signer).redeem(bal, signer.address, signer.address);
    await tx.wait();
    console.log(`  redeemed ✓  tx: ${tx.hash}`);
  }

  const remaining = await vault.totalAssets();
  console.log("\n" + "=".repeat(50));
  console.log("Old vault remaining:", ethers.formatUnits(remaining, 6), "USDC");
}
main().catch(console.error);
