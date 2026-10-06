/**
 * redeploy_lock_reward_manager.ts
 * 仅重新部署 LockRewardManagerV02（REWARD_DENOMINATOR = 10_000 * 500 = 5_000_000）
 * 旧合约的 OPERATOR_ROLE 保留（以便旧锁仓可继续 earlyExit）
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const signers      = await ethers.getSigners();
  const deployer     = signers[0];
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const adminAddr    = dep.config.admin;
  const guardianAddr = dep.config.guardian;
  const treasuryAddr = dep.config.treasury;

  if (deployer.address.toLowerCase() !== adminAddr.toLowerCase())
    throw new Error(`Signer must be admin. Got ${deployer.address}`);

  const treasurySigner = signers.find(s => s.address.toLowerCase() === treasuryAddr.toLowerCase());
  if (!treasurySigner) throw new Error(`Treasury signer not found. Add TREASURY_PRIVATE_KEY to .env`);

  console.log("Network   :", network.name);
  console.log("Deployer  :", deployer.address);
  console.log("Ledger    :", c.LockLedgerV02);
  console.log("Benefit   :", c.LockBenefitV02);
  console.log("RewardTkn :", c.RewardToken);
  console.log("Vault     :", c.FundVaultV01);
  console.log("Old LRM   :", c.LockRewardManagerV02, "(OPERATOR_ROLE kept for old locks)");

  // 1. Deploy new LockRewardManagerV02
  console.log("\n[1/4] Deploying new LockRewardManagerV02…");
  const lockMgr = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
    c.LockLedgerV02,
    c.LockBenefitV02,
    c.RewardToken,
    c.FundVaultV01,
    c.FundVaultV01,
    treasuryAddr, adminAddr, guardianAddr
  );
  await lockMgr.waitForDeployment();
  const newLockMgrAddr = await lockMgr.getAddress();
  console.log("  New LockRewardManagerV02:", newLockMgrAddr);

  // 2. Grant OPERATOR_ROLE to new contract
  console.log("\n[2/4] Granting OPERATOR_ROLE to new contract…");
  const ledger = await ethers.getContractAt("LockLedgerV02", c.LockLedgerV02);
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await (await ledger.grantRole(OPERATOR_ROLE, newLockMgrAddr)).wait();
  console.log("  OPERATOR_ROLE → new LockRewardManagerV02 ✓");

  // 3. Treasury approvals for new contract
  console.log("\n[3/4] Treasury approvals for new contract…");
  const vault       = await ethers.getContractAt("FundVaultV01", c.FundVaultV01);
  const rewardToken = await ethers.getContractAt("RewardToken",  c.RewardToken);
  await (await vault.connect(treasurySigner).approve(newLockMgrAddr, ethers.MaxUint256)).wait();
  console.log("  fbUSDC → new LockRewardManagerV02: MaxUint256 ✓");
  await (await rewardToken.connect(treasurySigner).approve(newLockMgrAddr, ethers.MaxUint256)).wait();
  console.log("  RWT   → new LockRewardManagerV02: MaxUint256 ✓");

  // 4. Save to deployments
  console.log("\n[4/4] Saving deployment…");
  c.LockRewardManagerV02_old = c.LockRewardManagerV02;
  c.LockRewardManagerV02     = newLockMgrAddr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  console.log("  deployments saved ✓");

  console.log("\n" + "=".repeat(60));
  console.log("  Done.");
  console.log("  New  LockRewardManagerV02:", newLockMgrAddr);
  console.log("  Old  LockRewardManagerV02:", c.LockRewardManagerV02_old, "(OPERATOR_ROLE kept)");
  console.log("  Next: run update_frontend_addresses.ts to sync docs/v02/index.html");
  console.log("=".repeat(60));
}

main().catch(e => { console.error(e); process.exitCode = 1; });
