import { ethers } from "hardhat";

async function main() {
  const VAULT = "0x8acaec738F9559F8b025c4372d827D3CD3928322";
  const ADMIN = "0x087ea7F67d9282f0bdC43627b855F79789C6824C";

  const vault = await ethers.getContractAt("FundVaultV01", VAULT);
  const tx = await vault.addToAllowlist(ADMIN);
  await tx.wait();
  console.log("addToAllowlist tx:", tx.hash);

  const allowed = await vault.isAllowed(ADMIN);
  console.log("isAllowed(ADMIN):", allowed);
}

main().catch(console.error);
