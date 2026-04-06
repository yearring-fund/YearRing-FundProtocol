/**
 * metrics.ts — Protocol Metrics Aggregator
 *
 * Outputs protocol-level stats to console and metrics_output.json.
 * O(1) fields come from MetricsLayerV02.snapshot().
 * Iteration-heavy aggregation (tier breakdown, lifecycle stats) runs off-chain.
 *
 * Usage:
 *   npx hardhat run scripts/metrics.ts            # deploy mode (default)
 *   METRICS_MODE=existing npx hardhat run ...     # future: load from deployments/
 *
 * Seed state (deploy mode):
 *   Alice  : 2000 USDC → lock #0 Bronze (active) + lock #3 Bronze (early exit)
 *   Bob    : 2000 USDC → lock #1 Silver (active)
 *   Carol  : 500  USDC → lock #2 Gold   (active)
 *   Time advance: +10 days so active points are non-zero
 */
import { ethers } from "hardhat";
import * as fs   from "fs";
import * as path from "path";

// ─── Format helpers ──────────────────────────────────────────────────────────

const D6  = (n: number) => ethers.parseUnits(String(n), 6);
const D18 = (n: number) => ethers.parseUnits(String(n), 18);
const DAY = 86_400n;

const fmtUSDC   = (n: bigint) => (Number(n) / 1e6).toFixed(2)  + " USDC";
const fmtShares = (n: bigint) => (Number(n) / 1e18).toFixed(4) + " fbUSDC";
const fmtPts    = (n: bigint) => (Number(n) / 1e6).toFixed(2)  + " pts";
const fmtBps    = (n: bigint) => (Number(n) / 100).toFixed(2)  + "%";

async function advance(seconds: bigint) {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

// ─── Deploy mode ─────────────────────────────────────────────────────────────

async function deployContracts() {
  const [, admin, guardian, treasury, alice, bob, carol] = await ethers.getSigners();

  const usdc   = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault  = await (await ethers.getContractFactory("FundVaultV01")).deploy(
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
  const metricsLayer = await (await ethers.getContractFactory("MetricsLayerV02")).deploy(
    await vault.getAddress(), await ledger.getAddress()
  );

  // Roles & approvals
  const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
  await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());
  await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);
  // TODO(metrics): vault share rebate approval omitted — no claimRebate calls in this script.
  //   Production: treasury must also approve vaultShares to manager for rebate payouts.

  return {
    usdc, vault, ledger, benefit, points, rwToken, manager, metricsLayer,
    admin, guardian, treasury, alice, bob, carol,
  };
}

async function seedState(c: Awaited<ReturnType<typeof deployContracts>>) {
  const { usdc, vault, ledger, rwToken, manager, alice, bob, carol } = c;

  // ── Deposits ────────────────────────────────────────────────────────────────
  // Alice deposits 2000 USDC (used across two locks)
  await usdc.mint(alice.address, D6(2_000));
  await usdc.connect(alice).approve(await vault.getAddress(), D6(2_000));
  await vault.connect(alice).deposit(D6(2_000), alice.address);

  await usdc.mint(bob.address, D6(2_000));
  await usdc.connect(bob).approve(await vault.getAddress(), D6(2_000));
  await vault.connect(bob).deposit(D6(2_000), bob.address);

  await usdc.mint(carol.address, D6(500));
  await usdc.connect(carol).approve(await vault.getAddress(), D6(500));
  await vault.connect(carol).deposit(D6(500), carol.address);

  const aliceShares = await vault.balanceOf(alice.address);
  const bobShares   = await vault.balanceOf(bob.address);
  const carolShares = await vault.balanceOf(carol.address);

  // All approve shares to ledger (lockWithReward pulls from here)
  await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
  await vault.connect(bob).approve(await ledger.getAddress(), ethers.MaxUint256);
  await vault.connect(carol).approve(await ledger.getAddress(), ethers.MaxUint256);

  // ── Locks ────────────────────────────────────────────────────────────────────
  // Lock #0: alice, half shares, 30d (Bronze) → stays active
  await manager.connect(alice).lockWithReward(aliceShares / 2n, Number(30n * DAY));

  // Lock #1: bob, all shares, 90d (Silver) → stays active
  await manager.connect(bob).lockWithReward(bobShares, Number(90n * DAY));

  // Lock #2: carol, all shares, 180d (Gold) → stays active
  await manager.connect(carol).lockWithReward(carolShares, Number(180n * DAY));

  // Lock #3: alice, remaining half shares, 30d (Bronze) → early exit
  await manager.connect(alice).lockWithReward(aliceShares / 2n, Number(30n * DAY));
  const issued3 = await manager.issuedRewardTokens(3n);
  await rwToken.connect(alice).approve(await manager.getAddress(), issued3);
  await manager.connect(alice).earlyExitWithReturn(3n);

  // Advance 10 days so active lock points are non-zero
  await advance(10n * DAY);
}

