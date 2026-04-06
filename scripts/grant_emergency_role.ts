import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/base.json"), "utf8"));
  const VAULT_ADDR = dep.contracts.FundVaultV01;
  const GUARDIAN   = dep.config.guardian;

  const vault = await ethers.getContractAt("FundVaultV01", VAULT_ADDR);
  const EMERGENCY_ROLE = await vault.EMERGENCY_ROLE();

  console.log("Granting EMERGENCY_ROLE to GUARDIAN:", GUARDIAN);
  const tx = await vault.grantRole(EMERGENCY_ROLE, GUARDIAN);
  await tx.wait();
  console.log("tx:", tx.hash);

  const ok = await vault.hasRole(EMERGENCY_ROLE, GUARDIAN);
  console.log("hasRole(EMERGENCY_ROLE, GUARDIAN):", ok);
}

main().catch(console.error);
