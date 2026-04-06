/**
 * grant_manager_emergency.ts — grant EMERGENCY_ROLE to GUARDIAN on StrategyManager
 */
import { ethers } from "hardhat";
import { loadDeployment } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();
  const GUARDIAN = dep.config.guardian;

  const manager = await ethers.getContractAt("StrategyManagerV01", dep.contracts.StrategyManagerV01);
  const EMERGENCY_ROLE = await manager.EMERGENCY_ROLE();

  console.log("Granting EMERGENCY_ROLE to GUARDIAN on StrategyManager:", GUARDIAN);
  const tx = await manager.connect(signer).grantRole(EMERGENCY_ROLE, GUARDIAN);
  await tx.wait();
  console.log("tx:", tx.hash);

  const ok = await manager.hasRole(EMERGENCY_ROLE, GUARDIAN);
  console.log("hasRole(EMERGENCY_ROLE, GUARDIAN) on manager:", ok);
}

main().catch(console.error);
