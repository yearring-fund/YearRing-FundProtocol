import { ethers } from "hardhat"

const VAULT = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const TREASURY = "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705"

async function main() {
  const vault = await ethers.getContractAt("FundVaultV01", VAULT)
  const [bal, supply, assets, pps, bps, lastAccrual] = await Promise.all([
    vault.balanceOf(TREASURY),
    vault.totalSupply(),
    vault.totalAssets(),
    vault.pricePerShare(),
    vault.mgmtFeeBpsPerMonth(),
    vault.lastFeeAccrual(),
  ])
  const preview = await vault.previewRedeem(bal)
  console.log("Treasury shares   :", bal.toString(), "(", ethers.formatUnits(bal, 18), ")")
  console.log("Total supply      :", supply.toString())
  console.log("Total assets (raw):", assets.toString())
  console.log("PPS               :", ethers.formatUnits(pps, 6))
  console.log("Preview redeem    :", preview.toString())
  console.log("mgmtFeeBpsPerMonth:", bps.toString())
  console.log("lastFeeAccrual    :", new Date(Number(lastAccrual) * 1000).toISOString())
}
main().catch(e => { console.error(e); process.exit(1) })