// ─── Metrics collection (off-chain iteration) ────────────────────────────────

const TIER_NAME: Record<string, "Bronze" | "Silver" | "Gold"> = {
  "1": "Bronze",
  "2": "Silver",
  "3": "Gold",
};

interface TierBreakdown {
  Bronze: { count: number; shares: bigint };
  Silver: { count: number; shares: bigint };
  Gold:   { count: number; shares: bigint };
}

interface LifecycleStats {
  activeLocks:        number;
  earlyExitCount:     number;
  normalUnlocked:     number;
  maturedNotUnlocked: number;
  totalActivePoints:  bigint;
}

async function collectMetrics(c: Awaited<ReturnType<typeof deployContracts>>) {
  const { vault, ledger, benefit, points, metricsLayer } = c;

  const snap          = await metricsLayer.snapshot();
  const totalLocksEver = Number(snap.totalLocksEver);

  const block = await ethers.provider.getBlock("latest");
  const now   = BigInt(block!.timestamp);

  const tier: TierBreakdown = {
    Bronze: { count: 0, shares: 0n },
    Silver: { count: 0, shares: 0n },
    Gold:   { count: 0, shares: 0n },
  };
  const lc: LifecycleStats = {
    activeLocks: 0, earlyExitCount: 0,
    normalUnlocked: 0, maturedNotUnlocked: 0,
    totalActivePoints: 0n,
  };

  for (let id = 0; id < totalLocksEver; id++) {
    const pos = await ledger.getLock(BigInt(id));
    if (pos.owner === ethers.ZeroAddress) continue;

    if (pos.earlyExited) { lc.earlyExitCount++;  continue; }
    if (pos.unlocked)    { lc.normalUnlocked++;   continue; }

    // Active lock
    lc.activeLocks++;
    if (now >= pos.unlockAt) lc.maturedNotUnlocked++;

    const tierVal  = await benefit.tierOf(BigInt(id));
    const tierName = TIER_NAME[tierVal.toString()];
    if (tierName) {
      tier[tierName].count++;
      tier[tierName].shares += pos.shares;
    }

    lc.totalActivePoints += await points.pointsOf(BigInt(id));
  }

  return { snap, tier, lc };
}

// ─── Console output ──────────────────────────────────────────────────────────

