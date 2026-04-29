import { ethers } from "hardhat"

const TX      = "0x8077b7916dad004a32819dc90652fec31aa12f93331184d5ff6999c550fe6362"
const VAULT   = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"

// from the Transfer event we decoded
const MINTED  = ethers.parseUnits("0.000185278031262522", 18)

async function main() {
  const provider = ethers.provider

  const receipt = await provider.getTransactionReceipt(TX)
  if (!receipt) { console.log("tx not found"); return }

  const txBlock = receipt.blockNumber
  const prevBlock = txBlock - 1

  console.log("\n── Block info ──────────────────────────────────────")
  const [blkTx, blkPrev] = await Promise.all([
    provider.getBlock(txBlock),
    provider.getBlock(prevBlock),
  ])
  console.log("  tx block    :", txBlock, "  ts:", blkTx?.timestamp)
  console.log("  prev block  :", prevBlock, "  ts:", blkPrev?.timestamp)

  const vault = await ethers.getContractAt("FundVaultV01", VAULT, provider)

  // Query state at the block BEFORE the tx so we get pre-tx values
  const [supply, lastAccrual, bps] = await Promise.all([
    vault.totalSupply({ blockTag: prevBlock }),
    vault.lastFeeAccrual({ blockTag: prevBlock }),
    vault.mgmtFeeBpsPerMonth({ blockTag: prevBlock }),
  ])

  console.log("\n── Pre-tx vault state (block", prevBlock, ") ──────────")
  console.log("  totalSupply     :", ethers.formatUnits(supply, 18), "fbUSDC")
  console.log("  lastFeeAccrual  :", lastAccrual.toString(), "(unix ts)")
  console.log("  mgmtFeeBpsPerMonth:", bps.toString())

  const elapsed = BigInt(blkTx!.timestamp) - lastAccrual
  console.log("\n── Formula inputs ───────────────────────────────────")
  console.log("  elapsed (s)     :", elapsed.toString())

  const SECONDS_PER_MONTH = 2592000n
  const expected = supply * bps * elapsed / (10000n * SECONDS_PER_MONTH)

  console.log("\n── Result ───────────────────────────────────────────")
  console.log("  Expected  :", ethers.formatUnits(expected, 18), "shares")
  console.log("  Actual    :", ethers.formatUnits(MINTED, 18),   "shares")

  const diff = expected > MINTED ? expected - MINTED : MINTED - expected
  console.log("  Diff      :", ethers.formatUnits(diff, 18), "shares")
  console.log("  Match     :", diff === 0n ? "✅ exact" : diff < ethers.parseUnits("0.000000000001", 18) ? "✅ dust only" : "❌ MISMATCH")
}

main().catch(e => { console.error(e); process.exit(1) })
