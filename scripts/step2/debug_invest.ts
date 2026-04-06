import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const MANAGER = dep.contracts.StrategyManagerV01;
  const amount = ethers.parseUnits("104.23", 6);

  const manager = await ethers.getContractAt("StrategyManagerV01", MANAGER);

  const idle = await manager.idleUnderlying();
  const strat = await manager.strategy();
  const paused = await manager.paused();
  console.log("Manager idle:", ethers.formatUnits(idle, 6), "USDC");
  console.log("Manager strategy:", strat);
  console.log("Manager paused:", paused);

  const role = await manager.DEFAULT_ADMIN_ROLE();
  const hasRole = await manager.hasRole(role, signer.address);
  console.log("signer has DEFAULT_ADMIN_ROLE:", hasRole);

  console.log("\nAttempting invest staticCall...");
  try {
    await manager.connect(signer).invest.staticCall(amount);
    console.log("staticCall: OK");
  } catch (e: any) {
    console.log("staticCall revert:", e.shortMessage || e.message);
    if (e.data) console.log("revert data:", e.data);
    if (e.reason) console.log("revert reason:", e.reason);
  }
}
main().catch(console.error);
