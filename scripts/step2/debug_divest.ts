import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const amount50 = ethers.parseUnits("50", 6);
  const amount10 = ethers.parseUnits("10", 6);

  const manager  = await ethers.getContractAt("StrategyManagerV01",  dep.contracts.StrategyManagerV01);
  const strategy = await ethers.getContractAt("AaveV3StrategyV01",   dep.contracts.AaveV3StrategyV01);

  // read aToken balance on strategy
  const aTokenAbi = ["function balanceOf(address) view returns (uint256)"];
  const aToken = new ethers.Contract("0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", aTokenAbi, ethers.provider);
  const aTokenBal = await aToken.balanceOf(dep.contracts.AaveV3StrategyV01);
  console.log("aToken on strategy:", ethers.formatUnits(aTokenBal, 6));

  const stratUnderlying = await strategy.totalUnderlying();
  console.log("strategy.totalUnderlying:", ethers.formatUnits(stratUnderlying, 6));

  // try staticCall divest 10
  console.log("\nstaticCall manager.divest(10 USDC)...");
  try {
    const r = await manager.connect(signer).divest.staticCall(amount10);
    console.log("OK, withdrawn:", ethers.formatUnits(r, 6), "USDC");
  } catch (e: any) {
    console.log("revert:", e.shortMessage || e.message);
    if (e.data) console.log("data:", e.data);
  }

  // try staticCall strategy.divest directly
  console.log("\nstaticCall strategy.divest(10 USDC) directly (from signer, not manager)...");
  try {
    const r = await strategy.connect(signer).divest.staticCall(amount10);
    console.log("OK, withdrawn:", ethers.formatUnits(r, 6));
  } catch (e: any) {
    console.log("revert:", e.shortMessage || e.message);
  }
}
main().catch(console.error);
