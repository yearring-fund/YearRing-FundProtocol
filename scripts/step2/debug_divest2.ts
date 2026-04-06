import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();

  const manager  = await ethers.getContractAt("StrategyManagerV01",  dep.contracts.StrategyManagerV01);
  const strategy = await ethers.getContractAt("AaveV3StrategyV01",   dep.contracts.AaveV3StrategyV01);

  const amount50 = ethers.parseUnits("50", 6);
  const amount1  = ethers.parseUnits("1",  6);

  // encode and show calldata
  const encoded50 = manager.interface.encodeFunctionData("divest", [amount50]);
  console.log("divest(50) calldata:", encoded50);

  // staticCall with 50 USDC at latest block
  console.log("\nstaticCall divest(50):");
  try {
    const r = await manager.connect(signer).divest.staticCall(amount50);
    console.log("OK, withdrawn:", ethers.formatUnits(r, 6));
  } catch (e: any) {
    console.log("FAIL:", e.shortMessage || e.message);
  }

  // staticCall with 1 USDC
  console.log("\nstaticCall divest(1):");
  try {
    const r = await manager.connect(signer).divest.staticCall(amount1);
    console.log("OK, withdrawn:", ethers.formatUnits(r, 6));
  } catch (e: any) {
    console.log("FAIL:", e.shortMessage || e.message);
  }

  // Try sending with explicit gas limit
  console.log("\nSending divest(1 USDC) with explicit gas limit...");
  try {
    const tx = await manager.connect(signer).divest(amount1, { gasLimit: 500000 });
    const r = await tx.wait();
    console.log("SUCCESS: tx", tx.hash, "status", r?.status, "gasUsed", r?.gasUsed.toString());
  } catch (e: any) {
    console.log("FAIL:", e.shortMessage || e.message);
    if (e.receipt) {
      console.log("receipt status:", e.receipt.status);
      console.log("gasUsed:", e.receipt.gasUsed?.toString());
    }
  }
}
main().catch(console.error);
