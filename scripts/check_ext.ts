import { ethers } from "hardhat"
async function main() {
  const vault = await ethers.getContractAt("FundVaultV01", "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54")
  const val = await vault.externalTransfersEnabled()
  console.log("externalTransfersEnabled:", val)
  const admin = "0x087ea7F67d9282f0bdC43627b855F79789C6824C"
  const role = "0x0000000000000000000000000000000000000000000000000000000000000000"
  const hasRole = await vault.hasRole(role, admin)
  console.log("admin hasRole DEFAULT_ADMIN_ROLE:", hasRole)
}
main().catch(console.error)
