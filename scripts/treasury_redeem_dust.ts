/**
 * treasury_redeem_dust.ts
 *
 * Redeems all dust fbUSDC shares held by the treasury address.
 * Purpose: after test runs, treasury accumulates fee-mint shares against
 * near-zero totalAssets, which drives PPS far below 1.000000. Redeeming
 * these shares resets PPS back to the OZ virtual-share floor (1.000000).
 *
 * Run with the TREASURY private key as signer:
 *   BASE_MAINNET_RPC_URL=<url> PRIVATE_KEY=<treasury_pk> \
 *     npx hardhat run scripts/treasury_redeem_dust.ts --network base
 */

import { ethers } from "hardhat"

const VAULT_ADDR    = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"
const TREASURY_ADDR = "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705"

async function main() {
  const [signer] = await ethers.getSigners()

  // ── Guard: signer must be treasury ──────────────────────────────────────────
  if (signer.address.toLowerCase() !== TREASURY_ADDR.toLowerCase()) {
    throw new Error(
      `Signer is ${signer.address} but expected treasury ${TREASURY_ADDR}.\n` +
      `Export the treasury private key as PRIVATE_KEY and re-run.`
    )
  }

  const vault = await ethers.getContractAt("FundVaultV01", VAULT_ADDR, signer)

  // ── Pre-state ────────────────────────────────────────────────────────────────
  const sharesBefore  = await vault.balanceOf(TREASURY_ADDR)
  const ppsBefore     = await vault.pricePerShare()
  const totalBefore   = await vault.totalAssets()
  const previewUsdc   = await vault.previewRedeem(sharesBefore)

  console.log("\n── Pre-state ───────────────────────────────────────")
  console.log(`  Treasury fbUSDC : ${ethers.formatUnits(sharesBefore, 18)} shares`)
  console.log(`  PPS             : ${ethers.formatUnits(ppsBefore, 6)} USDC/share`)
  console.log(`  Total Assets    : ${ethers.formatUnits(totalBefore, 6)} USDC`)
  console.log(`  Preview redeem  : ${ethers.formatUnits(previewUsdc, 6)} USDC`)

  if (sharesBefore === 0n) {
    console.log("\nNothing to redeem — treasury balance is already zero.")
    return
  }

  // ── Execute redeem ───────────────────────────────────────────────────────────
  console.log("\nSubmitting redeem…")
  const tx = await vault.redeem(sharesBefore, TREASURY_ADDR, TREASURY_ADDR)
  console.log(`  tx: ${tx.hash}`)
  const receipt = await tx.wait()
  console.log(`  confirmed in block ${receipt?.blockNumber}`)

  // ── Post-state ───────────────────────────────────────────────────────────────
  const sharesAfter = await vault.balanceOf(TREASURY_ADDR)
  const ppsAfter    = await vault.pricePerShare()
  const totalAfter  = await vault.totalAssets()

  console.log("\n── Post-state ──────────────────────────────────────")
  console.log(`  Treasury fbUSDC : ${ethers.formatUnits(sharesAfter, 18)} shares`)
  console.log(`  PPS             : ${ethers.formatUnits(ppsAfter, 6)} USDC/share`)
  console.log(`  Total Assets    : ${ethers.formatUnits(totalAfter, 6)} USDC`)

  if (ppsAfter >= 999_000n) {          // ≥ 0.999000 USDC
    console.log("\n✅ PPS reset to ~1.000000 — vault is clean.")
  } else {
    console.log(`\n⚠️  PPS is ${ethers.formatUnits(ppsAfter, 6)} — still off. Check remaining shares.`)
  }

  console.log(`\nBasescan: https://basescan.org/tx/${tx.hash}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
