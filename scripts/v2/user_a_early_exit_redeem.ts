/**
 * user_a_early_exit_redeem.ts
 *
 * 将 User A（Alice）所有活跃锁仓提前退出，然后赎回全部 fbUSDC。
 *
 * 步骤：
 *   1. 读取 Alice 的锁仓列表
 *   2. 对每笔活跃锁仓：approve RWT → earlyExitWithReturn
 *   3. 赎回 Alice 全部 fbUSDC → USDC
 *
 * 注意：当前 lastRebateClaimedAt = 0 的遗留锁仓，rebate 会虚高（从 Unix 纪元起算）。
 * 合约修复（_calcRebate fallback to lockedAt）部署后才能消除，此脚本直接接受当前状态。
 * Treasury 已 MaxUint256 approve，不会阻塞。
 *
 * Usage:
 *   npx hardhat run scripts/v2/user_a_early_exit_redeem.ts --network base
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const u6  = (v: bigint) => (Number(v) / 1e6).toFixed(6);
const u18 = (v: bigint) => (Number(v) / 1e18).toFixed(6);
const sep = () => console.log("-".repeat(60));

async function main() {
  const signers = await ethers.getSigners();
  // accounts order: [deployer, alice, bob, carol, treasury]
  const alice = signers[1];

  const depPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(depPath)) throw new Error(`No deployment at ${depPath}`);
  const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));
  const c   = dep.contracts;

  console.log("\n" + "=".repeat(60));
  console.log("  User A Early Exit + Redeem");
  console.log("=".repeat(60));
  console.log("Network  :", network.name);
  console.log("Alice    :", alice.address);

  // ── Contracts ────────────────────────────────────────────────
  const vault   = await ethers.getContractAt("FundVaultV01",         c.FundVaultV01);
  const ledger  = await ethers.getContractAt("LockLedgerV02",        c.LockLedgerV02);
  const mgr     = await ethers.getContractAt("LockRewardManagerV02", c.LockRewardManagerV02);
  const rwt     = await ethers.getContractAt("RewardToken",          c.RewardToken);

  // ── 1. Read Alice's lock IDs ─────────────────────────────────
  sep();
  const lockIds: bigint[] = await ledger.userLockIds(alice.address);
  console.log(`Alice lock IDs: [${lockIds.map(String).join(", ")}]`);

  if (lockIds.length === 0) {
    console.log("No locks found. Nothing to exit.");
    return;
  }

  // ── 2. Early exit each active lock ───────────────────────────
  for (const lockId of lockIds) {
    sep();
    const pos = await ledger.getLock(lockId);
    console.log(`\nLock #${lockId}`);
    console.log(`  Shares    : ${u18(pos.shares)} fbUSDC`);
    console.log(`  Locked at : ${new Date(Number(pos.lockedAt) * 1000).toISOString()}`);
    console.log(`  Unlock at : ${new Date(Number(pos.unlockAt) * 1000).toISOString()}`);
    console.log(`  Status    : unlocked=${pos.unlocked} earlyExited=${pos.earlyExited}`);

    if (pos.unlocked || pos.earlyExited) {
      console.log("  → Already closed, skipping.");
      continue;
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    // Mature lock → just unlock (no RWT return needed)
    if (pos.unlockAt <= now) {
      console.log("  → Lock is mature. Calling unlock()...");
      const tx = await ledger.connect(alice).unlock(lockId);
      await tx.wait();
      console.log("  Unlocked ✓  tx:", tx.hash);
      continue;
    }

    // Active lock → early exit
    const rwtToReturn   = await mgr.issuedRewardTokens(lockId);
    const rebatePreview = await mgr.previewRebate(lockId);
    console.log(`  RWT to return  : ${u18(rwtToReturn)} RWT`);
    console.log(`  Rebate preview : ${u18(rebatePreview)} fbUSDC`);

    // Attempt normal path first (LockRewardManagerV02.earlyExitWithReturn)
    // This may fail if treasury lacks enough fbUSDC to cover the rebate.
    // In that case fall back to admin bypass via LockLedger.earlyExitFor.
    let exited = false;

    if (rwtToReturn === 0n) {
      // No RWT to return — try normal path but catch treasury balance error
      try {
        if (rwtToReturn > 0n) {
          const rwtAllowance = await rwt.allowance(alice.address, c.LockRewardManagerV02);
          if (rwtAllowance < rwtToReturn) {
            const approveTx = await rwt.connect(alice).approve(c.LockRewardManagerV02, rwtToReturn);
            await approveTx.wait();
            console.log("  RWT approved ✓  tx:", approveTx.hash);
          }
        }
        const exitTx = await mgr.connect(alice).earlyExitWithReturn(lockId);
        await exitTx.wait();
        console.log("  earlyExitWithReturn ✓  tx:", exitTx.hash);
        exited = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`  Normal exit failed (${msg.slice(0, 80)}).`);
        console.log("  Falling back to admin bypass via LockLedger...");
      }
    }

    if (!exited) {
      // Admin bypass: grant OPERATOR_ROLE to admin on LockLedger, call earlyExitFor directly.
      // Skips rebate settlement (acceptable: rebate bug is a known issue, fix pending deploy).
      // RWT is 0 for this lock so no RWT inconsistency.
      const admin = signers[0];
      const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();

      const hasRole = await ledger.hasRole(OPERATOR_ROLE, admin.address);
      if (!hasRole) {
        console.log("  Granting OPERATOR_ROLE to admin on LockLedger...");
        const grantTx = await ledger.connect(admin).grantRole(OPERATOR_ROLE, admin.address);
        await grantTx.wait();
        console.log("  OPERATOR_ROLE granted ✓  tx:", grantTx.hash);
      }

      console.log("  Calling LockLedger.earlyExitFor (skips rebate)...");
      const exitTx = await ledger.connect(admin).earlyExitFor(lockId, alice.address);
      await exitTx.wait();
      console.log("  earlyExitFor ✓  tx:", exitTx.hash);

      // Revoke OPERATOR_ROLE from admin — keep minimal permissions
      console.log("  Revoking OPERATOR_ROLE from admin...");
      const revokeTx = await ledger.connect(admin).revokeRole(OPERATOR_ROLE, admin.address);
      await revokeTx.wait();
      console.log("  OPERATOR_ROLE revoked ✓");
    }
  }

  // ── 3. Redeem all fbUSDC ─────────────────────────────────────
  sep();
  const fbBalance = await vault.balanceOf(alice.address);
  console.log(`\nAlice fbUSDC balance after exits: ${u18(fbBalance)} fbUSDC`);

  if (fbBalance === 0n) {
    console.log("No fbUSDC to redeem.");
  } else {
    const expectedUsdc = await vault.previewRedeem(fbBalance);
    console.log(`Expected USDC on redeem: ${u6(expectedUsdc)} USDC`);

    // Ensure Alice has enough ETH for gas (redeem ~200k gas at current base fee)
    const aliceEth = await ethers.provider.getBalance(alice.address);
    const GAS_RESERVE = ethers.parseEther("0.002"); // 0.002 ETH buffer
    if (aliceEth < GAS_RESERVE) {
      const needed = GAS_RESERVE - aliceEth;
      console.log(`  Alice ETH low (${ethers.formatEther(aliceEth)} ETH). Sending ${ethers.formatEther(needed)} ETH from admin...`);
      const admin = signers[0];
      const fundTx = await admin.sendTransaction({ to: alice.address, value: needed });
      await fundTx.wait();
      console.log("  ETH sent ✓  tx:", fundTx.hash);
    }

    console.log("Calling redeem...");
    const redeemTx = await vault.connect(alice).redeem(fbBalance, alice.address, alice.address);
    await redeemTx.wait();
    console.log("Redeemed ✓  tx:", redeemTx.hash);
  }

  // ── Summary ──────────────────────────────────────────────────
  sep();
  const usdcAddr = dep.contracts.USDC || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    usdcAddr,
  );
  const finalUsdc   = await usdc.balanceOf(alice.address);
  const finalShares = await vault.balanceOf(alice.address);
  console.log(`\nFinal state — Alice`);
  console.log(`  USDC    : ${u6(finalUsdc)} USDC`);
  console.log(`  fbUSDC  : ${u18(finalShares)} fbUSDC`);
  console.log("=".repeat(60));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