function printMetrics(
  snap: Awaited<ReturnType<typeof collectMetrics>>["snap"],
  tier: TierBreakdown,
  lc:   LifecycleStats,
) {
  const sep = "─".repeat(50);
  console.log("\n" + "═".repeat(50));
  console.log("  PROTOCOL METRICS  |  MetricsLayerV02");
  console.log("═".repeat(50));

  console.log(sep);
  console.log("  Snapshot (O1 — single contract call)");
  console.log(sep);
  console.log("  TVL              :", fmtUSDC(snap.totalTVL));
  console.log("  Total Locked     :", fmtShares(snap.totalLockedShares));
  console.log("  Locked Ratio     :", fmtBps(snap.lockedRatioBps));
  console.log("  Total Locks Ever :", snap.totalLocksEver.toString());

  console.log(sep);
  console.log("  Active Lock Tier Distribution  (off-chain aggregation)");
  console.log(sep);
  console.log("               Locks    Shares");
  for (const t of ["Bronze", "Silver", "Gold"] as const) {
    const d = tier[t];
    const locks  = String(d.count).padStart(4);
    const shares = fmtShares(d.shares).padStart(20);
    console.log(`  ${t.padEnd(8)}  : ${locks}   ${shares}`);
  }

  console.log(sep);
  console.log("  Lifecycle Stats  (off-chain aggregation)");
  console.log(sep);
  console.log("  Active Locks          :", lc.activeLocks);
  console.log("  Early Exit Count      :", lc.earlyExitCount);
  console.log("  Normal Unlocked       :", lc.normalUnlocked);
  console.log("  Matured (not unlocked):", lc.maturedNotUnlocked);
  console.log("  Total Active Points   :", fmtPts(lc.totalActivePoints));

  console.log("═".repeat(50) + "\n");
}

// ─── JSON output ─────────────────────────────────────────────────────────────

function saveJson(
  snap: Awaited<ReturnType<typeof collectMetrics>>["snap"],
  tier: TierBreakdown,
  lc:   LifecycleStats,
) {
  const output = {
    generatedAt: new Date().toISOString(),
    snapshot: {
      totalTVL:                    snap.totalTVL.toString(),
      totalTVL_formatted:          fmtUSDC(snap.totalTVL),
      totalLockedShares:           snap.totalLockedShares.toString(),
      totalLockedShares_formatted: fmtShares(snap.totalLockedShares),
      lockedRatioBps:              snap.lockedRatioBps.toString(),
      lockedRatio_pct:             fmtBps(snap.lockedRatioBps),
      totalLocksEver:              snap.totalLocksEver.toString(),
    },
    tierBreakdown: {
      byCount: {
        Bronze: tier.Bronze.count,
        Silver: tier.Silver.count,
        Gold:   tier.Gold.count,
      },
      byShares: {
        Bronze:           tier.Bronze.shares.toString(),
        Bronze_formatted: fmtShares(tier.Bronze.shares),
        Silver:           tier.Silver.shares.toString(),
        Silver_formatted: fmtShares(tier.Silver.shares),
        Gold:             tier.Gold.shares.toString(),
        Gold_formatted:   fmtShares(tier.Gold.shares),
      },
    },
    lifecycleStats: {
      activeLocks:                   lc.activeLocks,
      earlyExitCount:                lc.earlyExitCount,
      normalUnlocked:                lc.normalUnlocked,
      maturedNotUnlocked:            lc.maturedNotUnlocked,
      totalActivePoints:             lc.totalActivePoints.toString(),
      totalActivePoints_formatted:   fmtPts(lc.totalActivePoints),
    },
  };

  const outPath = path.join(process.cwd(), "metrics_output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`  JSON saved → ${outPath}\n`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Mode detection — structure allows future --mode=existing via METRICS_MODE env var
  const mode = (process.env.METRICS_MODE ?? "deploy") as "deploy" | "existing";

  if (mode === "existing") {
    // TODO: load contract addresses from deployments/ directory
    //   1. Read deployments/<network>/addresses.json
    //   2. Connect contracts with ethers.getContractAt(...)
    //   3. Call collectMetrics() directly (no seedState)
    throw new Error("METRICS_MODE=existing not yet implemented.");
  }

  console.log("  [metrics] deploying contracts + seeding state...");
  const contracts = await deployContracts();
  await seedState(contracts);

  console.log("  [metrics] collecting metrics...");
  const { snap, tier, lc } = await collectMetrics(contracts);

  printMetrics(snap, tier, lc);
  saveJson(snap, tier, lc);
}

main().catch(e => { console.error(e); process.exit(1); });
