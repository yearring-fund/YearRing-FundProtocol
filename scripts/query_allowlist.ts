import { ethers } from "hardhat"

const VAULT = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"

async function main() {
  const vault = await ethers.getContractAt("FundVaultV01", VAULT)
  const provider = ethers.provider

  // Fetch AddedToAllowlist and RemovedFromAllowlist events from deployment
  const addFilter    = vault.filters.AllowlistAdded()
  const removeFilter = vault.filters.AllowlistRemoved()

  const addEvents    = await vault.queryFilter(addFilter,    0, "latest")
  const removeEvents = await vault.queryFilter(removeFilter, 0, "latest")

  const removed = new Set(removeEvents.map(e => (e.args as any).account.toLowerCase()))

  const current: string[] = []
  for (const e of addEvents) {
    const addr = (e.args as any).account.toLowerCase()
    if (!removed.has(addr)) current.push(addr)
  }

  console.log(`\nAllowlist add events   : ${addEvents.length}`)
  console.log(`Allowlist remove events: ${removeEvents.length}`)
  console.log(`\nCurrently allowlisted (${current.length}):`)
  for (const addr of current) {
    const shares = await vault.balanceOf(addr)
    console.log(`  ${addr}  shares: ${ethers.formatUnits(shares, 18)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
