/**
 * invest.ts — transfer USDC from Vault to StrategyManager, then invest into Aave V3
 * Usage: AMOUNT=100 npx hardhat run scripts/step2/invest.ts --network base
 *        (AMOUNT in USDC — how much to send to strategy, default = availableToInvest)
 */
import { ethers } from "hardhat";
import { loadDeployment, getContracts, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const { vault, manager } = await getContracts(dep);

  console.log("=".repeat(60));
  console.log("Step2 — Invest (Vault → StrategyManager → Aave V3)");
  console.log("=".repeat(60));

  // --- pre-state ---
  const pre = await snapshot("pre_invest", dep, signer.address);
  printSnapshot(pre);

  const available    = await vault.availableToInvest();
  const totalAssets  = await vault.totalAssets();
  const stratManaged = await manager.totalManagedAssets();

  // Safe max: respects both reserveRatioBps (availableToInvest) and MAX_STRATEGY_DEPLOY_BPS (70%)
  // Avoids dust-rounding overflow where availableToInvest() marginally exceeds the hard cap check
  const maxByHardCap = totalAssets * 7000n / 10000n - stratManaged;
  const safeAvailable = available < maxByHardCap ? available : maxByHardCap;

  const amountRaw = process.env.AMOUNT
    ? ethers.parseUnits(process.env.AMOUNT, 6)
    : safeAvailable;

  if (amountRaw === 0n) {
    console.log("\nNothing available to invest. Aborting.");
    return;
  }
  console.log(`\nTransfer amount: ${ethers.formatUnits(amountRaw, 6)} USDC`);

  // --- transferToStrategyManager ---
  console.log("\nStep 1: transferToStrategyManager...");
  const transferTx = await vault.connect(signer).transferToStrategyManager(amountRaw, { gasLimit: 350000 });
  const transferReceipt = await transferTx.wait();
  console.log("transfer tx:", transferTx.hash, "block:", transferReceipt?.blockNumber);

  // --- invest into Aave ---
  console.log("\nStep 2: manager.invest...");
  const investTx = await manager.connect(signer).invest(amountRaw, { gasLimit: 500000 });
  const investReceipt = await investTx.wait();
  console.log("invest tx:", investTx.hash, "block:", investReceipt?.blockNumber);

  // --- post-state ---
  const post = await snapshot("post_invest", dep, signer.address);
  printSnapshot(post);

  // --- evidence ---
  const record = {
    action: "invest",
    timestamp: new Date().toISOString(),
    amount_usdc: parseFloat(ethers.formatUnits(amountRaw, 6)),
    transfer_tx: transferTx.hash,
    invest_tx: investTx.hash,
    transfer_block: transferReceipt?.blockNumber,
    invest_block: investReceipt?.blockNumber,
    pre,
    post,
  };
  saveEvidence(`invest_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", { action: "invest", transfer_tx: transferTx.hash, invest_tx: investTx.hash, amount: parseFloat(ethers.formatUnits(amountRaw, 6)), ts: new Date().toISOString() });
}

main().catch(console.error);
