import { ethers } from "hardhat";

const VAULT = "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54";

const REMOVE = [
  "0x087ea7F67d9282f0bdC43627b855F79789C6824C", // Admin
  "0xC8052cF447d429f63E890385a6924464B85c5834", // Guardian
  "0x9d16Eb6A6143A3347f8fA5854B5AA675101Fb705", // Treasury
];

const ADD = [
  "0xa7C381eA23E12B83500A5D3eEE850068740B0339", // Alice
  "0x9d84145F057C2fd532250891E9b02BDe0C92CcB4", // Bob
  "0x2dfF07C3Bb71CB6c6EB366b4b2f30CEb48771d4B", // Carol
];

async function main() {
  const vault = await ethers.getContractAt("FundVaultV01", VAULT);

  for (const addr of REMOVE) {
    const tx = await vault.removeFromAllowlist(addr);
    await tx.wait();
    console.log(`removeFromAllowlist(${addr}) ✓  tx: ${tx.hash}`);
  }

  for (const addr of ADD) {
    const tx = await vault.addToAllowlist(addr);
    await tx.wait();
    console.log(`addToAllowlist(${addr}) ✓  tx: ${tx.hash}`);
  }

  console.log("\n--- Final state ---");
  for (const addr of [...REMOVE, ...ADD]) {
    const allowed = await vault.isAllowed(addr);
    console.log(`isAllowed(${addr}): ${allowed}`);
  }
}

main().catch(console.error);
