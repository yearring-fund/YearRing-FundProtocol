/**
 * Demo Scene B — Long-Term Committed User Path
 *
 * deposit → lock 180d → accrue points → strategy yield → matured → unlock → redeem
 *
 * Shows: upfront reward tokens + points accumulation + fee discount
 *        differentiates committed users from passive holders
 */
import { ethers } from "hardhat";

const D6       = (n: number) => ethers.parseUnits(String(n), 6);
const D18      = (n: number) => ethers.parseUnits(String(n), 18);
const fmtUSDC  = (n: bigint) => (Number(n) / 1e6).toFixed(2) + " USDC";
const fmtPPS   = (n: bigint) => (Number(n) / 1e6).toFixed(6) + " USDC/share";
const fmtTok   = (n: bigint) => (Number(n) / 1e18).toFixed(4) + " RWT";
const fmtPts   = (n: bigint) => (Number(n) / 1e6).toFixed(2) + " pts";
const sep      = () => console.log("-".repeat(52));
const DAY      = 86400n;
const D180     = 180n * DAY;

async function advance(seconds: bigint) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

async function main() {
  const [, admin, guardian, treasury, alice] = await ethers.getSigners();

  console.log("\n" + "=".repeat(52));
  console.log("  SCENE B  |  Long-Term Committed User Path");
  console.log("=".repeat(52));

  // ── Deploy ──────────────────────────────────────────
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
    treasury.address, guardian.address, admin.address
  );
  const ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
    await vault.getAddress(), admin.address, guardian.address
  );
  const benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
    await ledger.getAddress()
  );
  const points = await (await ethers.getContractFactory("LockPointsV02")).deploy(
    await ledger.getAddress(), await benefit.getAddress(), await vault.getAddress()
  );
  const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
    await ledger.getAddress()
  );
  const rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
    "Reward Token", "RWT", D18(1_000_000), treasury.address
  );
  const manager = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
    await ledger.getAddress(),
    await benefit.getAddress(),
    await rwToken.getAddress(),
    await vault.getAddress(),
    await vault.getAddress(),
    treasury.address, admin.address, guardian.address
  );

  // Strategy
  const stratMgr = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
    await usdc.getAddress(), await vault.getAddress(), admin.address, guardian.address
  );
  const dummy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
    await usdc.getAddress()
  );
  await vault.connect(admin).setModules(await stratMgr.getAddress());
  await vault.connect(admin).setExternalTransfersEnabled(true);
  // TODO(demo-only): reserveRatioBps=0 allows full USDC deployment for demo clarity.
  //   Production should keep a non-zero reserve (e.g. 1000 bps = 10%).
  await vault.connect(admin).setReserveRatioBps(0);
  const stratOp = await stratMgr.OPERATOR_ROLE();
  await stratMgr.connect(admin).grantRole(stratOp, admin.address);
  await stratMgr.connect(guardian).pause();
  await stratMgr.connect(admin).setStrategy(await dummy.getAddress());
  await stratMgr.connect(admin).unpause();

  // Grant roles
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());
  await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

  // ── Step 1: Alice deposits ───────────────────────────
  sep();
  await usdc.mint(alice.address, D6(1_000));
  await usdc.connect(alice).approve(await vault.getAddress(), D6(1_000));
  await vault.connect(alice).deposit(D6(1_000), alice.address);
  const shares = await vault.balanceOf(alice.address);
  const pps0   = await vault.convertToAssets(ethers.parseUnits("1", 18));
  console.log("[1] Alice deposits 1,000 USDC");
  console.log("    fbUSDC received  :", (Number(shares) / 1e18).toFixed(4));
  console.log("    pricePerShare    :", fmtPPS(pps0));

  // ── Step 2: Lock 180 days ────────────────────────────
  sep();
  await vault.connect(alice).approve(await ledger.getAddress(), shares);
  // TODO(demo-only): Number(D180) casts bigint to number for the contract call.
  //   Safe here (15_552_000 < Number.MAX_SAFE_INTEGER). Use bigint overload if available.
  const tx      = await manager.connect(alice).lockWithReward(shares, Number(D180));
  const receipt = await tx.wait();
  const ev = receipt!.logs
    .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "LockedWithReward");
  const lockId    = ev!.args.lockId;
  const rwIssued  = await manager.issuedRewardTokens(lockId);
  // TODO(demo-only): same Number() cast as above.
  const discount  = await benefit.feeDiscountFromDuration(Number(D180));

  console.log("[2] Alice locks all fbUSDC for 180 days (Gold tier)");
  console.log("    Lock ID          :", lockId.toString());
  console.log("    Reward tokens    :", (Number(rwIssued) / 1e18).toFixed(2), "RWT (issued upfront)");
  console.log("    Fee discount     :", (Number(discount) / 100).toFixed(0) + "% off mgmt fee");
  console.log("    State            : LockedAccumulating");

  // ── Step 3: Deploy to strategy + accrue yield ────────
  sep();
  // Locking freezes shares (fbUSDC), not the underlying USDC.
  // Vault still holds 1000 USDC → admin can deploy to strategy.
  const deployAmt = D6(800);
  await vault.connect(admin).transferToStrategyManager(deployAmt);
  await stratMgr.connect(admin).invest(deployAmt);
  console.log("[3a] 800 USDC deployed to strategy while alice's shares are locked");
  console.log("     Vault liquid    :", fmtUSDC(await usdc.balanceOf(await vault.getAddress())));
  console.log("     Strategy        :", fmtUSDC(await usdc.balanceOf(await dummy.getAddress())));
  console.log("     totalAssets     :", fmtUSDC(await vault.totalAssets()));

  const yieldAmt = D6(80); // 10% on 800 deployed
  // TODO(demo-only): minting USDC directly to DummyStrategy simulates Aave yield.
  //   Production: yield accrues naturally via aToken rebasing in AaveV3StrategyV01.
  await usdc.mint(await dummy.getAddress(), yieldAmt);
  await stratMgr.connect(admin).divest(deployAmt + yieldAmt);
  await stratMgr.connect(admin).returnToVault(deployAmt + yieldAmt);
  console.log("[3b] Strategy accrues 80 USDC yield (10%), harvested back");
  console.log("     totalAssets     :", fmtUSDC(await vault.totalAssets()));
  const pps1 = await vault.convertToAssets(ethers.parseUnits("1", 18));
  console.log("     pricePerShare   :", fmtPPS(pps1));

  // ── Step 4: Advance 180 days → Matured ──────────────
  sep();
  await advance(D180);
  const state = await engine.lockStateOf(lockId);
  const pts   = await points.pointsOf(lockId);
  console.log("[4] 180 days elapsed");
  console.log("    State            :", state === 2n ? "Matured" : state.toString());
  console.log("    Points accrued   :", fmtPts(pts));

  // ── Step 5: Unlock ───────────────────────────────────
  sep();
  await ledger.connect(alice).unlock(lockId);
  const sharesBack = await vault.balanceOf(alice.address);
  console.log("[5] Alice unlocks position");
  console.log("    fbUSDC returned  :", (Number(sharesBack) / 1e18).toFixed(4));

  // ── Step 6: Redeem ───────────────────────────────────
  sep();
  await vault.connect(alice).redeem(sharesBack, alice.address, alice.address);
  const usdcFinal = await usdc.balanceOf(alice.address);
  const pps2      = await vault.convertToAssets(ethers.parseUnits("1", 18));
  console.log("[6] Alice redeems fbUSDC");
  console.log("    USDC received    :", fmtUSDC(usdcFinal));
  console.log("    Net gain         : +" + fmtUSDC(usdcFinal - D6(1_000)));
  console.log("    RWT kept         :", (Number(await rwToken.balanceOf(alice.address)) / 1e18).toFixed(2), "RWT");

  // ── Result ───────────────────────────────────────────
  console.log("\n" + "=".repeat(52));
  console.log("  RESULT: Committed user gets yield + reward");
  console.log("  tokens upfront + points + fee discount.");
  console.log("  Lock preserves NAV exposure during period.");
  console.log("=".repeat(52) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
