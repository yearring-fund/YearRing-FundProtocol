import { ethers } from "hardhat"

const VAULT        = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const LOCK_LEDGER  = "0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF"
const USDC         = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

const USERS: Record<string, string> = {
  "0xa7C381eA23E12B83500A5D3eEE850068740B0339": "User-A",
  "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705": "Treasury",
}

async function main() {
  const provider = ethers.provider
  const vault   = await ethers.getContractAt("FundVaultV01",   VAULT,       provider)
  const ledger  = await ethers.getContractAt("LockLedgerV02",  LOCK_LEDGER, provider)
  const usdc    = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], USDC, provider)

  const roundId = await vault.currentRoundId()
  const round   = await vault.exitRounds(roundId)

  console.log("\n── Round", roundId.toString(), "────────────────────────────────────────")
  console.log("  isOpen          :", round.isOpen ? "✅ open" : "❌ closed")
  console.log("  availableAssets :", ethers.formatUnits(round.availableAssets, 6), "USDC")
  console.log("  totalClaimed    :", ethers.formatUnits(round.totalClaimed, 6), "USDC")
  console.log("  snapshotId      :", round.snapshotId.toString())
  console.log("  snapshotSupply  :", ethers.formatUnits(round.snapshotTotalSupply, 18), "fbUSDC")
  console.log("  snapshotTime    :", new Date(Number(round.snapshotTimestamp) * 1000).toISOString())

  // Vault USDC balance (must cover availableAssets)
  const vaultUSDC = await usdc.balanceOf(VAULT)
  console.log("\n── Vault USDC balance ───────────────────────────────")
  console.log("  vaultUSDC       :", ethers.formatUnits(vaultUSDC, 6))
  console.log("  covers round?   :", vaultUSDC >= round.availableAssets ? "✅" : "❌ INSUFFICIENT")

  // Per-user eligibility
  console.log("\n── User eligibility ─────────────────────────────────")
  for (const [addr, name] of Object.entries(USERS)) {
    const freeSnap   = await vault.balanceOfAt(addr, round.snapshotId)
    const lockedSnap = await ledger.lockedSharesOfAt(addr, round.snapshotTimestamp)
    const snapBal    = freeSnap + lockedSnap
    const claimed    = await vault.roundSharesClaimed(roundId, addr)
    const eligible   = snapBal - claimed
    const freeCurrent = await vault.balanceOf(addr)

    // Max they can actually burn = min(eligible, freeCurrent)
    const canBurn    = eligible < freeCurrent ? eligible : freeCurrent
    const payout     = snapBal > 0n
      ? (canBurn * round.availableAssets) / round.snapshotTotalSupply
      : 0n

    console.log(`\n  [${name}] ${addr}`)
    console.log(`    snap free    : ${ethers.formatUnits(freeSnap, 18)} fbUSDC`)
    console.log(`    snap locked  : ${ethers.formatUnits(lockedSnap, 18)} fbUSDC`)
    console.log(`    snap total   : ${ethers.formatUnits(snapBal, 18)} fbUSDC`)
    console.log(`    already clmd : ${ethers.formatUnits(claimed, 18)} fbUSDC`)
    console.log(`    eligible     : ${ethers.formatUnits(eligible, 18)} fbUSDC`)
    console.log(`    free (now)   : ${ethers.formatUnits(freeCurrent, 18)} fbUSDC  ← must burn from here`)
    console.log(`    max burn now : ${ethers.formatUnits(canBurn, 18)} fbUSDC`)
    console.log(`    USDC payout  : ${ethers.formatUnits(payout, 6)} USDC`)
    if (lockedSnap > 0n && freeCurrent < eligible)
      console.log(`    ⚠️  Has locked shares — must earlyExit first to burn full allocation`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
