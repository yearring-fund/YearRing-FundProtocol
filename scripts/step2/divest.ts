/**
 * divest.ts — divest USDC from Aave V3 back to StrategyManager, then return to Vault
 * Usage: AMOUNT=50 npx hardhat run scripts/step2/divest.ts --network base
 *        (AMOUNT in USDC — how much to divest, default = all)
 */
import { ethers } from "hardhat";
import { loadDeployment, getContracts, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const { manager, strategy } = await getContracts(dep);

  console.log("=".repeat(60));
  console.log("Step2 — Divest (Aave V3 → StrategyManager → Vault)");
  console.log("=".repeat(60));

  // --- pre-state ---
  const pre = await snapshot("pre_divest", dep, signer.address);
  printSnapshot(pre);

  const totalInAave = await strategy.totalUnderlying();
  const amountRaw = process.env.AMOUNT
    ? ethers.parseUnits(process.env.AMOUNT, 6)
    : totalInAave;

  if (amountRaw === 0n) {
    console.log("\nNothing in Aave to divest. Aborting.");
    return;
  }
  console.log(`\nDivest amount: ${ethers.formatUnits(amountRaw, 6)} USDC`);

  // --- divest from Aave ---
  console.log("\nStep 1: manager.divest...");
  const divestTx = await manager.connect(signer).divest(amountRaw, { gasLimit: 500000 });
  const divestReceipt = await divestTx.wait();
  console.log("divest tx:", divestTx.hash, "block:", divestReceipt?.blockNumber);

  // --- return to vault ---
  const idleNow = await manager.idleUnderlying();
  console.log(`\nStep 2: manager.returnToVault (${ethers.formatUnits(idleNow, 6)} USDC)...`);
  const returnTx = await manager.connect(signer).returnToVault(idleNow, { gasLimit: 200000 });
  const returnReceipt = await returnTx.wait();
  console.log("returnToVault tx:", returnTx.hash, "block:", returnReceipt?.blockNumber);

  // --- dust detection & auto-cleanup ---
  // Aave aToken accrual can leave a tiny residue after divest. If uncleaned,
  // it inflates PPS and causes ERC20 transfer overflow on subsequent full redeem.
  // Only run cleanup when no explicit AMOUNT was given (i.e. full-divest mode).
  const DUST_THRESHOLD = ethers.parseUnits("1", 6); // < 1 USDC is considered dust
  if (!process.env.AMOUNT) {
    const dustLeft = await strategy.totalUnderlying();
    if (dustLeft > 0n && dustLeft < DUST_THRESHOLD) {
      console.log(`\n[dust] Detected ${ethers.formatUnits(dustLeft, 6)} USDC residual in Aave. Auto-cleaning...`);
      const dustDivestTx = await manager.connect(signer).divest(dustLeft, { gasLimit: 500000 });
      const dustDivestReceipt = await dustDivestTx.wait();
      console.log("dust divest tx:", dustDivestTx.hash, "block:", dustDivestReceipt?.blockNumber);
      const dustIdle = await manager.idleUnderlying();
      const dustReturnTx = await manager.connect(signer).returnToVault(dustIdle, { gasLimit: 200000 });
      const dustReturnReceipt = await dustReturnTx.wait();
      console.log("dust returnToVault tx:", dustReturnTx.hash, "block:", dustReturnReceipt?.blockNumber);
      console.log("[dust] Cleanup complete.");
    } else if (dustLeft >= DUST_THRESHOLD) {
      console.log(`\n[dust] WARNING: ${ethers.formatUnits(dustLeft, 6)} USDC remains in Aave after divest.`);
      console.log("       This exceeds dust threshold. Run divest again with AMOUNT set explicitly.");
    }
  }

  // --- post-state ---
  const post = await snapshot("post_divest", dep, signer.address);
  printSnapshot(post);

  // --- evidence ---
  const record = {
    action: "divest",
    timestamp: new Date().toISOString(),
    amount_usdc: parseFloat(ethers.formatUnits(amountRaw, 6)),
    divest_tx: divestTx.hash,
    return_tx: returnTx.hash,
    divest_block: divestReceipt?.blockNumber,
    return_block: returnReceipt?.blockNumber,
    pre,
    post,
  };
  saveEvidence(`divest_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", { action: "divest", divest_tx: divestTx.hash, return_tx: returnTx.hash, amount: parseFloat(ethers.formatUnits(amountRaw, 6)), ts: new Date().toISOString() });
}

main().catch(console.error);
