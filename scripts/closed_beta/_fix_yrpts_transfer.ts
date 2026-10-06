/**
 * _fix_yrpts_transfer.ts — One-time fix: move 20M YRPTS from TREASURY EOA to TreasuryV02
 *
 * Root cause: TREASURY_ADDRESS env var caused deploy_core_beta.ts to premint
 * YRPTS to the EOA instead of TreasuryV02 contract. This script corrects that.
 * Run once, then delete.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const signers = await ethers.getSigners();
  // signers[4] = TREASURY_PRIVATE_KEY
  const treasurySigner = signers[4];

  const dep = JSON.parse(fs.readFileSync(
    path.join(__dirname, "../../deployments", `closed_beta_${network.name}.json`), "utf8"
  ));
  const treasuryV02Addr = dep.contracts["TreasuryV02"];
  const pointsAddr      = dep.contracts["PointsToken"];

  const pts = new ethers.Contract(pointsAddr, [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) external returns (bool)",
  ], treasurySigner);

  const bal = await pts.balanceOf(treasurySigner.address);
  console.log("TREASURY_ADDRESS :", treasurySigner.address);
  console.log("YRPTS balance    :", ethers.formatEther(bal));
  console.log("→ TreasuryV02    :", treasuryV02Addr);

  if (bal === 0n) {
    console.log("Balance is 0 — nothing to transfer.");
    return;
  }

  const tx = await (await pts.transfer(treasuryV02Addr, bal)).wait();
  console.log("TX hash  :", tx.hash);
  console.log("Block    :", tx.blockNumber);

  const balAfter = await pts.balanceOf(treasuryV02Addr);
  const eoaAfter = await pts.balanceOf(treasurySigner.address);
  console.log("TreasuryV02 YRPTS after transfer:", ethers.formatEther(balAfter));
  console.log("EOA YRPTS after transfer:", ethers.formatEther(eoaAfter));
}

main().catch(err => { console.error(err); process.exit(1); });
