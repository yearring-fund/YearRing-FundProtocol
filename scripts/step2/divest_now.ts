import { ethers } from "hardhat";
import { loadDeployment, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const DIVEST_AMOUNT = process.env.AMOUNT
    ? ethers.parseUnits(process.env.AMOUNT, 6)
    : 0n;
  if (DIVEST_AMOUNT === 0n) { console.log("Set AMOUNT env var"); return; }

  const manager = await ethers.getContractAt("StrategyManagerV01", dep.contracts.StrategyManagerV01);

  console.log("=".repeat(60));
  console.log("Step2 — Divest + ReturnToVault (explicit gasLimit)");
  console.log("Divest amount:", ethers.formatUnits(DIVEST_AMOUNT, 6), "USDC");
  console.log("=".repeat(60));

  const pre = await snapshot("pre_divest", dep, signer.address);
  printSnapshot(pre);

  // Step 1: divest with explicit gasLimit
  console.log("\nStep 1: manager.divest...");
  const divestTx = await manager.connect(signer).divest(DIVEST_AMOUNT, { gasLimit: 500000 });
  const divestReceipt = await divestTx.wait();
  console.log("divest tx:", divestTx.hash, "block:", divestReceipt?.blockNumber, "status:", divestReceipt?.status);

  // Step 2: returnToVault (all idle)
  const idleNow = await manager.idleUnderlying();
  console.log(`\nStep 2: manager.returnToVault (${ethers.formatUnits(idleNow, 6)} USDC)...`);
  const returnTx = await manager.connect(signer).returnToVault(idleNow, { gasLimit: 200000 });
  const returnReceipt = await returnTx.wait();
  console.log("returnToVault tx:", returnTx.hash, "block:", returnReceipt?.blockNumber);

  const post = await snapshot("post_divest", dep, signer.address);
  printSnapshot(post);

  const record = {
    action: "divest",
    timestamp: new Date().toISOString(),
    amount_requested: parseFloat(ethers.formatUnits(DIVEST_AMOUNT, 6)),
    divest_tx: divestTx.hash,
    return_tx: returnTx.hash,
    divest_block: divestReceipt?.blockNumber,
    return_block: returnReceipt?.blockNumber,
    pre, post,
  };
  saveEvidence(`divest_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", {
    action: "divest",
    divest_tx: divestTx.hash, return_tx: returnTx.hash,
    amount: parseFloat(ethers.formatUnits(DIVEST_AMOUNT, 6)),
    ts: new Date().toISOString(),
  });
}
main().catch(console.error);
