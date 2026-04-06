/**
 * state.ts — read-only full system state snapshot
 * Usage: npx hardhat run scripts/step2/state.ts --network base
 */
import { ethers } from "hardhat";
import { loadDeployment, snapshot, printSnapshot, saveEvidence } from "./lib";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const dep = loadDeployment("base");
  const [signer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("Step2 — Full State Read");
  console.log("User:", signer.address);
  console.log("=".repeat(60));

  const s = await snapshot("state_read", dep, signer.address);
  printSnapshot(s);
  saveEvidence(`state_${Date.now()}.json`, s);
}

main().catch(console.error);
