/**
 * set_invest_cap.ts — Set investCap and minIdle on StrategyManagerV01
 *
 * Usage:
 *   npx hardhat run scripts/step3/set_invest_cap.ts --network base
 *
 * Config below:
 *   INVEST_CAP = 20000 USDC  — max total deployed to Aave strategy
 *   MIN_IDLE   = 0           — no floor on StrategyManager idle (Vault reserveRatio handles this)
 *
 * Requires: DEFAULT_ADMIN_ROLE
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const INVEST_CAP_USDC = "20000";   // max deployed to strategy
const MIN_IDLE_USDC   = "0";       // no floor (vault reserveRatioBps=3000 already handles idle)

const MANAGER_ABI = [
  "function setLimits(uint256 newInvestCap, uint256 newMinIdle) external",
  "function investCap() view returns (uint256)",
  "function minIdle() view returns (uint256)",
];

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../deployments/base.json"), "utf8")
  );
  const [signer] = await ethers.getSigners();
  const manager = new ethers.Contract(dep.contracts.StrategyManagerV01, MANAGER_ABI, signer);

  const newCap  = ethers.parseUnits(INVEST_CAP_USDC, 6);
  const newIdle = ethers.parseUnits(MIN_IDLE_USDC, 6);

  console.log("=".repeat(60));
  console.log("Step3 — set_invest_cap");
  console.log("StrategyManager:", dep.contracts.StrategyManagerV01);
  console.log("Admin          :", signer.address);
  console.log("=".repeat(60));

  const [capBefore, idleBefore] = await Promise.all([manager.investCap(), manager.minIdle()]);
  console.log("\nBefore:");
  console.log("  investCap:", ethers.formatUnits(capBefore, 6), "USDC");
  console.log("  minIdle  :", ethers.formatUnits(idleBefore, 6), "USDC");

  console.log("\nSetting:");
  console.log("  investCap →", INVEST_CAP_USDC, "USDC");
  console.log("  minIdle   →", MIN_IDLE_USDC,   "USDC");

  const tx = await manager.setLimits(newCap, newIdle, { gasLimit: 100000 });
  const receipt = await tx.wait();
  console.log("\ntx:", tx.hash, "block:", receipt?.blockNumber);

  const [capAfter, idleAfter] = await Promise.all([manager.investCap(), manager.minIdle()]);
  console.log("\nAfter:");
  console.log("  investCap:", ethers.formatUnits(capAfter, 6), "USDC");
  console.log("  minIdle  :", ethers.formatUnits(idleAfter, 6), "USDC");

  if (capAfter !== newCap) throw new Error("Verification failed: investCap mismatch");
  console.log("\nDone. investCap = 20000 USDC.");
}

main().catch(console.error);
