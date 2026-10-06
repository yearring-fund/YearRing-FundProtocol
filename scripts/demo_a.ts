/**
 * Demo Scene A — Regular User Path
 *
 * deposit → hold free → strategy accrues yield → withdraw
 *
 * Shows: passive yield from 100% reserve vault + strategy layer
 */
import { ethers } from "hardhat";

const D6       = (n: number) => ethers.parseUnits(String(n), 6);
const fmtUSDC  = (n: bigint) => (Number(n) / 1e6).toFixed(2) + " USDC";
const fmtPPS   = (n: bigint) => (Number(n) / 1e6).toFixed(6) + " USDC/share";
const sep      = () => console.log("-".repeat(52));

async function main() {
  const [deployer, admin, guardian, treasury, alice] = await ethers.getSigners();

  console.log("\n" + "=".repeat(52));
  console.log("  SCENE A  |  Regular User Path");
  console.log("=".repeat(52));

  // ── Deploy ──────────────────────────────────────────
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
    treasury.address, guardian.address, admin.address
  );
  const stratMgr = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
    await usdc.getAddress(), await vault.getAddress(), admin.address, guardian.address
  );
  const dummy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
    await usdc.getAddress()
  );

  // Wire vault → strategyManager
  await vault.connect(admin).setModules(await stratMgr.getAddress());
  await vault.connect(admin).setExternalTransfersEnabled(true);
  // TODO(demo-only): reserveRatioBps=0 allows full USDC deployment for demo clarity.
  //   Production should keep a non-zero reserve (e.g. 1000 bps = 10%).
  await vault.connect(admin).setReserveRatioBps(0);

  // Wire strategyManager → DummyStrategy (must be paused for setStrategy)
  const OPERATOR_ROLE = await stratMgr.OPERATOR_ROLE();
  await stratMgr.connect(admin).grantRole(OPERATOR_ROLE, admin.address);
  await stratMgr.connect(guardian).pause();
  await stratMgr.connect(admin).setStrategy(await dummy.getAddress());
  await stratMgr.connect(admin).unpause();

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

  // ── Step 2: Deploy to strategy ───────────────────────
  sep();
  const deployAmount = D6(800);
  await vault.connect(admin).transferToStrategyManager(deployAmount);
  await stratMgr.connect(admin).invest(deployAmount);
  console.log("[2] 800 USDC deployed to strategy");
  console.log("    Vault liquid     :", fmtUSDC(await usdc.balanceOf(await vault.getAddress())));
  console.log("    Strategy balance :", fmtUSDC(await usdc.balanceOf(await dummy.getAddress())));
  console.log("    totalAssets      :", fmtUSDC(await vault.totalAssets()));

  // ── Step 3: Strategy accrues yield ──────────────────
  sep();
  const yield_ = D6(80); // 10% on 800 deployed
  // TODO(demo-only): minting USDC directly to DummyStrategy simulates Aave yield.
  //   Production: yield accrues naturally via aToken rebasing in AaveV3StrategyV01.
  await usdc.mint(await dummy.getAddress(), yield_);
  console.log("[3] Strategy accrues 80 USDC yield (10%)");
  console.log("    Strategy balance :", fmtUSDC(await usdc.balanceOf(await dummy.getAddress())));

  // ── Step 4: Harvest yield back to vault ─────────────
  sep();
  await stratMgr.connect(admin).divest(D6(880));        // pull from strategy → stratMgr
  await stratMgr.connect(admin).returnToVault(D6(880)); // stratMgr → vault
  const pps1 = await vault.convertToAssets(ethers.parseUnits("1", 18));
  console.log("[4] Yield harvested back to vault");
  console.log("    totalAssets      :", fmtUSDC(await vault.totalAssets()));
  console.log("    pricePerShare    :", fmtPPS(pps1));
  const gain = Number(pps1 - pps0) / 1e6 * 100;
  console.log("    NAV gain         : +" + gain.toFixed(2) + "%");

  // ── Step 5: Alice withdraws all ──────────────────────
  sep();
  const usdcBefore = await usdc.balanceOf(alice.address);
  await vault.connect(alice).redeem(shares, alice.address, alice.address);
  const usdcAfter  = await usdc.balanceOf(alice.address);
  const received   = usdcAfter - usdcBefore;
  console.log("[5] Alice redeems all fbUSDC");
  console.log("    USDC received    :", fmtUSDC(received));
  console.log("    Net gain         : +" + fmtUSDC(received - D6(1_000)));

  // ── Result ───────────────────────────────────────────
  console.log("\n" + "=".repeat(52));
  console.log("  RESULT: Passive yield via strategy layer.");
  console.log("  No lock required. pricePerShare reflects");
  console.log("  real-time NAV — not a fixed-rate product.");
  console.log("=".repeat(52) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
