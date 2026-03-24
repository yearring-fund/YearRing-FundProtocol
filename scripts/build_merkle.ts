/**
 * build_merkle.ts — Snapshot vault shareholders and build a Merkle claims file
 *
 * Reads share balances at a given block, computes proportional rewards,
 * builds a Merkle tree, and writes a claims JSON for use with setEpoch().
 *
 * Usage:
 *   VAULT_ADDRESS=0x... EPOCH_ID=1 npx hardhat run scripts/build_merkle.ts --network base
 *
 * Or reads VAULT_ADDRESS from the deployments file automatically:
 *   EPOCH_ID=1 npx hardhat run scripts/build_merkle.ts --network base
 */

import { ethers, network } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import * as fs from "fs";
import * as path from "path";

interface ClaimEntry {
  address: string;
  amount: string;
  proof: string[];
}

interface ClaimsOutput {
  epochId: number;
  root: string;
  epochTotal: string;
  snapshotBlock: number;
  claims: Record<string, ClaimEntry>;
}

async function main() {
  // ---------------------------------------------------------------------------
  // Parameters
  // ---------------------------------------------------------------------------
  let vaultAddress = process.env.VAULT_ADDRESS || "";

  // Fall back to deployments file
  if (!vaultAddress) {
    const deploymentsPath = path.join(__dirname, `../deployments/${network.name}.json`);
    if (fs.existsSync(deploymentsPath)) {
      const existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
      vaultAddress = existing.contracts.FundVaultV01 || "";
    }
  }

  if (!vaultAddress) throw new Error("VAULT_ADDRESS env var required (or run deploy.ts first)");

  const snapshotBlock = process.env.SNAPSHOT_BLOCK
    ? parseInt(process.env.SNAPSHOT_BLOCK)
    : await ethers.provider.getBlockNumber();

  const epochId  = process.env.EPOCH_ID  ? parseInt(process.env.EPOCH_ID) : 1;
  const epochCap = process.env.EPOCH_CAP ? BigInt(process.env.EPOCH_CAP)  : ethers.parseEther("10000");

  console.log("=".repeat(60));
  console.log("FinancialBase V01 — Merkle Snapshot");
  console.log("=".repeat(60));
  console.log("Vault          :", vaultAddress);
  console.log("Snapshot block :", snapshotBlock);
  console.log("Epoch ID       :", epochId);
  console.log("Epoch cap      :", ethers.formatEther(epochCap), "RWD");
  console.log("-".repeat(60));

  // ---------------------------------------------------------------------------
  // 1. Collect shareholders from Transfer events
  // ---------------------------------------------------------------------------
  const vault = await ethers.getContractAt("FundVaultV01", vaultAddress);

  const filter = vault.filters.Transfer();
  const events = await vault.queryFilter(filter, 0, snapshotBlock);

  const holderSet = new Set<string>();
  for (const ev of events) {
    if (ev.args) {
      const { from, to } = ev.args;
      if (to   !== ethers.ZeroAddress) holderSet.add(to.toLowerCase());
      if (from !== ethers.ZeroAddress) holderSet.add(from.toLowerCase());
    }
  }
  console.log(`Found ${holderSet.size} unique addresses from Transfer events`);

  // ---------------------------------------------------------------------------
  // 2. Fetch balances at snapshot block
  // ---------------------------------------------------------------------------
  const balances: Record<string, bigint> = {};
  let totalShares = 0n;

  for (const holder of holderSet) {
    const balance: bigint = await vault.balanceOf(holder, { blockTag: snapshotBlock });
    if (balance > 0n) {
      balances[holder] = balance;
      totalShares += balance;
    }
  }

  console.log(`${Object.keys(balances).length} holders with non-zero balance`);
  console.log("Total shares at snapshot:", totalShares.toString());

  if (totalShares === 0n) {
    console.log("No shares found — aborting");
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // 3. Proportional reward allocation (last holder absorbs rounding dust)
  // ---------------------------------------------------------------------------
  const rewardAmounts: Record<string, bigint> = {};
  let allocatedTotal = 0n;

  const holders = Object.entries(balances);
  for (let i = 0; i < holders.length; i++) {
    const [holder, balance] = holders[i];
    const reward = i === holders.length - 1
      ? epochCap - allocatedTotal
      : (balance * epochCap) / totalShares;

    if (reward > 0n) {
      rewardAmounts[holder] = reward;
      allocatedTotal += reward;
    }
  }

  console.log("Total allocated:", ethers.formatEther(allocatedTotal), "RWD");

  // ---------------------------------------------------------------------------
  // 4. Build Merkle tree  — leaf = keccak256(abi.encodePacked(account, amount))
  // ---------------------------------------------------------------------------
  const leaves = Object.entries(rewardAmounts).map(([account, amount]) =>
    keccak256(ethers.solidityPacked(["address", "uint256"], [account, amount]))
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex");
  console.log("Merkle root:", root);

  // ---------------------------------------------------------------------------
  // 5. Build claims output
  // ---------------------------------------------------------------------------
  const claims: Record<string, ClaimEntry> = {};
  for (const [account, amount] of Object.entries(rewardAmounts)) {
    const leaf  = keccak256(ethers.solidityPacked(["address", "uint256"], [account, amount]));
    const proof = tree.getHexProof(leaf);
    claims[account] = { address: account, amount: amount.toString(), proof };
  }

  const output: ClaimsOutput = {
    epochId,
    root,
    epochTotal: allocatedTotal.toString(),
    snapshotBlock,
    claims,
  };

  // ---------------------------------------------------------------------------
  // 6. Write output
  // ---------------------------------------------------------------------------
  const outputDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `claims_epoch_${epochId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log("-".repeat(60));
  console.log("Claims written to:", outputPath);
  console.log("Holders          :", Object.keys(claims).length);
  console.log("Epoch total      :", ethers.formatEther(allocatedTotal), "RWD");
  console.log("\nNext: call distributor.setEpoch(epochId, root, epochTotal) on-chain");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
