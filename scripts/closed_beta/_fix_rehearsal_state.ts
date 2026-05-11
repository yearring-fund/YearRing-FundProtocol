/**
 * _fix_rehearsal_state.ts
 *
 * 修复 rehearsal_base.ts 运行前的两个状态问题：
 *
 * 问题 1: Treasury yrCORE 余额不足以支付 claimRebate
 *   → 调用 vault.accrueManagementFee() 铸造管理费 yrCORE 到 Treasury
 *
 * 问题 2: 6.999999 USDC 滞留在 StrategyManager（未 invest 到 Aave，未 returnToVault）
 *   → 调用 stratMgr.returnToVault(idleAmount) 将 USDC 归还 Vault
 *
 * 执行后状态应为：
 *   - Treasury yrCORE >= previewRebate(lockId=0)
 *   - StratMgr idle = 0, managed = 0
 *   - Vault freeUSDC = totalAssets (全部在 Vault)
 */

import { ethers } from "hardhat";

const VAULT    = "0x2D2C7BbE92571FF28A23e44d19232e9137F3a310";
const TREASURY = "0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083";
const MANAGER  = "0x03987638d7a0522c2e1521714e46D486628c87a0";
const STRATMGR = "0x7359388D2402a1C7494bE45ecC20c95C837f8692";
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const fmt6  = (v: bigint) => ethers.formatUnits(v, 6);
const fmt18 = (v: bigint) => ethers.formatUnits(v, 18);

function OK(msg: string)   { console.log("  ✓ ", msg); }
function INFO(msg: string) { console.log("  ℹ ", msg); }
function STEP(msg: string) { console.log(`\n  ▶  ${msg}`); }
function HDR(msg: string)  { console.log(`\n${"=".repeat(68)}\n  ${msg}\n${"=".repeat(68)}`); }

async function sendTx(label: string, txPromise: Promise<any>) {
  const tx   = await txPromise;
  const rcpt = await tx.wait();
  OK(`${label} | tx: ${rcpt.hash} | block: ${rcpt.blockNumber} | gas: ${rcpt.gasUsed}`);
  return rcpt;
}

