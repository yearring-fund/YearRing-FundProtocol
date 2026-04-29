import { ethers } from "hardhat"

const VAULT = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"

const MODE = ["Normal", "Paused", "EmergencyExit"]

async function main() {
  const vault = await ethers.getContractAt("FundVaultV01", VAULT, ethers.provider)

  const [mode, roundId, totalAssets, totalSupply] = await Promise.all([
    vault.systemMode(),
    vault.currentRoundId(),
    vault.totalAssets(),
    vault.totalSupply(),
  ])

  console.log("\n── System State ─────────────────────────────────────")
  console.log("  systemMode    :", MODE[Number(mode)] ?? mode.toString())
  console.log("  totalAssets   :", ethers.formatUnits(totalAssets, 6), "USDC")
  console.log("  totalSupply   :", ethers.formatUnits(totalSupply, 18), "fbUSDC")
  console.log("  currentRoundId:", roundId.toString())

  if (roundId > 0n) {
    const round = await vault.exitRounds(roundId)
    console.log("\n── Exit Round", roundId.toString(), "──────────────────────────────")
    console.log("  isOpen           :", round.isOpen)
    console.log("  availableAssets  :", ethers.formatUnits(round.availableAssets, 6), "USDC")
    console.log("  totalClaimed     :", ethers.formatUnits(round.totalClaimed, 6), "USDC")
    console.log("  snapshotSupply   :", ethers.formatUnits(round.snapshotTotalSupply, 18), "fbUSDC")
    console.log("  snapshotTimestamp:", new Date(Number(round.snapshotTimestamp) * 1000).toISOString())
  }
}

main().catch(e => { console.error(e); process.exit(1) })
