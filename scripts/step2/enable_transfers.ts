import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../../deployments/base.json"), "utf8"));
  const [signer] = await ethers.getSigners();

  const vault = new ethers.Contract(dep.contracts.FundVaultV01, [
    "function externalTransfersEnabled() view returns (bool)",
    "function setExternalTransfersEnabled(bool) external",
  ], signer);

  const before = await vault.externalTransfersEnabled();
  console.log("externalTransfersEnabled before:", before);
  if (before) { console.log("Already enabled, nothing to do."); return; }

  console.log("Calling setExternalTransfersEnabled(true)...");
  const tx = await vault.setExternalTransfersEnabled(true);
  const receipt = await tx.wait();
  console.log("tx:", tx.hash, "| block:", receipt?.blockNumber, "| status:", receipt?.status);

  const after = await vault.externalTransfersEnabled();
  console.log("externalTransfersEnabled after:", after);
}
main().catch(console.error);
