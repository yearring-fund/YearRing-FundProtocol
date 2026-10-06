import { ethers } from "hardhat"

const TX = "0x8077b7916dad004a32819dc90652fec31aa12f93331184d5ff6999c550fe6362"

const KNOWN: Record<string, string> = {
  "0x9dd61ee543a9c51abe7b26a89687c9aeeea98a54": "FundVaultV01",
  "0x129aece0c7659575ae7ab4e78bfe4ca8946b962a": "LockRewardManagerV02",
  "0x2fc1d315c67ae3df2a062f7130d58faa6c0ce9ef": "LockLedgerV02",
  "0xeab54e7cfbe5d35ea5203854b44c8516201534a9": "RewardToken",
  "0xa7c381ea23e12b83500a5d3eee850068740b0339": "User-A",
  "0x9d16eb6a6143a3347f8fa5854b5aa675101fb705": "Treasury",
}
const label = (a: string) => KNOWN[a.toLowerCase()] ?? a

const SIGS: Record<string, string> = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "Approval",
}

async function main() {
  const tx      = await ethers.provider.getTransaction(TX)
  const receipt = await ethers.provider.getTransactionReceipt(TX)
  if (!tx || !receipt) { console.log("tx not found"); return }

  console.log("\n── Transaction ──────────────────────────────────────")
  console.log("  From  :", label(tx.from))
  console.log("  To    :", label(tx.to ?? ""))
  console.log("  Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED")
  console.log("  Block :", receipt.blockNumber)
  console.log("  Gas   :", receipt.gasUsed.toString())

  console.log("\n── Event Logs ───────────────────────────────────────")
  for (const log of receipt.logs) {
    const sig = SIGS[log.topics[0]] ?? log.topics[0].slice(0, 10) + "…"
    console.log(`  [${label(log.address)}] ${sig}`)
    if (SIGS[log.topics[0]] === "Transfer") {
      const from   = "0x" + log.topics[1].slice(26)
      const to     = "0x" + log.topics[2].slice(26)
      const amount = BigInt(log.data)
      console.log(`    ${label(from)} → ${label(to)}`)
      console.log(`    18-dec: ${ethers.formatUnits(amount, 18)}  |  6-dec: ${ethers.formatUnits(amount, 6)}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
