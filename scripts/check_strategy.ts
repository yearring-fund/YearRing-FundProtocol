import { ethers } from "hardhat"

const VAULT    = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const MANAGER  = "0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54"
const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

async function main() {
  const provider = ethers.provider

  const vault   = await ethers.getContractAt("FundVaultV01",       VAULT,   provider)
  const manager = await ethers.getContractAt("StrategyManagerV01", MANAGER, provider)

  const stratAddr = await manager.strategy()
  const strategy  = await ethers.getContractAt("AaveV3StrategyV01", stratAddr, provider)

  const [
    totalAssets, totalManaged, idleInManager,
    stratUnderlying, stratPaused,
    pps, vaultMode,
  ] = await Promise.all([
    vault.totalAssets(),
    manager.totalManagedAssets(),
    manager.idleUnderlying(),
    strategy.totalUnderlying(),
    manager.paused(),
    vault.pricePerShare(),
    vault.systemMode(),
  ])

  // Aave APR via liquidityRate
  const aavePool = new ethers.Contract(AAVE_POOL, [
    "function getReserveData(address asset) view returns (uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)"
  ], provider)
  const reserveData = await aavePool.getReserveData(USDC)
  const liquidityRate: bigint = reserveData[2]  // currentLiquidityRate in Ray (1e27)
  const aprPct = Number(liquidityRate) / 1e27 * 100

  console.log("\n── Vault ───────────────────────────────────────────")
  console.log("  Total Assets  :", ethers.formatUnits(totalAssets, 6), "USDC")
  console.log("  PPS           :", ethers.formatUnits(pps, 6))
  console.log("  System Mode   :", ["Normal","Paused","EmergencyExit"][Number(vaultMode)] ?? vaultMode)

  console.log("\n── Strategy Manager ────────────────────────────────")
  console.log("  Total Managed :", ethers.formatUnits(totalManaged, 6), "USDC")
  console.log("  Idle in Mgr   :", ethers.formatUnits(idleInManager, 6), "USDC")
  console.log("  Strategy Addr :", stratAddr)
  console.log("  Paused        :", stratPaused)

  console.log("\n── AaveV3Strategy ──────────────────────────────────")
  console.log("  Total Underlying:", ethers.formatUnits(stratUnderlying, 6), "USDC (incl. yield)")

  console.log("\n── Aave V3 USDC Pool ───────────────────────────────")
  console.log("  Supply APR    :", aprPct.toFixed(4), "%  (linear, not compounded)")

  const inAave = totalManaged - idleInManager
  console.log("\n── Summary ─────────────────────────────────────────")
  console.log("  In Vault (idle)    :", ethers.formatUnits(totalAssets - totalManaged > 0n ? totalAssets - totalManaged : 0n, 6), "USDC")
  console.log("  In StrategyManager :", ethers.formatUnits(idleInManager, 6), "USDC")
  console.log("  In Aave (deployed) :", ethers.formatUnits(inAave > 0n ? inAave : 0n, 6), "USDC")
  console.log("  Yield accrued est. : PPS drift =", ethers.formatUnits(pps, 6), "(1.000000 = no yield yet)")
}

main().catch(e => { console.error(e); process.exit(1) })
