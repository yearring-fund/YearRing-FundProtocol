/**
 * LockManager.test.ts
 * ====================
 * Unit / integration tests for LockManagerV21.
 *
 * Coverage areas
 * --------------
 *  1. Deployment initial state
 *  2. createLock() — base points, tier multiplier, guards
 *  3. splitLock()  — proportional split, guards
 *  4. unlock()     — maturity check, yrUSDC returned, status
 *  5. earlyExit()  — forfeit all rewards, can't exit if matured
 *  6. enterAccessStrategyManager() — state transition, eligibility gate
 *  7. exitToLock() — return to YR_USDC state
 *  8. claimRebateOf() — REBATE_MANAGER_ROLE, auto-checkpoint
 *  9. checkpointBonusPoints() / checkpointRebate() — public callers
 * 10. PointsLedger integration — credit on create, debit on earlyExit
 * 11. getUserLockIds() pagination
 * 12. Admin configuration guards
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployV21Fixture,
  usdc6,
  units18,
  DAY,
  YEAR,
  advanceTime,
  DEFAULT_ADMIN_ROLE,
  KEEPER_ROLE,
  REBATE_MANAGER_ROLE,
} from "../fixtures/V21Fixture";

// ─── Tier-duration constants ───────────────────────────────────────────────────
const SEVEN_DAYS   = 7n   * DAY; // minimum / Trial
const THIRTY_DAYS  = 30n  * DAY; // Bronze
const NINETY_DAYS  = 90n  * DAY; // Silver
const HALF_YEAR    = 180n * DAY; // Gold

// Multiplier bps matching contract
const TRIAL_BPS  =  5_000n;
const BRONZE_BPS = 10_000n;
const SILVER_BPS = 13_000n;
const GOLD_BPS   = 18_000n;
const BPS_DENOM  = 10_000n;
const POINTS_SCALE = 10n ** 12n;

// LockAssetType enum values (ILockManagerV21: None=0, YR_USDC=1, MANAGER_UNITS=2)
const ASSET_YR_USDC       = 1n;
const ASSET_MANAGER_UNITS = 2n;

// LockStatus enum values (None=0, Active=1, Exited=2, EarlyExited=3)
const STATUS_ACTIVE      = 1n;
const STATUS_EXITED      = 2n;
const STATUS_EARLY_EXITED = 3n;

// LockTransition enum values (None=0, EnteringManager=1, ExitingManager=2)
const TRANSITION_NONE = 0n;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Deposit `amountUSDC` to vault for `user`, approve LockManager, and create a lock.
 * Returns { lockId, shares } where `shares` is the yrUSDC amount locked.
 */
