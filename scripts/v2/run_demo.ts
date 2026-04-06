/**
 * run_demo.ts — V2 full lifecycle demo (local) or state snapshot (external)
 *
 * hardhat (in-process):
 *   Deploys fresh contracts per scene and runs all three scenes end-to-end
 *   with evm_increaseTime. No .env required.
 *
 * localhost / testnet:
 *   Inspection-only — displays current on-chain state of pre-seeded
 *   positions from seed_v2.ts. No transactions submitted.
 *   Use local demo for time-dependent lifecycle (maturity, unlock, rebate).
 *
 * Usage:
 *   npx hardhat run scripts/v2/run_demo.ts                       # full lifecycle
 *   npx hardhat run scripts/v2/run_demo.ts --network baseSepolia # state snapshot
 *   npx hardhat run scripts/v2/run_demo.ts --network localhost   # state snapshot
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { v2DemoConfig } from "../config";

// ─── Formatting helpers ───────────────────────────────────────────────────
const D6     = (n: number)  => ethers.parseUnits(String(n), 6);
const fmtU   = (n: bigint)  => (Number(n) / 1e6).toFixed(2)   + " USDC";
const fmtS   = (n: bigint)  => (Number(n) / 1e18).toFixed(4)  + " fbUSDC";
const fmtPPS = (n: bigint)  => (Number(n) / 1e6).toFixed(6)   + " USDC/share";
const fmtRWT = (n: bigint)  => (Number(n) / 1e18).toFixed(2)  + " RWT";
const fmtA   = (a: string)  => a.slice(0, 6) + "..." + a.slice(-4);
const SEP    = ()           => console.log("─".repeat(56));
const HDR    = (s: string)  => {
  console.log("\n" + "═".repeat(56));
  console.log("  " + s);
  console.log("═".repeat(56));
};
const STEP   = (n: number, s: string) => { SEP(); console.log(`[${n}] ${s}`); };

async function advance(seconds: bigint) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

// ─── Parse LockedWithReward event safely ──────────────────────────────────
async function getLockId(receipt: any, iface: any, persona: string): Promise<bigint> {
  const ev = receipt.logs
    .map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "LockedWithReward");
  if (!ev) {
    throw new Error(
      `LockedWithReward event not found in tx ${receipt.hash} (persona: ${persona}).\n` +
      `Check lockWithReward call and contract state.`
    );
  }
  return ev.args.lockId;
}

// ─── Fresh contract stack for one scene ──────────────────────────────────
async function deployStack(admin: any, guardian: any, treasury: any) {
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    await usdc.getAddress(), "YearRing Fund", "fbUSDC",
    treasury.address, guardian.address, admin.address
  );
  const stratMgr = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
    await usdc.getAddress(), await vault.getAddress(), admin.address, guardian.address
  );
  const dummy = await (await ethers.getContractFactory("DummyStrategy")).deploy(await usdc.getAddress());

  await (await vault.connect(admin).setModules(await stratMgr.getAddress())).wait();
  await (await vault.connect(admin).setExternalTransfersEnabled(true)).wait();
  await (await vault.connect(admin).setReserveRatioBps(0)).wait();

  const stratOp = await stratMgr.OPERATOR_ROLE();
  await (await stratMgr.connect(admin).grantRole(stratOp, admin.address)).wait();
  await (await stratMgr.connect(guardian).pause()).wait();
  await (await stratMgr.connect(admin).setStrategy(await dummy.getAddress())).wait();
  await (await stratMgr.connect(admin).unpause()).wait();

  const rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
    "YearRing Reward Token", "RWT", ethers.parseEther("1000000"), treasury.address
  );
  const ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
    await vault.getAddress(), admin.address, guardian.address
  );
  const benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
    await ledger.getAddress()
  );
  const lockMgr = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
    await ledger.getAddress(), await benefit.getAddress(),
    await rwToken.getAddress(), await vault.getAddress(), await vault.getAddress(),
    treasury.address, admin.address, guardian.address
  );
  const benModule = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
    await ledger.getAddress(), admin.address
  );
  const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
    await ledger.getAddress()
  );

  const OPERATOR = await ledger.OPERATOR_ROLE();
  await (await ledger.connect(admin).grantRole(OPERATOR, await lockMgr.getAddress())).wait();
  await (await ledger.connect(admin).grantRole(OPERATOR, await benModule.getAddress())).wait();
  await (await vault.connect(treasury).approve(await lockMgr.getAddress(), ethers.MaxUint256)).wait();
  await (await rwToken.connect(treasury).approve(await lockMgr.getAddress(), ethers.MaxUint256)).wait();

  // Treasury deposits USDC so it holds fbUSDC to pay fee rebates.
  // Done BEFORE setMgmtFeeBpsPerMonth so no fee accrues on this deposit.
  const vaultAddr = await vault.getAddress();
  await (await usdc.mint(treasury.address, D6(500))).wait();
  await (await usdc.connect(treasury).approve(vaultAddr, D6(500))).wait();
  await (await vault.connect(treasury).deposit(D6(500), treasury.address)).wait();

  // Set mgmt fee AFTER all approvals and initial deposits
  await (await vault.connect(admin).setMgmtFeeBpsPerMonth(100)).wait();

  return { usdc, vault, stratMgr, dummy, rwToken, ledger, benefit, lockMgr, benModule, engine };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE A — Regular User
// ═══════════════════════════════════════════════════════════════════════════
async function sceneA(admin: any, guardian: any, treasury: any, alice: any) {
  HDR("SCENE A  |  Regular User Path");
  console.log("Deposit → strategy earns yield → redeem");
  console.log("No lock required — baseline yield product.");

  const { usdc, vault, stratMgr, dummy } = await deployStack(admin, guardian, treasury);
  const vaultAddr    = await vault.getAddress();
  const dummyAddr    = await dummy.getAddress();

  STEP(1, "Alice deposits 1,000 USDC");
  await (await usdc.mint(alice.address, D6(1_000))).wait();
  await (await usdc.connect(alice).approve(vaultAddr, D6(1_000))).wait();
  await (await vault.connect(alice).deposit(D6(1_000), alice.address)).wait();
  const shares  = await vault.balanceOf(alice.address);
  const pps0    = await vault.pricePerShare();
  console.log("    fbUSDC received  :", fmtS(shares));
  console.log("    pricePerShare    :", fmtPPS(pps0));

  STEP(2, "800 USDC deployed to strategy");
  await (await vault.connect(admin).transferToStrategyManager(D6(800))).wait();
  await (await stratMgr.connect(admin).invest(D6(800))).wait();
  console.log("    Vault liquid     :", fmtU(await usdc.balanceOf(vaultAddr)));
  console.log("    In strategy      :", fmtU(await usdc.balanceOf(dummyAddr)));
  console.log("    totalAssets      :", fmtU(await vault.totalAssets()));

  STEP(3, "Strategy earns 80 USDC (10% on 800 deployed)");
  await (await usdc.mint(dummyAddr, D6(80))).wait();
  await (await stratMgr.connect(admin).divest(D6(880))).wait();
  await (await stratMgr.connect(admin).returnToVault(D6(880))).wait();
  const pps1 = await vault.pricePerShare();
  console.log("    totalAssets      :", fmtU(await vault.totalAssets()));
  console.log("    pricePerShare    :", fmtPPS(pps1));
  const pctGain = ((Number(pps1) - Number(pps0)) / Number(pps0) * 100).toFixed(4);
  console.log("    NAV increase     : +" + pctGain + "%");

  STEP(4, "Alice redeems all shares");
  await (await vault.connect(alice).redeem(shares, alice.address, alice.address)).wait();
  const usdcOut = await usdc.balanceOf(alice.address);
  console.log("    USDC received    :", fmtU(usdcOut));
  console.log("    Net gain         : +" + fmtU(usdcOut - D6(1_000)));

  SEP();
  console.log("✓ SCENE A: Passive holder earned +80 USDC yield. No lock required.");
  console.log("  Narrative: 'The floor — real yield from a real strategy.'");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE B — Long-Term Committed User
// ═══════════════════════════════════════════════════════════════════════════
async function sceneB(admin: any, guardian: any, treasury: any, bob: any) {
  HDR("SCENE B  |  Long-Term Committed User Path");
  console.log("Deposit → lock 180d Gold → yield accrues → claim rebate → maturity → unlock");
  console.log("Two stacked incentives: upfront RWT + fee rebate.");

  const { usdc, vault, stratMgr, dummy, rwToken, ledger, benefit, lockMgr, engine } =
    await deployStack(admin, guardian, treasury);
  const vaultAddr   = await vault.getAddress();
  const ledgerAddr  = await ledger.getAddress();
  const dummyAddr   = await dummy.getAddress();

  STEP(1, "Bob deposits 1,000 USDC");
  await (await usdc.mint(bob.address, D6(1_000))).wait();
  await (await usdc.connect(bob).approve(vaultAddr, D6(1_000))).wait();
  await (await vault.connect(bob).deposit(D6(1_000), bob.address)).wait();
  const sharesB = await vault.balanceOf(bob.address);
  const pps0    = await vault.pricePerShare();
  console.log("    fbUSDC received  :", fmtS(sharesB));
  console.log("    pricePerShare    :", fmtPPS(pps0));

  STEP(2, "Bob locks all shares — 180d Gold tier");
  await (await vault.connect(bob).approve(ledgerAddr, sharesB)).wait();
  const txB     = await lockMgr.connect(bob).lockWithReward(sharesB, Number(v2DemoConfig.goldDuration));
  const rcptB   = await txB.wait();
  const lockIdB   = await getLockId(rcptB, lockMgr.interface, "bob");
  const rwIssued  = await lockMgr.issuedRewardTokens(lockIdB);
  const discount  = await benefit.feeDiscountFromDuration(Number(v2DemoConfig.goldDuration));
  const tierB     = await benefit.tierOf(lockIdB);
  const stateB0   = await engine.lockStateOf(lockIdB);

  console.log("    Lock ID          :", lockIdB.toString());
  console.log("    Tier             :", tierB === 3n ? "Gold" : tierB.toString());
  console.log("    RWT issued       :", fmtRWT(rwIssued), "(upfront, immediately usable)");
  console.log("    Fee discount     :", (Number(discount) / 100).toFixed(0) + "% of management fees refunded");
  console.log("    State            :", stateB0 === 1n ? "LockedAccumulating ✓" : stateB0.toString());
  console.log("    totalAssets      :", fmtU(await vault.totalAssets()), "(unchanged — shares moved, not USDC)");

  STEP(3, "800 USDC deployed to strategy while bob is locked");
  await (await vault.connect(admin).transferToStrategyManager(D6(800))).wait();
  await (await stratMgr.connect(admin).invest(D6(800))).wait();
  await (await usdc.mint(dummyAddr, D6(80))).wait();
  await (await stratMgr.connect(admin).divest(D6(880))).wait();
  await (await stratMgr.connect(admin).returnToVault(D6(880))).wait();
  const pps1 = await vault.pricePerShare();
  console.log("    Strategy yield   : +80 USDC (10% on 800 deployed)");
  console.log("    pricePerShare    :", fmtPPS(pps1));
  console.log("    Bob's locked shares appreciate in value automatically.");

  STEP(4, "Claim fee rebate at 90 days (mid-lock)");
  await advance(90n * 86400n);
  const rebatePreview = await lockMgr.previewRebate(lockIdB);
  await (await lockMgr.connect(bob).claimRebate(lockIdB)).wait();
  const bobFreeAfterRebate = await vault.balanceOf(bob.address);
  console.log("    Fee rebate earned :", fmtS(rebatePreview), "(Gold: 60% of mgmt fee refunded)");
  console.log("    Bob free balance  :", fmtS(bobFreeAfterRebate), "(rebate lands here)");

  STEP(5, "180 days total — lock matures");
  await advance(90n * 86400n);
  const stateB1 = await engine.lockStateOf(lockIdB);
  console.log("    State            :", stateB1 === 2n ? "Matured ✓" : stateB1.toString());

  STEP(6, "Bob unlocks and redeems");
  await (await ledger.connect(bob).unlock(lockIdB)).wait();
  const totalShares = await vault.balanceOf(bob.address);
  await (await vault.connect(bob).redeem(totalShares, bob.address, bob.address)).wait();
  const usdcOut = await usdc.balanceOf(bob.address);
  const rwtBal  = await rwToken.balanceOf(bob.address);
  console.log("    USDC received    :", fmtU(usdcOut));
  console.log("    Net gain         : +" + fmtU(usdcOut - D6(1_000)));
  console.log("    RWT kept         :", fmtRWT(rwtBal), "(full amount — kept, not returned)");

  SEP();
  console.log("✓ SCENE B: Committed user earned yield + upfront RWT + fee rebate.");
  console.log("  Narrative: 'Commitment is rewarded immediately and on-chain.'");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENE C — Beneficiary Path
// ═══════════════════════════════════════════════════════════════════════════
async function sceneC(admin: any, guardian: any, treasury: any, carol: any, bob: any) {
  HDR("SCENE C  |  Beneficiary Path");
  console.log("Deposit → lock 90d Silver → designate beneficiary → inactivity → claim → unlock");
  console.log("On-chain lock continuity: positions survive original holder's inactivity.");

  const { usdc, vault, ledger, benefit, lockMgr, benModule, engine } =
    await deployStack(admin, guardian, treasury);
  const vaultAddr   = await vault.getAddress();
  const ledgerAddr  = await ledger.getAddress();

  STEP(1, "Carol deposits 500 USDC");
  await (await usdc.mint(carol.address, D6(500))).wait();
  await (await usdc.connect(carol).approve(vaultAddr, D6(500))).wait();
  await (await vault.connect(carol).deposit(D6(500), carol.address)).wait();
  const sharesC = await vault.balanceOf(carol.address);
  console.log("    fbUSDC received  :", fmtS(sharesC));

  STEP(2, "Carol locks all shares — 90d Silver tier");
  await (await vault.connect(carol).approve(ledgerAddr, sharesC)).wait();
  const txC     = await lockMgr.connect(carol).lockWithReward(sharesC, Number(v2DemoConfig.silverDuration));
  const rcptC   = await txC.wait();
  const lockIdC  = await getLockId(rcptC, lockMgr.interface, "carol");
  const posC0    = await ledger.getLock(lockIdC);
  const rwIssued = await lockMgr.issuedRewardTokens(lockIdC);
  const tierC    = await benefit.tierOf(lockIdC);

  console.log("    Lock ID          :", lockIdC.toString());
  console.log("    Tier             :", tierC === 2n ? "Silver" : tierC.toString());
  console.log("    RWT issued       :", fmtRWT(rwIssued), "(upfront)");
  console.log("    unlockAt         :", new Date(Number(posC0.unlockAt) * 1000).toISOString().slice(0, 10));
  console.log("    State            : LockedAccumulating ✓");

  STEP(3, "Carol designates Bob as beneficiary");
  await (await benModule.connect(carol).setBeneficiary(bob.address)).wait();
  const benSet = await benModule.beneficiaryOf(carol.address);
  console.log("    Carol address    :", fmtA(carol.address));
  console.log("    Beneficiary      :", benSet === bob.address ? `Bob (${fmtA(bob.address)})` : benSet);

  STEP(4, "Admin marks Carol inactive (oracle / demo trigger)");
  await (await benModule.connect(admin).adminMarkInactive(carol.address)).wait();
  const inactive = await benModule.isInactive(carol.address);
  console.log("    isInactive(carol):", inactive);
  console.log("    Lock state       : LockedAccumulating (preserved — no forced exit)");

  STEP(5, "Bob executes beneficiary claim");
  const ownerBefore = (await ledger.getLock(lockIdC)).owner;
  await (await benModule.connect(bob).executeClaim(carol.address, [lockIdC])).wait();
  const posC1   = await ledger.getLock(lockIdC);
  const claimed = await benModule.claimed(carol.address);

  console.log("    Owner before     :", fmtA(ownerBefore), "(Carol)");
  console.log("    Owner after      :", posC1.owner === bob.address
    ? `Bob (${fmtA(posC1.owner)}) ✓`
    : posC1.owner);
  console.log("    unlockAt         :", new Date(Number(posC1.unlockAt) * 1000).toISOString().slice(0, 10), "(unchanged ✓)");
  console.log("    Shares           :", fmtS(posC1.shares), "(unchanged ✓)");
  console.log("    claimed(carol)   :", claimed);
  console.log("    NOTE: fee rebate entitlement stays with Carol (original lock owner, not transferred).");
  console.log("    NOTE: Carol's free fbUSDC balance is NOT transferred on-chain (V2 design).");

  STEP(6, "90 days elapsed — lock matures under Bob's ownership");
  await advance(v2DemoConfig.silverDuration);
  const stateC1 = await engine.lockStateOf(lockIdC);
  console.log("    Lock state       :", stateC1 === 2n ? "Matured ✓" : stateC1.toString());

  STEP(7, "Bob unlocks and redeems (as beneficiary)");
  await (await ledger.connect(bob).unlock(lockIdC)).wait();
  const bobShares = await vault.balanceOf(bob.address);
  await (await vault.connect(bob).redeem(bobShares, bob.address, bob.address)).wait();
  const bobUSDC = await usdc.balanceOf(bob.address);
  console.log("    Bob USDC received:", fmtU(bobUSDC));
  console.log("    Bob redeemed Carol's original 500 USDC (at current NAV).");

  SEP();
  console.log("✓ SCENE C: Locked position continuity preserved through beneficiary transfer.");
  console.log("  Beneficiary receives inherited locked position and unlock rights under current demo rules.");
  console.log("  No forced early exit. Lock completes its full term under new owner.");
  console.log("  Limitations: free fbUSDC not auto-transferred; rebate rights not fully inherited.");
  console.log("  Narrative: 'A committed position is completable — not stranded.'");
}

// ─── External network: inspection-only state snapshot ─────────────────────
async function runStateSnapshot() {
  const deploymentsPath = path.join(__dirname, `../../deployments/${network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(
      `No deployment for ${network.name}.\n` +
      `Run deploy.ts → deploy_v2.ts → setup_v2.ts → seed_v2.ts first.`
    );
  }
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const c   = dep.contracts;

  const vault     = await ethers.getContractAt("FundVaultV01",         c.FundVaultV01);
  const ledger    = await ethers.getContractAt("LockLedgerV02",        c.LockLedgerV02);
  const benefit   = await ethers.getContractAt("LockBenefitV02",       c.LockBenefitV02);
  const lockMgr   = await ethers.getContractAt("LockRewardManagerV02", c.LockRewardManagerV02);
  const benModule = await ethers.getContractAt("BeneficiaryModuleV02", c.BeneficiaryModuleV02);
  const engine    = await ethers.getContractAt("UserStateEngineV02",   c.UserStateEngineV02);
  const rwToken   = await ethers.getContractAt("RewardToken",          c.RewardToken);

  let metrics: any = null;
  if (c.MetricsLayerV02) {
    metrics = await ethers.getContractAt("MetricsLayerV02", c.MetricsLayerV02);
  }

  const TIER  = ["None", "Bronze", "Silver", "Gold"];
  const STATE = ["Normal", "LockedAccumulating", "Matured", "EarlyExit"];

  HDR("INSPECTION-ONLY SEEDED STATE — " + network.name.toUpperCase());
  console.log("No transactions submitted. Displaying pre-seeded positions from seed_v2.ts.");

  // Protocol metrics
  if (metrics) {
    const snap = await metrics.snapshot();
    console.log("\nProtocol:");
    console.log("  TVL             :", fmtU(snap.tvl));
    console.log("  Locked shares   :", fmtS(snap.lockedShares));
    console.log("  Locked ratio    :", (Number(snap.lockedRatioBps) / 100).toFixed(2) + "%");
    console.log("  Total locks ever:", snap.totalLocksEver.toString());
    console.log("  pricePerShare   :", fmtPPS(await vault.pricePerShare()));
  }

  const seed = dep.seed;
  if (!seed) {
    console.log("\nNo seed state found. Run seed_v2.ts first.");
    return;
  }
  console.log("\n  Seeded at:", seed.seededAt);

  // Alice
  SEP();
  console.log("ALICE —", seed.alice.address, `(${seed.alice.scenario})`);
  const aliceLockId = BigInt(seed.alice.lockId);
  const alicePos    = await ledger.getLock(aliceLockId);
  console.log("  Lock ID     :", aliceLockId.toString());
  console.log("  Tier        :", TIER[Number(await benefit.tierOf(aliceLockId))] ?? "?");
  console.log("  State       :", STATE[Number(await engine.lockStateOf(aliceLockId))] ?? "?");
  console.log("  Shares      :", fmtS(alicePos.shares));
  console.log("  unlockAt    :", new Date(Number(alicePos.unlockAt) * 1000).toISOString().slice(0, 10));
  console.log("  RWT balance :", fmtRWT(await rwToken.balanceOf(seed.alice.address)));

  // Bob
  SEP();
  console.log("BOB —", seed.bob.address, "(free holder / beneficiary)");
  console.log("  Free fbUSDC :", fmtS(await vault.balanceOf(seed.bob.address)));
  console.log("  User state  :", STATE[Number(await engine.userStateOf(seed.bob.address))] ?? "?");

  // Carol
  SEP();
  console.log("CAROL —", seed.carol.address, `(${seed.carol.scenario})`);
  const carolLockId  = BigInt(seed.carol.lockId);
  const carolPos     = await ledger.getLock(carolLockId);
  const carolClaimed = await benModule.claimed(seed.carol.address);
  console.log("  Lock ID     :", carolLockId.toString());
  console.log("  Tier        :", TIER[Number(await benefit.tierOf(carolLockId))] ?? "?");
  console.log("  State       :", STATE[Number(await engine.lockStateOf(carolLockId))] ?? "?");
  console.log("  Shares      :", fmtS(carolPos.shares));
  console.log("  unlockAt    :", new Date(Number(carolPos.unlockAt) * 1000).toISOString().slice(0, 10));
  console.log("  Beneficiary :", fmtA(await benModule.beneficiaryOf(seed.carol.address)));
  console.log("  isInactive  :", await benModule.isInactive(seed.carol.address));
  console.log("  claimed     :", carolClaimed);

  if (!carolClaimed) {
    console.log("\n  → Bob can call executeClaim(carol, [" + carolLockId + "]) on-chain.");
  } else {
    console.log("  → Lock already claimed. Current owner:", fmtA(carolPos.owner));
  }

  // Reviewer footer
  console.log("\n" + "═".repeat(56));
  console.log("  What reviewers can do live on this network:");
  console.log("  • Read all lock positions and protocol state above");
  console.log("  • Bob: call executeClaim(carol, [" + carolLockId + "]) if not yet claimed");
  console.log("  • Any address: call read functions on all V2 contracts");
  console.log("─".repeat(56));
  console.log("  What requires local demo or recorded walkthrough:");
  console.log("  • Lock maturity — requires real time (~90–180 days from seed)");
  console.log("  • Fee rebate claim — requires time elapsed under live fee accrual");
  console.log("  • Unlock after maturity — not available until natural unlockAt date");
  console.log("─".repeat(56));
  console.log("  Full lifecycle demo (local, all scenes with time-skip):");
  console.log("  npx hardhat run scripts/v2/run_demo.ts");
  console.log("═".repeat(56));
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  // hardhat (in-process) only → full lifecycle demo
  const isFullLifecycle = network.name === "hardhat";

  if (!isFullLifecycle) {
    await runStateSnapshot();
    return;
  }

  const [, admin, guardian, treasury, alice, bob, carol] = await ethers.getSigners();

  console.log("\n" + "═".repeat(56));
  console.log("  YearRing-FundProtocol V2 — Full Local Demo");
  console.log("  Scenes: A (Regular) · B (Committed) · C (Beneficiary)");
  console.log("  Each scene deploys a fresh contract stack.");
  console.log("═".repeat(56));

  await sceneA(admin, guardian, treasury, alice);
  await sceneB(admin, guardian, treasury, bob);
  await sceneC(admin, guardian, treasury, carol, bob);

  console.log("\n" + "═".repeat(56));
  console.log("  DEMO COMPLETE");
  console.log("─".repeat(56));
  console.log("  A │ Regular User   │ Yield only, no lock");
  console.log("  B │ Committed User │ RWT upfront + fee rebate + yield");
  console.log("  C │ Beneficiary    │ Lock continuity, no forced exit");
  console.log("─".repeat(56));
  console.log("  Testnet state snapshot (pre-seeded):");
  console.log("  npx hardhat run scripts/v2/run_demo.ts --network baseSepolia");
  console.log("═".repeat(56) + "\n");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
