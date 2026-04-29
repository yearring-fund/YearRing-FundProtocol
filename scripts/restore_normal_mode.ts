/**
 * restore_normal_mode.ts
 *
 * Restores FundVaultV01 from EmergencyExit → Normal.
 *
 * Steps:
 *   1. Read current state and confirm we are in EmergencyExit.
 *   2. If an exit round is open, close it (closeExitModeRound).
 *   3. Set mode back to Normal (setMode(0)).
 *   4. Print post-restore state for verification.
 *
 * Requires: DEFAULT_ADMIN_ROLE on the vault.
 *
 * Usage:
 *   npx hardhat run scripts/restore_normal_mode.ts --network base
 */
import { ethers } from "hardhat"

const VAULT = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const MODE   = ["Normal", "Paused", "EmergencyExit"]

async function main() {
  const [admin] = await ethers.getSigners()
  const vault   = await ethers.getContractAt("FundVaultV01", VAULT, admin)

  // ── 1. Read current state ──────────────────────────────────────────────────
  const [modeBefore, roundId, totalAssets, totalSupply] = await Promise.all([
    vault.systemMode(),
    vault.currentRoundId(),
    vault.totalAssets(),
    vault.totalSupply(),
  ])

  console.log("\n── Current State ────────────────────────────────────")
  console.log("  systemMode    :", MODE[Number(modeBefore)] ?? modeBefore.toString())
  console.log("  totalAssets   :", ethers.formatUnits(totalAssets, 6), "USDC")
  console.log("  totalSupply   :", ethers.formatUnits(totalSupply, 18), "fbUSDC")
  console.log("  currentRoundId:", roundId.toString())

  if (Number(modeBefore) !== 2) {
    console.log("\n  ⚠️  Not in EmergencyExit mode — nothing to do.")
    return
  }

  // ── 2. Close open exit round if any ───────────────────────────────────────
  if (roundId > 0n) {
    const round = await vault.exitRounds(roundId)
    console.log("\n── Exit Round", roundId.toString(), "────────────────────────────────")
    console.log("  isOpen           :", round.isOpen)
    console.log("  availableAssets  :", ethers.formatUnits(round.availableAssets, 6), "USDC")
    console.log("  totalClaimed     :", ethers.formatUnits(round.totalClaimed, 6), "USDC")
    console.log("  unclaimed        :", ethers.formatUnits(round.availableAssets - round.totalClaimed, 6), "USDC")

    if (round.isOpen) {
      console.log("\n── Step 1: closeExitModeRound ───────────────────────")
      const tx1 = await vault.closeExitModeRound()
      await tx1.wait()
      console.log("  ✅ Round closed — tx:", tx1.hash)
    } else {
      console.log("  Round already closed — skipping.")
    }
  }

  // ── 3. Restore Normal mode ────────────────────────────────────────────────
  console.log("\n── Step 2: setMode(Normal) ──────────────────────────")
  const tx2 = await vault.setMode(0) // 0 = Normal
  await tx2.wait()
  console.log("  ✅ Mode set to Normal — tx:", tx2.hash)

  // ── 4. Post-restore verification ──────────────────────────────────────────
  const [modeAfter, assetsAfter, supplyAfter, lastFeeAccrual] = await Promise.all([
    vault.systemMode(),
    vault.totalAssets(),
    vault.totalSupply(),
    vault.lastFeeAccrual(),
  ])

  console.log("\n── Post-Restore State ───────────────────────────────")
  console.log("  systemMode    :", MODE[Number(modeAfter)] ?? modeAfter.toString())
  console.log("  totalAssets   :", ethers.formatUnits(assetsAfter, 6), "USDC")
  console.log("  totalSupply   :", ethers.formatUnits(supplyAfter, 18), "fbUSDC")
  console.log("  lastFeeAccrual:", new Date(Number(lastFeeAccrual) * 1000).toISOString())

  if (Number(modeAfter) === 0) {
    console.log("\n  ✅ Vault is back in Normal mode.")
  } else {
    console.log("\n  ❌ Mode restore failed — current mode:", MODE[Number(modeAfter)])
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