async function main() {
  const [deployer, customerA] = await ethers.getSigners();
  const provider = ethers.provider;

  const network = await provider.getNetwork();
  if (network.chainId !== 8453n) throw new Error(`Wrong network: ${network.chainId} (expected 8453)`);

  const VAULT_ABI = [
    "function accrueManagementFee() external",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ];
  const STRATMGR_ABI = [
    "function idleUnderlying() view returns (uint256)",
    "function totalManagedAssets() view returns (uint256)",
    "function returnToVault(uint256) external",
  ];
  const MANAGER_ABI = [
    "function previewRebate(uint256) view returns (uint256)",
  ];
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
  ];

  const vault    = new ethers.Contract(VAULT,    VAULT_ABI,    deployer);
  const stratMgr = new ethers.Contract(STRATMGR, STRATMGR_ABI, deployer);
  const manager  = new ethers.Contract(MANAGER,  MANAGER_ABI,  customerA);
  const usdc     = new ethers.Contract(USDC,     ERC20_ABI,    provider);
  const vaultErc = new ethers.Contract(VAULT,    ERC20_ABI,    provider);

  console.log("================================================================");
  console.log("  Rehearsal State Fix — Base Mainnet");
  console.log(`  Deployer : ${deployer.address}`);
  console.log("================================================================");

  // ── 修复前快照 ──────────────────────────────────────────────────────────────
  HDR("修复前状态");

  const [rebate, treasuryBal, idleUSDC, managedUSDC, vaultFreeUSDC, totalAssets] =
    await Promise.all([
      manager.previewRebate(0n),
      vaultErc.balanceOf(TREASURY),
      stratMgr.idleUnderlying(),
      stratMgr.totalManagedAssets(),
      usdc.balanceOf(VAULT),
      vault.totalAssets(),
    ]);

  INFO(`previewRebate(lockId=0)  : ${fmt18(rebate)} yrCORE`);
  INFO(`Treasury yrCORE 余额      : ${fmt18(treasuryBal)} yrCORE`);
  INFO(`StratMgr idle             : ${fmt6(idleUSDC)} USDC`);
  INFO(`StratMgr managed          : ${fmt6(managedUSDC)} USDC`);
  INFO(`Vault freeUSDC            : ${fmt6(vaultFreeUSDC)} USDC`);
  INFO(`Vault totalAssets         : ${fmt6(totalAssets)} USDC`);

  // ── 修复 1: accrueManagementFee ─────────────────────────────────────────────
  HDR("修复 1 · accrueManagementFee()");

  STEP("vault.accrueManagementFee()");
  await sendTx("accrueManagementFee", vault.accrueManagementFee({ gasLimit: 200_000n }));

  const treasuryAfterAccrue = await vaultErc.balanceOf(TREASURY);
  INFO(`Treasury yrCORE 修复后     : ${fmt18(treasuryAfterAccrue)} yrCORE`);

  if (treasuryAfterAccrue >= rebate) {
    OK(`Treasury 余额充足 (${fmt18(treasuryAfterAccrue)} >= ${fmt18(rebate)}) ✓`);
  } else {
    throw new Error(
      `HALT: accrueManagementFee 后 Treasury 仍不足。有 ${fmt18(treasuryAfterAccrue)}, 需要 ${fmt18(rebate)}`
    );
  }

  // ── 修复 2: returnToVault（如果 StratMgr 有滞留 USDC）────────────────────────
  HDR("修复 2 · stratMgr.returnToVault()");

  const idleNow = await stratMgr.idleUnderlying();
  INFO(`StratMgr idleUnderlying   : ${fmt6(idleNow)} USDC`);

  if (idleNow === 0n) {
    OK("StratMgr idle = 0，无需 returnToVault，跳过");
  } else {
    STEP(`stratMgr.returnToVault(${fmt6(idleNow)} USDC)`);
    await sendTx("returnToVault", stratMgr.returnToVault(idleNow, { gasLimit: 300_000n }));

    const [idleAfter, vaultFreeAfter] = await Promise.all([
      stratMgr.idleUnderlying(),
      usdc.balanceOf(VAULT),
    ]);
    INFO(`StratMgr idle 修复后      : ${fmt6(idleAfter)} USDC`);
    INFO(`Vault freeUSDC 修复后     : ${fmt6(vaultFreeAfter)} USDC`);
    if (idleAfter === 0n) {
      OK("StratMgr idle 已清零，USDC 已归还 Vault ✓");
    } else {
      throw new Error(`HALT: returnToVault 后 StratMgr 仍有 ${fmt6(idleAfter)} USDC`);
    }
  }

  // ── 修复后快照 ──────────────────────────────────────────────────────────────
  HDR("修复后状态（rehearsal_base.ts 重跑前应满足的条件）");

  const [rebate2, treasuryFinal, idleFinal, managedFinal, vaultFreeFinal, totalAssetsFinal] =
    await Promise.all([
      manager.previewRebate(0n),
      vaultErc.balanceOf(TREASURY),
      stratMgr.idleUnderlying(),
      stratMgr.totalManagedAssets(),
      usdc.balanceOf(VAULT),
      vault.totalAssets(),
    ]);

  INFO(`previewRebate(lockId=0)  : ${fmt18(rebate2)} yrCORE`);
  INFO(`Treasury yrCORE           : ${fmt18(treasuryFinal)} yrCORE  ${treasuryFinal >= rebate2 ? "✓" : "⚠ 仍不足"}`);
  INFO(`StratMgr idle             : ${fmt6(idleFinal)} USDC       ${idleFinal === 0n ? "✓" : "⚠ 仍有残留"}`);
  INFO(`StratMgr managed          : ${fmt6(managedFinal)} USDC`);
  INFO(`Vault freeUSDC            : ${fmt6(vaultFreeFinal)} USDC`);
  INFO(`Vault totalAssets         : ${fmt6(totalAssetsFinal)} USDC`);

  const allGood = treasuryFinal >= rebate2 && idleFinal === 0n;
  console.log("");
  if (allGood) {
    console.log("  ✅ 状态修复完成 — 可以重新执行 rehearsal_base.ts");
    console.log("     npx hardhat run scripts/closed_beta/rehearsal_base.ts --network base");
  } else {
    console.log("  ⚠ 部分条件未满足，请检查上方日志");
    process.exit(1);
  }
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
