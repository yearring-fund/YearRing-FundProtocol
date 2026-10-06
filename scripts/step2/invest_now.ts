import { ethers } from "hardhat";
import { loadDeployment, snapshot, printSnapshot, saveEvidence, appendEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();

  const manager = await ethers.getContractAt("StrategyManagerV01", dep.contracts.StrategyManagerV01);
  const idle = await manager.idleUnderlying();
  const amountRaw = idle;

  console.log("=".repeat(60));
  console.log("Step2 — Invest (manager.invest, full ABI)");
  console.log("Amount:", ethers.formatUnits(amountRaw, 6), "USDC");
  console.log("=".repeat(60));

  const pre = await snapshot("pre_invest_retry", dep, signer.address);
  printSnapshot(pre);

  console.log("\nCalling manager.invest...");
  const tx = await manager.connect(signer).invest(amountRaw);
  const receipt = await tx.wait();
  console.log("invest tx:", tx.hash, "block:", receipt?.blockNumber, "status:", receipt?.status);

  const post = await snapshot("post_invest_retry", dep, signer.address);
  printSnapshot(post);

  const record = {
    action: "invest",
    timestamp: new Date().toISOString(),
    amount_usdc: parseFloat(ethers.formatUnits(amountRaw, 6)),
    invest_tx: tx.hash,
    block: receipt?.blockNumber,
    pre, post,
  };
  saveEvidence(`invest_${Date.now()}.json`, record);
  appendEvidence("step2_log.json", { action: "invest", invest_tx: tx.hash, amount: parseFloat(ethers.formatUnits(amountRaw, 6)), ts: new Date().toISOString() });
}
main().catch(console.error);
