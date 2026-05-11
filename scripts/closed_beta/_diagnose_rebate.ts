import { ethers } from "hardhat";

async function main() {
  const VAULT    = "0x2D2C7BbE92571FF28A23e44d19232e9137F3a310";
  const TREASURY = "0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083";
  const MANAGER  = "0x03987638d7a0522c2e1521714e46D486628c87a0";

  const ERC20 = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ];
  const MANAGER_ABI = [
    "function previewRebate(uint256) view returns (uint256)",
  ];
  const VAULT_ABI = [
    "function accrueManagementFee() external",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function mgmtFeeBpsPerMonth() view returns (uint256)",
    "function lastFeeAccrual() view returns (uint256)",
  ];

  const [deployer, customerA] = await ethers.getSigners();
  const provider = ethers.provider;

  const vaultErc  = new ethers.Contract(VAULT,    ERC20,       provider);
  const vault     = new ethers.Contract(VAULT,    VAULT_ABI,   deployer);
  const manager   = new ethers.Contract(MANAGER,  MANAGER_ABI, customerA);

  const lockId = 0n;
  const fmt18 = (v: bigint) => ethers.formatUnits(v, 18);
  const fmt6  = (v: bigint) => ethers.formatUnits(v, 6);

  const [rebate, treasuryBal, allowance, totalAssets, totalSupply, feeBps, lastFeeAt] =
    await Promise.all([
      manager.previewRebate(lockId),
      vaultErc.balanceOf(TREASURY),
      vaultErc.allowance(TREASURY, MANAGER),
      vault.totalAssets(),
      vault.totalSupply(),
      vault.mgmtFeeBpsPerMonth(),
      vault.lastFeeAccrual(),
    ]);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const elapsed = now - lastFeeAt;

  console.log("=== claimRebate 根因诊断 ===\n");
  console.log("  previewRebate(lockId=0)        :", fmt18(rebate), "yrCORE");
  console.log("  Treasury yrCORE 余额            :", fmt18(treasuryBal), "yrCORE");
  console.log("  allowance(treasury→manager)    :", allowance === ethers.MaxUint256 ? "MaxUint256 ✓" : fmt18(allowance));
  console.log("");
  console.log("  Vault totalAssets              :", fmt6(totalAssets), "USDC");
  console.log("  Vault totalSupply              :", fmt18(totalSupply), "yrCORE");
  console.log("  mgmtFeeBpsPerMonth             :", feeBps.toString(), "bps");
  console.log("  lastFeeAccruedAt               :", new Date(Number(lastFeeAt) * 1000).toISOString());
  console.log("  elapsed since last accrual     :", (Number(elapsed) / 3600).toFixed(2), "hours");
  console.log("");

  if (treasuryBal < rebate) {
    const shortfall = rebate - treasuryBal;
    console.log("  ⚠ 根因确认: Treasury yrCORE 余额不足");
    console.log("  需要 (rebate)  :", fmt18(rebate),     "yrCORE");
    console.log("  持有 (balance) :", fmt18(treasuryBal), "yrCORE");
    console.log("  缺口           :", fmt18(shortfall),   "yrCORE");
    console.log("");

    // 估算 accrueManagementFee 能产生多少 yrCORE
    // fee = totalSupply * feeBps * elapsed / (10000 * 30 * 86400)
    const SECONDS_PER_MONTH = 30n * 24n * 3600n;
    const feeShares = totalSupply * feeBps * elapsed / (10000n * SECONDS_PER_MONTH);
    console.log("  若现在调用 accrueManagementFee():");
    console.log("  预计新增 yrCORE :", fmt18(feeShares), "yrCORE");
    const afterAccrue = treasuryBal + feeShares;
    console.log("  Treasury 累计后 :", fmt18(afterAccrue), "yrCORE");
    if (afterAccrue >= rebate) {
      console.log("  → 调用 accrueManagementFee() 后 Treasury 将足够 ✓");
    } else {
      const remaining = rebate - afterAccrue;
      console.log("  → 仍不足，还缺:", fmt18(remaining), "yrCORE");
      console.log("  → 需要 deployer 先存入少量 USDC 再 transfer yrCORE 到 Treasury");
    }
  } else {
    console.log("  ✓ Treasury 余额充足，失败原因在其他地方");
  }
}

main().catch(console.error);
