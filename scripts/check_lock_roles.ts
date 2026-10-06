import { ethers } from "hardhat"

const LOCK_MGR     = "0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a"
const LOCK_LEDGER  = "0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF"
const LOCK_BENEFIT = "0xeFcFc0Cdfd20786094D0f62297FF5C7B6358E481"
const VAULT        = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const USER_A       = "0xa7C381eA23E12B83500A5D3eEE850068740B0339"

async function main() {
  const provider = ethers.provider
  const ledger  = await ethers.getContractAt("LockLedgerV02",         LOCK_LEDGER, provider)
  const lockMgr = await ethers.getContractAt("LockRewardManagerV02",  LOCK_MGR,    provider)

  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE()

  const [ledgerMgrHasOp, mgrVault, mgrLedger, mgrBenefit] = await Promise.all([
    ledger.hasRole(OPERATOR_ROLE, LOCK_MGR),
    lockMgr.vault(),
    lockMgr.lockLedger(),
    lockMgr.benefitModule(),
  ])

  console.log("\n── LockLedger OPERATOR_ROLE ─────────────────────────")
  console.log("  OPERATOR_ROLE:", OPERATOR_ROLE)
  console.log("  LockMgr has OPERATOR_ROLE:", ledgerMgrHasOp, ledgerMgrHasOp ? "✅" : "❌ MISSING — root cause")

  console.log("\n── LockRewardManagerV02 refs ────────────────────────")
  console.log("  vault()        :", mgrVault,  mgrVault === VAULT        ? "✅" : "❌")
  console.log("  lockLedger()   :", mgrLedger, mgrLedger === LOCK_LEDGER ? "✅" : "❌")
  console.log("  benefitModule():", mgrBenefit,mgrBenefit === LOCK_BENEFIT? "✅" : "❌")

  // Simulate
  console.log("\n── staticCall lockWithReward(10 fbUSDC, 30d) ────────")
  try {
    const result = await lockMgr.lockWithReward.staticCall(
      ethers.parseUnits("10", 18),
      2592000n,
      { from: USER_A }
    )
    console.log("  ✅ PASSED — lockId:", result.toString())
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    const reason = msg.match(/reverted with reason string '([^']+)'/)?.[1]
      || msg.match(/custom error '([^']+)'/)?.[1]
      || msg.slice(0, 300)
    console.log("  ❌ REVERT:", reason)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
