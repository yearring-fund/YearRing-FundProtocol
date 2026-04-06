/**
 * allowlist_add.ts — Add one address to FundVault deposit allowlist
 *
 * Usage:
 *   ADDRESS=0x... npx hardhat run scripts/step3/allowlist_add.ts --network base
 *
 * Requires: DEFAULT_ADMIN_ROLE (PRIVATE_KEY in .env must be admin)
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const VAULT_ABI = [
  "function addToAllowlist(address account) external",
  "function isAllowed(address) view returns (bool)",
];

async function main() {
  const target = process.env.ADDRESS;
  if (!target || !ethers.isAddress(target)) {
    throw new Error("ADDRESS env var missing or invalid. Usage: ADDRESS=0x... npx hardhat run ...");
  }

  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../deployments/base.json"), "utf8")
  );
  const [signer] = await ethers.getSigners();
  const vault = new ethers.Contract(dep.contracts.FundVaultV01, VAULT_ABI, signer);

  console.log("=".repeat(60));
  console.log("Step3 — allowlist_add");
  console.log("Vault  :", dep.contracts.FundVaultV01);
  console.log("Admin  :", signer.address);
  console.log("Target :", target);
  console.log("=".repeat(60));

  const before = await vault.isAllowed(target);
  console.log("\nallowlist status before:", before);

  if (before) {
    console.log("Already on allowlist. No action needed.");
    return;
  }

  const tx = await vault.addToAllowlist(target, { gasLimit: 100000 });
  const receipt = await tx.wait();
  console.log("tx:", tx.hash, "block:", receipt?.blockNumber);

  const after = await vault.isAllowed(target);
  console.log("allowlist status after :", after);

  if (!after) throw new Error("Verification failed: address still not on allowlist");
  console.log("\nDone. Address is now allowed to deposit.");
}

main().catch(console.error);
