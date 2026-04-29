import { ethers } from "hardhat"

const VAULT_ADDR = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54"

async function main() {
  const [signer] = await ethers.getSigners()
  console.log("Signer:", signer.address)

  const vault = await ethers.getContractAt("FundVaultV01", VAULT_ADDR, signer)

  const before = await vault.externalTransfersEnabled()
  console.log("externalTransfersEnabled before:", before)

  if (before) {
    console.log("Already enabled — nothing to do.")
    return
  }

  const tx = await vault.setExternalTransfersEnabled(true)
  console.log("tx:", tx.hash)
  const receipt = await tx.wait()
  console.log("confirmed in block", receipt?.blockNumber)

  const after = await vault.externalTransfersEnabled()
  console.log("externalTransfersEnabled after:", after)
  console.log("Basescan:", `https://basescan.org/tx/${tx.hash}`)
}

main().catch(e => { console.error(e); process.exit(1) })