async function openLock(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user: Awaited<ReturnType<typeof ethers.getSigner>>,
  amountUSDC: bigint,
  duration: bigint
): Promise<{ lockId: bigint; shares: bigint }> {
  const { vault, usdc, lockManager } = fixture;
  const vaultAddr = await vault.getAddress();
  const lmAddr    = await lockManager.getAddress();

  // Deposit to get yrUSDC
  await usdc.mint(user.address, amountUSDC);
  await usdc.connect(user).approve(vaultAddr, amountUSDC);
  await vault.connect(user).deposit(amountUSDC, user.address);

  const shares = await vault.balanceOf(user.address);

  // Approve LockManager and create lock
  await vault.connect(user).approve(lmAddr, shares);
  const tx      = await lockManager.connect(user).createLock(shares, duration);
  const receipt = await tx.wait();

  // Extract lockId from LockCreated event
  let lockId = 0n;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = lockManager.interface.parseLog(log);
      if (parsed?.name === "LockCreated") { lockId = parsed.args.lockId; break; }
    } catch {}
  }

  return { lockId, shares };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("LockManagerV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("yrUSDC points to CoreVault address", async function () {
      const { lockManager, vault } = await loadFixture(deployV21Fixture);
      expect(await lockManager.yrUSDC()).to.equal(await vault.getAddress());
    });

    it("coreVault is set to CoreVault address", async function () {
      const { lockManager, vault } = await loadFixture(deployV21Fixture);
      expect(await lockManager.coreVault()).to.equal(await vault.getAddress());
    });

    it("pointsLedger is set in fixture", async function () {
      const { lockManager, pointsLedger } = await loadFixture(deployV21Fixture);
      expect(await lockManager.pointsLedger()).to.equal(await pointsLedger.getAddress());
    });

    it("eligibilityModule is address(0) by default (not connected)", async function () {
      const { lockManager } = await loadFixture(deployV21Fixture);
      expect(await lockManager.eligibilityModule()).to.equal(ethers.ZeroAddress);
    });

    it("admin holds DEFAULT_ADMIN_ROLE and KEEPER_ROLE", async function () {
      const { lockManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await lockManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await lockManager.hasRole(KEEPER_ROLE, admin.address)).to.be.true;
    });

    it("keeper holds KEEPER_ROLE", async function () {
      const { lockManager, signers: { keeper } } = await loadFixture(deployV21Fixture);
      expect(await lockManager.hasRole(KEEPER_ROLE, keeper.address)).to.be.true;
    });

    it("rebateManager holds REBATE_MANAGER_ROLE", async function () {
      const { lockManager, rebateManager } = await loadFixture(deployV21Fixture);
      expect(await lockManager.hasRole(REBATE_MANAGER_ROLE, await rebateManager.getAddress())).to.be.true;
    });

    it("coreSMFeeBpsPerYear defaults to 50", async function () {
      const { lockManager } = await loadFixture(deployV21Fixture);
      expect(await lockManager.coreSMFeeBpsPerYear()).to.equal(50n);
    });

    it("MIN_COMMITTED_DURATION = 7 days, MIN_LOCK_ASSETS_USDC = 1e6", async function () {
      const { lockManager } = await loadFixture(deployV21Fixture);
      expect(await lockManager.MIN_COMMITTED_DURATION()).to.equal(SEVEN_DAYS);
      expect(await lockManager.MIN_LOCK_ASSETS_USDC()).to.equal(usdc6(1));
    });
  });

  // ===========================================================================
  // 2. createLock()
  // ===========================================================================

  describe("createLock()", function () {
    it("creates lock with correct fields and status Active", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const lock = await lockManager.getLock(lockId);

      expect(lock.owner).to.equal(user1.address);
      expect(lock.yrUSDCAmount).to.equal(shares);
      expect(lock.committedDuration).to.equal(THIRTY_DAYS);
      expect(lock.status).to.equal(STATUS_ACTIVE);
      expect(lock.assetType).to.equal(ASSET_YR_USDC);
      expect(lock.transition).to.equal(TRANSITION_NONE);
    });

    it("emits LockCreated with correct args", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, lockManager, signers: { user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();

      const amount = usdc6(100);
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).approve(lmAddr, shares);

      await expect(
        lockManager.connect(user1).createLock(shares, THIRTY_DAYS)
      ).to.emit(lockManager, "LockCreated")
        .withArgs(anyValue, user1.address, shares, anyValue, THIRTY_DAYS, anyValue);
    });

    it("increments nextLockId after each lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1, user2 } } = fixture;

      const idBefore = await lockManager.nextLockId();
      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await openLock(fixture, user2, usdc6(100), THIRTY_DAYS);
      expect(await lockManager.nextLockId()).to.equal(idBefore + 2n);
    });

    it("increments totalLockedYrUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const before = await lockManager.totalLockedYrUSDC();
      const { shares } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      expect(await lockManager.totalLockedYrUSDC()).to.equal(before + shares);
    });

    it("Trial (7d) base points: principal × POINTS_SCALE × 0.5", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, vault, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      const lock = await lockManager.getLock(lockId);
      const principalUSDC = lock.principalAssetsUSDC;
      const expected      = principalUSDC * POINTS_SCALE * TRIAL_BPS / BPS_DENOM;

      expect(lock.basePointsIssued).to.equal(expected);
    });

    it("Bronze (30d) base points: principal × POINTS_SCALE × 1.0", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const lock        = await lockManager.getLock(lockId);
      const expected    = lock.principalAssetsUSDC * POINTS_SCALE * BRONZE_BPS / BPS_DENOM;

      expect(lock.basePointsIssued).to.equal(expected);
    });

    it("Silver (90d) base points: principal × POINTS_SCALE × 1.3", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), NINETY_DAYS);
      const lock        = await lockManager.getLock(lockId);
      const expected    = lock.principalAssetsUSDC * POINTS_SCALE * SILVER_BPS / BPS_DENOM;

      expect(lock.basePointsIssued).to.equal(expected);
    });

    it("Gold (180d) base points: principal × POINTS_SCALE × 1.8", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), HALF_YEAR);
      const lock        = await lockManager.getLock(lockId);
      const expected    = lock.principalAssetsUSDC * POINTS_SCALE * GOLD_BPS / BPS_DENOM;

      expect(lock.basePointsIssued).to.equal(expected);
    });

    it("credits base points to PointsLedger on create", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, pointsLedger, signers: { user1 } } = fixture;

      const balBefore = await pointsLedger.balanceOf(user1.address);
      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const lock        = await lockManager.getLock(lockId);

      expect(await pointsLedger.balanceOf(user1.address))
        .to.equal(balBefore + lock.basePointsIssued);
    });

    it("reverts ZeroAmount when yrUSDCAmount == 0", async function () {
      const { lockManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        lockManager.connect(user1).createLock(0n, THIRTY_DAYS)
      ).to.be.revertedWithCustomError(lockManager, "ZeroAmount");
    });

    it("reverts DurationTooShort when < 7 days", async function () {
      const { lockManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        lockManager.connect(user1).createLock(units18(1), SEVEN_DAYS - 1n)
      ).to.be.revertedWithCustomError(lockManager, "DurationTooShort");
    });

    it("reverts LockAmountTooSmall when principal < 1 USDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, lockManager, signers: { user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();

      // Deposit a tiny amount (below 1 USDC threshold)
      const tiny = usdc6(1) / 2n; // 0.5 USDC
      await usdc.mint(user1.address, tiny);
      await usdc.connect(user1).approve(vaultAddr, tiny);
      await vault.connect(user1).deposit(tiny, user1.address);
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).approve(lmAddr, shares);

      await expect(
        lockManager.connect(user1).createLock(shares, THIRTY_DAYS)
      ).to.be.revertedWithCustomError(lockManager, "LockAmountTooSmall");
    });

    it("reverts NewLocksPaused when paused", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, lockManager, signers: { admin, user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();

      await lockManager.connect(admin).setNewLocksPaused(true);

      const amount = usdc6(100);
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).approve(lmAddr, shares);

      await expect(
        lockManager.connect(user1).createLock(shares, THIRTY_DAYS)
      ).to.be.revertedWithCustomError(lockManager, "NewLocksPaused");
    });
  });

  // ===========================================================================
  // 3. splitLock()
  // ===========================================================================

  describe("splitLock()", function () {
    it("creates a new lock with split yrUSDC and reduces original", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), THIRTY_DAYS);
      const splitAmount = shares / 2n;

      const tx      = await lockManager.connect(user1).splitLock(lockId, splitAmount);
      const receipt = await tx.wait();

      let newLockId = 0n;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = lockManager.interface.parseLog(log);
          if (parsed?.name === "LockSplit") { newLockId = parsed.args.newLockId; break; }
        } catch {}
      }

      const origLock = await lockManager.getLock(lockId);
      const newLock  = await lockManager.getLock(newLockId);

      expect(origLock.yrUSDCAmount).to.equal(shares - splitAmount);
      expect(newLock.yrUSDCAmount).to.equal(splitAmount);
      expect(newLock.owner).to.equal(user1.address);
    });

    it("inherits minUnlockTime and committedDuration from original", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), NINETY_DAYS);
      const tx      = await lockManager.connect(user1).splitLock(lockId, shares / 2n);
      const receipt = await tx.wait();

      let newLockId = 0n;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = lockManager.interface.parseLog(log);
          if (parsed?.name === "LockSplit") { newLockId = parsed.args.newLockId; break; }
        } catch {}
      }

      const origLock = await lockManager.getLock(lockId);
      const newLock  = await lockManager.getLock(newLockId);

      expect(newLock.minUnlockTime).to.equal(origLock.minUnlockTime);
      expect(newLock.committedDuration).to.equal(NINETY_DAYS);
    });

    it("emits LockSplit event", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), THIRTY_DAYS);

      await expect(
        lockManager.connect(user1).splitLock(lockId, shares / 2n)
      ).to.emit(lockManager, "LockSplit");
    });

    it("reverts NotOwner for wrong caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1, user2 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), THIRTY_DAYS);

      await expect(
        lockManager.connect(user2).splitLock(lockId, shares / 2n)
      ).to.be.revertedWithCustomError(lockManager, "NotOwner");
    });

    it("reverts SplitAmountInvalid when splitYrUSDC == 0", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(200), THIRTY_DAYS);
      await expect(
        lockManager.connect(user1).splitLock(lockId, 0n)
      ).to.be.revertedWithCustomError(lockManager, "SplitAmountInvalid");
    });

    it("reverts SplitAmountInvalid when splitYrUSDC >= original amount", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), THIRTY_DAYS);
      await expect(
        lockManager.connect(user1).splitLock(lockId, shares)
      ).to.be.revertedWithCustomError(lockManager, "SplitAmountInvalid");
    });

    it("reverts LockNotActive for exited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(200), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);

      await expect(
        lockManager.connect(user1).splitLock(lockId, shares / 2n)
      ).to.be.revertedWithCustomError(lockManager, "LockNotActive");
    });
  });

  // ===========================================================================
  // 4. unlock()
  // ===========================================================================

  describe("unlock()", function () {
    it("returns yrUSDC to owner and sets status to Exited", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, vault, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);

      const balBefore = await vault.balanceOf(user1.address);
      await lockManager.connect(user1).unlock(lockId);
      const balAfter  = await vault.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(shares);

      const lock = await lockManager.getLock(lockId);
      expect(lock.status).to.equal(STATUS_EXITED);
      expect(lock.yrUSDCAmount).to.equal(0n);
    });

    it("emits LockUnlocked", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);

      await expect(lockManager.connect(user1).unlock(lockId))
        .to.emit(lockManager, "LockUnlocked").withArgs(lockId, user1.address, anyValue);
    });

    it("decrements totalLockedYrUSDC on unlock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      const before = await lockManager.totalLockedYrUSDC();
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);

      expect(await lockManager.totalLockedYrUSDC()).to.equal(before - shares);
    });

    it("reverts LockNotMatured before minUnlockTime", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user1).unlock(lockId)
      ).to.be.revertedWithCustomError(lockManager, "LockNotMatured");
    });

    it("reverts NotOwner for wrong caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1, user2 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);

      await expect(
        lockManager.connect(user2).unlock(lockId)
      ).to.be.revertedWithCustomError(lockManager, "NotOwner");
    });

    it("reverts LockNotActive on double unlock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);

      await expect(
        lockManager.connect(user1).unlock(lockId)
      ).to.be.revertedWithCustomError(lockManager, "LockNotActive");
    });

    it("checkpoints bonus points and rebate before unlock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);
      await advanceTime(THIRTY_DAYS + 1n);

      await lockManager.connect(user1).unlock(lockId);
      const lock = await lockManager.getLock(lockId);

      // After 30+ days, bonus points should have accrued (Bronze tier bonus > 0)
      expect(lock.bonusPointsIssued).to.be.gt(0n);
    });
  });

  // ===========================================================================
  // 5. earlyExit()
  // ===========================================================================

  describe("earlyExit()", function () {
    it("returns yrUSDC and sets status to EarlyExited (3)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, vault, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const balBefore = await vault.balanceOf(user1.address);
      await lockManager.connect(user1).earlyExit(lockId);
      const balAfter  = await vault.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(shares);

      const lock = await lockManager.getLock(lockId);
      expect(lock.status).to.equal(STATUS_EARLY_EXITED);
    });

    it("forfeits all base and bonus points (debits PointsLedger)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, pointsLedger, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await advanceTime(DAY * 5n); // accrue some bonus points

      const ledgerBefore = await pointsLedger.balanceOf(user1.address);
      await lockManager.connect(user1).earlyExit(lockId);
      const ledgerAfter  = await pointsLedger.balanceOf(user1.address);

      // All points should be forfeited → ledger balance drops to 0
      expect(ledgerAfter).to.equal(0n);
      expect(ledgerAfter).to.be.lt(ledgerBefore);
    });

    it("emits LockEarlyExited with pointsForfeited", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(lockManager.connect(user1).earlyExit(lockId))
        .to.emit(lockManager, "LockEarlyExited")
        .withArgs(lockId, user1.address, shares, anyValue);
    });

    it("zeroes claimableRebateUSDC on earlyExit", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      // Use NINETY_DAYS so advancing 40 days does NOT mature the lock
      const { lockId } = await openLock(fixture, user1, usdc6(1000), NINETY_DAYS);
      await advanceTime(DAY * 40n); // accrue some rebate (Bronze tier, lock not yet mature)

      await lockManager.connect(user1).checkpointRebate(lockId);
      await lockManager.connect(user1).earlyExit(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.equal(0n);
    });

    it("reverts LockAlreadyMatured when minUnlockTime has passed", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);

      await expect(
        lockManager.connect(user1).earlyExit(lockId)
      ).to.be.revertedWithCustomError(lockManager, "LockAlreadyMatured");
    });

    it("reverts NotOwner for wrong caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1, user2 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user2).earlyExit(lockId)
      ).to.be.revertedWithCustomError(lockManager, "NotOwner");
    });

    it("reverts LockNotActive if already exited", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).earlyExit(lockId);

      await expect(
        lockManager.connect(user1).earlyExit(lockId)
      ).to.be.revertedWithCustomError(lockManager, "LockNotActive");
    });
  });

  // ===========================================================================
  // 6. enterAccessStrategyManager()
  // ===========================================================================

  describe("enterAccessStrategyManager()", function () {
    it("transitions lock to MANAGER_UNITS state", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const asmAddr   = await accessStrategyManager.getAddress();

      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);

      const lock = await lockManager.getLock(lockId);
      expect(lock.assetType).to.equal(ASSET_MANAGER_UNITS);
      expect(lock.manager).to.equal(asmAddr);
      expect(lock.yrUSDCAmount).to.equal(0n);
      expect(lock.managerUnits).to.be.gt(0n);
    });

    it("emits LockEnteredManager", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress())
      ).to.emit(lockManager, "LockEnteredManager");
    });

    it("decrements totalLockedYrUSDC when entering manager", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId, shares } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const before = await lockManager.totalLockedYrUSDC();

      await lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress());

      expect(await lockManager.totalLockedYrUSDC()).to.equal(before - shares);
    });

    it("with eligibility module: reverts EligibilityCheckFailed for Trial lock", async function () {
      // Connect eligibility module, which blocks Trial (< 30 day) locks
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, eligibilityModule, signers: { admin, user1 } } = fixture;

      // Connect eligibility module
      await lockManager.connect(admin).setEligibilityModule(await eligibilityModule.getAddress());

      // Trial lock (7 days) cannot enter HT
      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);

      await expect(
        lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress())
      ).to.be.revertedWithCustomError(lockManager, "EligibilityCheckFailed");
    });

    it("with eligibility module: allows Bronze+ locks (≥ 30 day actual age)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, eligibilityModule, signers: { admin, user1 } } = fixture;

      const asmAddr = await accessStrategyManager.getAddress();
      await lockManager.connect(admin).setEligibilityModule(await eligibilityModule.getAddress());

      // Enable the ASM in the eligibility module (default is disabled → MANAGER_DISABLED)
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);

      // NINETY_DAYS commitment; advance 30 days + 1s so actual age = Bronze+ but lock NOT yet matured
      const { lockId } = await openLock(fixture, user1, usdc6(100), NINETY_DAYS);
      await advanceTime(THIRTY_DAYS + 1n);

      await expect(
        lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr)
      ).to.not.be.reverted;
    });

    it("reverts NotOwner for wrong caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1, user2 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user2).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress())
      ).to.be.revertedWithCustomError(lockManager, "NotOwner");
    });

    it("reverts MustExitHTFirst if already in manager", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      const asmAddr   = await accessStrategyManager.getAddress();

      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);

      await expect(
        lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr)
      ).to.be.revertedWithCustomError(lockManager, "MustExitHTFirst");
    });
  });

  // ===========================================================================
  // 7. exitToLock()
  // ===========================================================================

  describe("exitToLock()", function () {
    it("restores lock to YR_USDC state and returns yrUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, vault, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress());

      await lockManager.connect(user1).exitToLock(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.assetType).to.equal(ASSET_YR_USDC);
      expect(lock.manager).to.equal(ethers.ZeroAddress);
      expect(lock.managerUnits).to.equal(0n);
      expect(lock.yrUSDCAmount).to.be.gt(0n);
    });

    it("emits LockExitedManager", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress());

      await expect(lockManager.connect(user1).exitToLock(lockId))
        .to.emit(lockManager, "LockExitedManager");
    });

    it("totalLockedYrUSDC increases back on exitToLock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress());

      const before = await lockManager.totalLockedYrUSDC();
      await lockManager.connect(user1).exitToLock(lockId);

      expect(await lockManager.totalLockedYrUSDC()).to.be.gt(before);
    });

    it("reverts NotInManagerState when lock is YR_USDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user1).exitToLock(lockId)
      ).to.be.revertedWithCustomError(lockManager, "NotInManagerState");
    });

    it("can unlock (mature) after exitToLock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, await accessStrategyManager.getAddress());
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).exitToLock(lockId);

      await expect(lockManager.connect(user1).unlock(lockId)).to.not.be.reverted;
    });
  });

  // ===========================================================================
  // 8. claimRebateOf()
  // ===========================================================================

  describe("claimRebateOf()", function () {
    it("REBATE_MANAGER_ROLE can claim and zeroes claimableRebateUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, rebateManager, signers: { admin, user1 } } = fixture;
      const lmAddr = await lockManager.getAddress();

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);

      // Advance past Bronze tier so rebate starts accruing
      await advanceTime(THIRTY_DAYS + DAY);
      await lockManager.connect(user1).checkpointRebate(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);

      // Use rebateManager signer via impersonation — or use the rebateManager contract role
      // rebateManager contract has REBATE_MANAGER_ROLE; we need to call as an address that has it
      // The rebateManager address itself has the role — let's grant the admin the role too for this test
      await lockManager.connect(admin).grantRole(REBATE_MANAGER_ROLE, admin.address);

      const claimed = await lockManager.connect(admin).claimRebateOf.staticCall(lockId);
      expect(claimed).to.be.gt(0n);

      await lockManager.connect(admin).claimRebateOf(lockId);
      expect((await lockManager.getLock(lockId)).claimableRebateUSDC).to.equal(0n);
    });

    it("reverts Unauthorized for non-REBATE_MANAGER_ROLE caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(user1).claimRebateOf(lockId)
      ).to.be.revertedWithCustomError(lockManager, "Unauthorized");
    });

    it("reverts RebateNotClaimable for EarlyExited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { admin, user1 } } = fixture;

      await lockManager.connect(admin).grantRole(REBATE_MANAGER_ROLE, admin.address);
      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).earlyExit(lockId);

      await expect(
        lockManager.connect(admin).claimRebateOf(lockId)
      ).to.be.revertedWithCustomError(lockManager, "RebateNotClaimable");
    });

    it("reverts NothingToClaim for Trial lock with no rebate yet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { admin, user1 } } = fixture;

      await lockManager.connect(admin).grantRole(REBATE_MANAGER_ROLE, admin.address);

      // Lock in Trial period — no rebate in first 30 days
      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      await expect(
        lockManager.connect(admin).claimRebateOf(lockId)
      ).to.be.revertedWithCustomError(lockManager, "NothingToClaim");
    });

    it("Exited lock (normal unlock) remains claimable", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { admin, user1 } } = fixture;

      await lockManager.connect(admin).grantRole(REBATE_MANAGER_ROLE, admin.address);
      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);

      // Advance past Trial → Bronze, accrue rebate, then unlock
      await advanceTime(THIRTY_DAYS + DAY);
      await lockManager.connect(user1).unlock(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);

      // Should be claimable after exit
      await expect(
        lockManager.connect(admin).claimRebateOf(lockId)
      ).to.not.be.reverted;
    });
  });

  // ===========================================================================
  // 9. Bonus point and rebate checkpoints
  // ===========================================================================

  describe("checkpointBonusPoints() / checkpointRebate()", function () {
    it("bonusPointsIssued increases after time passes in Bronze tier", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);

      // Advance into Bronze tier (> 30 days actual age)
      await advanceTime(THIRTY_DAYS + DAY);
      await lockManager.connect(user1).checkpointBonusPoints(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.bonusPointsIssued).to.be.gt(0n);
    });

    it("claimableRebateUSDC is 0 during Trial (< 30 days)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);
      await advanceTime(DAY * 10n); // still in Trial
      await lockManager.connect(user1).checkpointRebate(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.equal(0n);
    });

    it("claimableRebateUSDC accrues after entering Bronze tier (30+ days)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);
      await advanceTime(THIRTY_DAYS + DAY * 10n); // Bronze tier
      await lockManager.connect(user1).checkpointRebate(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);
    });

    it("checkpointBonusPoints reverts LockNotActive for exited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);

      await expect(
        lockManager.connect(user1).checkpointBonusPoints(lockId)
      ).to.be.revertedWithCustomError(lockManager, "LockNotActive");
    });

    it("credits bonus points to PointsLedger on checkpoint", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, pointsLedger, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1000), THIRTY_DAYS);
      const balBefore = await pointsLedger.balanceOf(user1.address);

      await advanceTime(THIRTY_DAYS + DAY);
      await lockManager.connect(user1).checkpointBonusPoints(lockId);

      expect(await pointsLedger.balanceOf(user1.address)).to.be.gt(balBefore);
    });
  });

  // ===========================================================================
  // 10. getUserLockIds() pagination
  // ===========================================================================

  describe("getUserLockIds()", function () {
    it("returns all lock IDs for a user", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const [ids, total] = await lockManager.getUserLockIds(user1.address, 0n, 100n);
      expect(total).to.equal(2n);
      expect(ids.length).to.equal(2);
    });

    it("pagination offset works correctly", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const [firstTwo] = await lockManager.getUserLockIds(user1.address, 0n, 2n);
      const [lastOne]  = await lockManager.getUserLockIds(user1.address, 2n, 1n);

      expect(firstTwo.length).to.equal(2);
      expect(lastOne.length).to.equal(1);
    });

    it("returns empty array when offset >= total", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const [ids, total] = await lockManager.getUserLockIds(user1.address, 5n, 10n);
      expect(ids.length).to.equal(0);
      expect(total).to.equal(1n);
    });
  });

  // ===========================================================================
  // 11. Admin configuration
  // ===========================================================================

  describe("admin configuration", function () {
    it("setEligibilityModule updates and emits EligibilityModuleSet", async function () {
      const { lockManager, eligibilityModule, signers: { admin } } =
        await loadFixture(deployV21Fixture);
      const addr = await eligibilityModule.getAddress();

      await expect(lockManager.connect(admin).setEligibilityModule(addr))
        .to.emit(lockManager, "EligibilityModuleSet").withArgs(addr);
      expect(await lockManager.eligibilityModule()).to.equal(addr);
    });

    it("setEligibilityModule requires DEFAULT_ADMIN_ROLE", async function () {
      const { lockManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        lockManager.connect(user1).setEligibilityModule(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it("setCoreSMFeeBpsPerYear updates rate and emits event", async function () {
      const { lockManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(lockManager.connect(admin).setCoreSMFeeBpsPerYear(100n))
        .to.emit(lockManager, "CoreSMFeeBpsPerYearSet").withArgs(100n);
      expect(await lockManager.coreSMFeeBpsPerYear()).to.equal(100n);
    });

    it("setCoreSMFeeBpsPerYear reverts FeeBpsTooHigh when > BPS_DENOMINATOR", async function () {
      const { lockManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(
        lockManager.connect(admin).setCoreSMFeeBpsPerYear(10_001n)
      ).to.be.revertedWithCustomError(lockManager, "FeeBpsTooHigh");
    });

    it("setNewLocksPaused: admin can pause and unpause", async function () {
      const { lockManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(lockManager.connect(admin).setNewLocksPaused(true))
        .to.emit(lockManager, "NewLocksPausedSet").withArgs(true);
      expect(await lockManager.newLocksPaused()).to.be.true;

      await lockManager.connect(admin).setNewLocksPaused(false);
      expect(await lockManager.newLocksPaused()).to.be.false;
    });

    it("setNewLocksPaused: keeper can pause", async function () {
      const { lockManager, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(lockManager.connect(keeper).setNewLocksPaused(true)).to.not.be.reverted;
    });

    it("setNewLocksPaused: user cannot pause", async function () {
      const { lockManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        lockManager.connect(user1).setNewLocksPaused(true)
      ).to.be.revertedWithCustomError(lockManager, "Unauthorized");
    });

    it("setPointsLedger updates and emits PointsLedgerSet", async function () {
      const { lockManager, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      await expect(lockManager.connect(admin).setPointsLedger(user1.address))
        .to.emit(lockManager, "PointsLedgerSet").withArgs(user1.address);
      expect(await lockManager.pointsLedger()).to.equal(user1.address);
    });
  });

});
