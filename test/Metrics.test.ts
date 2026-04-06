import { expect } from "chai";
import { ethers } from "hardhat";
import {
  FundVaultV01, LockLedgerV02, LockBenefitV02,
  LockRewardManagerV02, MetricsLayerV02, MockUSDC, RewardToken,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * MetricsLayerV02 — snapshot() field correctness
 *
 * Organized per d11test.md — four test scenarios:
 *   1. Zero state      : all four fields equal 0
 *   2. Deposits, no locks : TVL > 0, lockedShares = 0, lockedRatioBps = 0
 *   3. Active locks    : lockedShares matches ledger, lockedRatioBps formula verified
 *   4. totalLocksEver semantics : equals nextLockId (append-only counter)
 *
 * Off-chain aggregation (tier breakdown, points, lifecycle stats) is covered
 * by scripts/metrics.ts E2E execution, not by on-chain tests.
 */
describe("MetricsLayerV02 — snapshot()", function () {
  let vault:        FundVaultV01;
  let ledger:       LockLedgerV02;
  let benefit:      LockBenefitV02;
  let manager:      LockRewardManagerV02;
  let metricsLayer: MetricsLayerV02;
  let usdc:         MockUSDC;
  let rwToken:      RewardToken;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;

  const D6  = (n: number) => ethers.parseUnits(String(n), 6);
  const D18 = (n: number) => ethers.parseUnits(String(n), 18);
  const D30 = 30n * 86_400n;

  let aliceShares: bigint;

  beforeEach(async function () {
    [, admin, guardian, treasury, alice] = await ethers.getSigners();

    usdc   = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault  = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
      treasury.address, admin.address
    );
    ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
      await vault.getAddress(), admin.address, guardian.address
    );
    benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
      await ledger.getAddress()
    );
    rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWT", D18(1_000_000), treasury.address
    );
    manager = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
      await ledger.getAddress(),
      await benefit.getAddress(),
      await rwToken.getAddress(),
      await vault.getAddress(),
      await vault.getAddress(),
      treasury.address, admin.address, guardian.address
    );
    metricsLayer = await (await ethers.getContractFactory("MetricsLayerV02")).deploy(
      await vault.getAddress(), await ledger.getAddress()
    );

    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());
    await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

    // Alice deposits 1000 USDC (mgmtFee = 0 so no fee dilution during setup)
    await usdc.mint(alice.address, D6(1_000));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(1_000));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    aliceShares = await vault.balanceOf(alice.address);

    await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
  });

  // ─── Scenario 1: Zero state ──────────────────────────────────────────────────
  //
  // Deploy a fresh MetricsLayerV02 against an empty vault (no deposits, no locks).
  // All four snapshot() fields must equal zero.
  // Also verifies the div-by-zero guard in lockedRatioBps (totalSupply == 0).

  describe("Scenario 1 — zero state (empty vault, no deposits)", function () {
    let emptyMetrics: MetricsLayerV02;

    beforeEach(async function () {
      const emptyVault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
        await usdc.getAddress(), "Empty Vault", "EVT",
        treasury.address, admin.address
      );
      const emptyLedger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
        await emptyVault.getAddress(), admin.address, guardian.address
      );
      emptyMetrics = await (await ethers.getContractFactory("MetricsLayerV02")).deploy(
        await emptyVault.getAddress(), await emptyLedger.getAddress()
      );
    });

    it("snapshot() is callable and all four fields equal 0", async function () {
      const snap = await emptyMetrics.snapshot();
      expect(snap.totalTVL).to.equal(0n);
      expect(snap.totalLockedShares).to.equal(0n);
      expect(snap.lockedRatioBps).to.equal(0n);   // div-by-zero guard
      expect(snap.totalLocksEver).to.equal(0n);
    });
  });

  // ─── Scenario 2: Deposits, no locks ─────────────────────────────────────────
  //
  // Vault has assets (Alice deposited 1000 USDC in beforeEach) but no locks.
  // totalTVL reflects the deposit; lockedShares and lockedRatioBps stay zero.

  describe("Scenario 2 — deposits present, no locks", function () {
    it("totalTVL > 0, totalLockedShares = 0, lockedRatioBps = 0", async function () {
      const snap = await metricsLayer.snapshot();
      expect(snap.totalTVL).to.equal(D6(1_000));
      expect(snap.totalLockedShares).to.equal(0n);
      expect(snap.lockedRatioBps).to.equal(0n);
    });

    it("totalTVL equals vault.totalAssets()", async function () {
      const snap = await metricsLayer.snapshot();
      expect(snap.totalTVL).to.equal(await vault.totalAssets());
    });

    it("totalTVL updates after a second deposit", async function () {
      const [,,,,,bob] = await ethers.getSigners();
      await usdc.mint(bob.address, D6(500));
      await usdc.connect(bob).approve(await vault.getAddress(), D6(500));
      await vault.connect(admin).addToAllowlist(bob.address);
      await vault.connect(bob).deposit(D6(500), bob.address);

      const snap = await metricsLayer.snapshot();
      expect(snap.totalTVL).to.equal(D6(1_500));
    });
  });

  // ─── Scenario 3: Active locks ────────────────────────────────────────────────
  //
  // After locks are created:
  //   - totalLockedShares must match ledger.totalLockedShares() exactly
  //   - lockedRatioBps must satisfy: lockedShares × 10000 / totalSupply

  describe("Scenario 3 — active locks present", function () {
    it("totalLockedShares matches ledger.totalLockedShares() after lock", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, D30);

      const snap = await metricsLayer.snapshot();
      expect(snap.totalLockedShares).to.equal(aliceShares);
      expect(snap.totalLockedShares).to.equal(await ledger.totalLockedShares());
    });

    it("lockedRatioBps = lockedShares × 10000 / totalSupply (100% lock → 10000)", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, D30);

      const snap        = await metricsLayer.snapshot();
      const totalSupply = await vault.totalSupply();
      const expected    = snap.totalLockedShares * 10_000n / totalSupply;

      expect(snap.lockedRatioBps).to.equal(expected);
      expect(snap.lockedRatioBps).to.equal(10_000n);
    });

    it("lockedRatioBps = lockedShares × 10000 / totalSupply (50% lock → 5000)", async function () {
      await manager.connect(alice).lockWithReward(aliceShares / 2n, D30);

      const snap        = await metricsLayer.snapshot();
      const totalSupply = await vault.totalSupply();
      const expected    = snap.totalLockedShares * 10_000n / totalSupply;

      expect(snap.lockedRatioBps).to.equal(expected);
      expect(snap.lockedRatioBps).to.equal(5_000n);
    });

    it("totalLockedShares drops to 0 after earlyExitWithReturn", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, D30);
      const issued = await manager.issuedRewardTokens(0n);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(0n);

      const snap = await metricsLayer.snapshot();
      expect(snap.totalLockedShares).to.equal(0n);
      expect(snap.lockedRatioBps).to.equal(0n);
    });

    it("totalTVL is unchanged by earlyExit (shares returned to owner, not USDC)", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, D30);
      const issued = await manager.issuedRewardTokens(0n);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(0n);

      const snap = await metricsLayer.snapshot();
      expect(snap.totalTVL).to.equal(D6(1_000));
    });
  });

  // ─── Scenario 4: totalLocksEver semantics ───────────────────────────────────
  //
  // totalLocksEver = ledger.nextLockId() — an append-only counter.
  // It counts all lock positions ever created (including early-exited ones).
  // It never decrements, regardless of exit status.

  describe("Scenario 4 — totalLocksEver semantics (equals nextLockId, append-only)", function () {
    it("equals 0 before any lock is created", async function () {
      const snap = await metricsLayer.snapshot();
      expect(snap.totalLocksEver).to.equal(0n);
      expect(snap.totalLocksEver).to.equal(await ledger.nextLockId());
    });

    it("increments by 1 for each lockWithReward call", async function () {
      await manager.connect(alice).lockWithReward(aliceShares / 3n, D30);
      expect((await metricsLayer.snapshot()).totalLocksEver).to.equal(1n);

      await manager.connect(alice).lockWithReward(aliceShares / 3n, D30);
      expect((await metricsLayer.snapshot()).totalLocksEver).to.equal(2n);
    });

    it("always equals ledger.nextLockId()", async function () {
      await manager.connect(alice).lockWithReward(aliceShares / 2n, D30);
      await manager.connect(alice).lockWithReward(aliceShares / 2n, D30);

      const snap = await metricsLayer.snapshot();
      expect(snap.totalLocksEver).to.equal(await ledger.nextLockId());
    });

    it("does NOT decrement after earlyExitWithReturn (append-only)", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, D30);
      const issued = await manager.issuedRewardTokens(0n);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(0n);

      // nextLockId is 1 — earlyExit does not roll back the counter
      const snap = await metricsLayer.snapshot();
      expect(snap.totalLocksEver).to.equal(1n);
      expect(snap.totalLocksEver).to.equal(await ledger.nextLockId());
    });
  });

  // ─── Cross-scenario consistency ──────────────────────────────────────────────
  //
  // Mixed state: 1 active lock + 1 early-exited lock.
  // All four snapshot() fields must be mutually consistent.

  describe("Cross-scenario — all four fields consistent in mixed state", function () {
    it("snapshot() is internally consistent after 1 active + 1 earlyExited lock", async function () {
      await manager.connect(alice).lockWithReward(aliceShares / 2n, D30);
      await manager.connect(alice).lockWithReward(aliceShares / 2n, D30);

      const issued1 = await manager.issuedRewardTokens(1n);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued1);
      await manager.connect(alice).earlyExitWithReturn(1n);

      const snap        = await metricsLayer.snapshot();
      const totalSupply = await vault.totalSupply();

      // totalLocksEver: 2 positions ever created (append-only)
      expect(snap.totalLocksEver).to.equal(2n);
      // totalLockedShares: only lock #0 remains (half of aliceShares)
      expect(snap.totalLockedShares).to.equal(aliceShares / 2n);
      expect(snap.totalLockedShares).to.equal(await ledger.totalLockedShares());
      // lockedRatioBps: formula holds — locked / total × 10000
      expect(snap.lockedRatioBps).to.equal(snap.totalLockedShares * 10_000n / totalSupply);
      expect(snap.lockedRatioBps).to.equal(5_000n);
      // totalTVL: unchanged (earlyExit returns shares to owner, no USDC leaves vault)
      expect(snap.totalTVL).to.equal(D6(1_000));
    });
  });
});
