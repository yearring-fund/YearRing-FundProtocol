import { ethers } from "hardhat"

const VAULT       = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const LOCK_MGR    = "0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a"
const LOCK_LEDGER = "0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF"
const RWT         = "0xeAb54e7cFbE5d35ea5203854B44C8516201534A9"
const TREASURY    = "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705"
const USER_A      = "0xa7C381eA23E12B83500A5D3eEE850068740B0339"

async function main() {
  const provider = ethers.provider

  const vault   = await ethers.getContractAt("FundVaultV01",          VAULT,       provider)
  const lockMgr = await ethers.getContractAt("LockRewardManagerV02",  LOCK_MGR,    provider)
  const rwt     = await ethers.getContractAt("RewardToken",            RWT,         provider)

  // User-A fbUSDC state
  const userShares    = await vault.balanceOf(USER_A)
  const userAllowance = await vault.allowance(USER_A, LOCK_MGR)

  // Treasury fbUSDC state (needed for rebate payout)
  const treasuryShares    = await vault.balanceOf(TREASURY)
  const treasuryAllowance = await vault.allowance(TREASURY, LOCK_MGR)

  // RWT state
  const rwtBalanceMgr      = await rwt.balanceOf(LOCK_MGR)
  const rwtBalanceTreasury = await rwt.balanceOf(TREASURY)
  const rwtAllowanceMgr    = await rwt.allowance(TREASURY, LOCK_MGR)

  // LockLedger: does LockRewardManagerV02 have LOCK_MANAGER_ROLE?
  // Check if vault's lockLedger is set correctly
  const vaultLockLedger = await vault.lockLedger()

  console.log("\n── User-A fbUSDC ────────────────────────────────────")
  console.log("  Balance   :", ethers.formatUnits(userShares, 18), "fbUSDC")
  console.log("  Allowance to LockMgr:", ethers.formatUnits(userAllowance, 18), "fbUSDC")

  console.log("\n── Treasury fbUSDC (for rebate payout) ─────────────")
  console.log("  Balance   :", ethers.formatUnits(treasuryShares, 18), "fbUSDC")
  console.log("  Allowance to LockMgr:", ethers.formatUnits(treasuryAllowance, 18), "fbUSDC")

  console.log("\n── RWT Token ────────────────────────────────────────")
  console.log("  LockMgr balance  :", ethers.formatUnits(rwtBalanceMgr, 18), "RWT")
  console.log("  Treasury balance :", ethers.formatUnits(rwtBalanceTreasury, 18), "RWT")
  console.log("  Treasury → LockMgr allowance:", ethers.formatUnits(rwtAllowanceMgr, 18), "RWT")

  console.log("\n── Vault linkage ────────────────────────────────────")
  console.log("  vault.lockLedger():", vaultLockLedger)
  console.log("  Expected          :", LOCK_LEDGER)
  console.log("  Match             :", vaultLockLedger.toLowerCase() === LOCK_LEDGER.toLowerCase())

  // Try simulating lockWithReward
  console.log("\n── Simulation: lockWithReward(1e18, 2592000) ────────")
  try {
    const signer = await ethers.getImpersonatedSigner(USER_A)
    await lockMgr.connect(signer).lockWithReward.staticCall(
      userShares > 0n ? userShares / 2n : ethers.parseUnits("1", 18),
      2592000n
    )
    console.log("  ✅ Simulation PASSED")
  } catch (e: any) {
    console.log("  ❌ Simulation FAILED:", e.message ?? e)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
