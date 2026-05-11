/**
 * AccessStrategyManager.test.ts
 * ==============================
 * Unit / integration tests for AccessStrategyManagerV21.
 *
 * Coverage areas
 * --------------
 *  1. Deployment initial state
 *  2. enter() — via LockManager.enterAccessStrategyManager()
 *  3. exit()  — via LockManager.exitToLock()
 *  4. invest() / divestFromStrategy() / emergencyExitStrategy()
 *  5. accrueFee() — management fee dilution (1 % / year default)
 *  6. redeemFeeUnits() — feeReceiver extracts fee USDC
 *  7. Admin configuration guards
 *
 * Note: enter() and exit() are onlyLockManager, so they are exercised through
 * LockManager.enterAccessStrategyManager() / LockManager.exitToLock() respectively.
 * The NotLockManager guard is tested by calling enter()/exit() directly.
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
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
} from "../fixtures/V21Fixture";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS  = 7n  * DAY;
const THIRTY_DAYS = 30n * DAY;
const UNITS_SCALE = 10n ** 12n;
const RAY         = 10n ** 27n;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deposit USDC → vault → createLock for `user`.
 */
async function openLock(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user:    Awaited<ReturnType<typeof ethers.getSigner>>,
  amountUSDC: bigint,
  duration:   bigint
): Promise<{ lockId: bigint; shares: bigint }> {
  const { vault, usdc, lockManager } = fixture;
  const vaultAddr = await vault.getAddress();
  const lmAddr    = await lockManager.getAddress();

  await usdc.mint(user.address, amountUSDC);
  await usdc.connect(user).approve(vaultAddr, amountUSDC);
  await vault.connect(user).deposit(amountUSDC, user.address);
  const shares = await vault.balanceOf(user.address);
  await vault.connect(user).approve(lmAddr, shares);
  const tx      = await lockManager.connect(user).createLock(shares, duration);
  const receipt = await tx.wait();

  let lockId = 0n;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = lockManager.interface.parseLog(log);
      if (parsed?.name === "LockCreated") { lockId = parsed.args.lockId; break; }
    } catch {}
  }
  return { lockId, shares };
}

/**
 * Open a lock then immediately enter the AccessStrategyManager.
 * Returns lockId and the yrUSDC amount that was locked.
 */
async function enterASM(
  fixture:    Awaited<ReturnType<typeof deployV21Fixture>>,
  user:       Awaited<ReturnType<typeof ethers.getSigner>>,
  amountUSDC: bigint,
  duration:   bigint = THIRTY_DAYS
): Promise<{ lockId: bigint; lockShares: bigint }> {
  const { lockManager, accessStrategyManager } = fixture;
  const asmAddr = await accessStrategyManager.getAddress();
  const { lockId, shares: lockShares } = await openLock(fixture, user, amountUSDC, duration);
  await lockManager.connect(user).enterAccessStrategyManager(lockId, asmAddr);
  return { lockId, lockShares };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AccessStrategyManagerV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("coreVault is set to vault address", async function () {
      const { accessStrategyManager, vault } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.coreVault()).to.equal(await vault.getAddress());
    });

    it("lockManager is wired in fixture", async function () {
      const { accessStrategyManager, lockManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.lockManager()).to.equal(await lockManager.getAddress());
    });

    it("strategy is set to asmMockStrategy", async function () {
      const { accessStrategyManager, asmMockStrategy } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.strategy()).to.equal(await asmMockStrategy.getAddress());
    });

    it("feeReceiver is treasury", async function () {
      const { accessStrategyManager, treasury } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.feeReceiver()).to.equal(await treasury.getAddress());
    });

    it("managementFeeBpsPerYear = 100 (1%)", async function () {
      const { accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.managementFeeBpsPerYear()).to.equal(100n);
    });

    it("admin holds DEFAULT_ADMIN_ROLE and KEEPER_ROLE", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await accessStrategyManager.hasRole(KEEPER_ROLE, admin.address)).to.be.true;
    });

    it("keeper holds KEEPER_ROLE", async function () {
      const { accessStrategyManager, signers: { keeper } } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.hasRole(KEEPER_ROLE, keeper.address)).to.be.true;
    });

    it("totalUnits is 0 before any entry", async function () {
      const { accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.totalUnits()).to.equal(0n);
    });

    it("totalManagedAssets is 0 before any entry", async function () {
      const { accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.totalManagedAssets()).to.equal(0n);
    });

    it("unitPriceRay returns RAY when totalUnits == 0", async function () {
      const { accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.unitPriceRay()).to.equal(RAY);
    });

    it("lastFeeAccrualAt is set at deploy time (> 0)", async function () {
      const { accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await accessStrategyManager.lastFeeAccrualAt()).to.be.gt(0n);
    });
  });

  // ===========================================================================
  // 2. enter() — via LockManager.enterAccessStrategyManager()
  // ===========================================================================

  describe("enter() — via LockManager", function () {
    it("first entry: managerUnits = usdcReceived × UNITS_SCALE", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      const amount = usdc6(100);
      const { lockId } = await enterASM(fixture, user1, amount);

      // usdcReceived ≈ 100e6 at 1:1 PPS; units = 100e6 * 1e12 = 100e18
      const units = await accessStrategyManager.unitsOfLock(lockId);
      expect(units).to.equal(amount * UNITS_SCALE);
    });

    it("totalManagedAssets equals usdcReceived after first entry", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      expect(await accessStrategyManager.totalManagedAssets()).to.equal(usdc6(100));
    });

    it("unitPriceRay = RAY / UNITS_SCALE after first entry at 1:1 vault PPS", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));

      // price = 100e6 * 1e27 / (100e6 * 1e12) = 1e27/1e12 = 1e15
      expect(await accessStrategyManager.unitPriceRay()).to.equal(RAY / UNITS_SCALE);
    });

    it("second entry: proportional units based on pre-deposit AUM", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, usdc, signers: { user1, user2 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));

      // Simulate 10 USDC yield sitting idle in ASM
      const asmAddr = await accessStrategyManager.getAddress();
      await usdc.mint(asmAddr, usdc6(10));
      // totalManagedAssets = 110e6, totalUnits = 100e18

      // user2 enters with 100 USDC
      // preAssets = 110e6, usdcReceived ≈ 100e6
      const { lockId: lockId2 } = await enterASM(fixture, user2, usdc6(100));
      const units2 = await accessStrategyManager.unitsOfLock(lockId2);

      const expectedUnits = usdc6(100) * UNITS_SCALE * usdc6(100) / usdc6(110);
      const delta = expectedUnits / 10_000n; // 0.01% tolerance
      expect(units2).to.be.gte(expectedUnits - delta);
      expect(units2).to.be.lte(expectedUnits + delta);
    });

    it("emits Entered event with correct lockId and yrUSDCAmount", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, lockManager, accessStrategyManager, signers: { user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();
      const asmAddr   = await accessStrategyManager.getAddress();

      const amount = usdc6(100);
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).approve(lmAddr, shares);

      const tx      = await lockManager.connect(user1).createLock(shares, THIRTY_DAYS);
      const receipt = await tx.wait();
      let lockId = 0n;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = lockManager.interface.parseLog(log);
          if (parsed?.name === "LockCreated") { lockId = parsed.args.lockId; break; }
        } catch {}
      }

      await expect(lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr))
        .to.emit(accessStrategyManager, "Entered")
        .withArgs(lockId, shares, anyValue, anyValue);
    });

    it("unitsOfLock correctly maps lockId → minted units", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));
      const units = await accessStrategyManager.unitsOfLock(lockId);
      expect(units).to.be.gt(0n);
      expect(await accessStrategyManager.totalUnits()).to.equal(units);
    });

    it("lockManagedAssets(lockId) returns proportional USDC value", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      const amount = usdc6(100);
      const { lockId } = await enterASM(fixture, user1, amount);

      // Sole entrant owns 100% of AUM
      expect(await accessStrategyManager.lockManagedAssets(lockId)).to.equal(amount);
    });

    it("feeReceiverUnits is 0 right after entry (no time has passed)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      expect(await accessStrategyManager.feeReceiverUnits()).to.equal(0n);
    });

    it("reverts NotLockManager when enter() is called directly", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await expect(
        accessStrategyManager.connect(user1).enter(1n, units18(100))
      ).to.be.revertedWithCustomError(accessStrategyManager, "NotLockManager");
    });
  });

  // ===========================================================================
  // 3. exit() — via LockManager.exitToLock()
  // ===========================================================================

  describe("exit() — via LockManager", function () {
    it("zeroes lock's units and emits Exited", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, lockManager, signers: { user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));
      expect(await accessStrategyManager.unitsOfLock(lockId)).to.be.gt(0n);

      await expect(lockManager.connect(user1).exitToLock(lockId))
        .to.emit(accessStrategyManager, "Exited")
        .withArgs(lockId, anyValue, anyValue, anyValue);

      expect(await accessStrategyManager.unitsOfLock(lockId)).to.equal(0n);
    });

    it("returns yrUSDC to lock (yrUSDCAmount > 0 after exit)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));
      await lockManager.connect(user1).exitToLock(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.yrUSDCAmount).to.be.gt(0n);
    });

    it("totalManagedAssets = 0 after sole holder exits (idle path)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, lockManager, signers: { user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));
      await lockManager.connect(user1).exitToLock(lockId);

      expect(await accessStrategyManager.totalManagedAssets()).to.equal(0n);
      expect(await accessStrategyManager.totalUnits()).to.equal(0n);
    });

    it("auto-pulls from strategy when idle is insufficient", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, lockManager, signers: { admin, user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));

      // Invest all idle → USDC is in strategy
      await accessStrategyManager.connect(admin).invest(usdc6(100));
      expect(await accessStrategyManager.totalManagedAssets()).to.equal(usdc6(100));

      // exitToLock should auto-divest from strategy to cover the payout
      await expect(lockManager.connect(user1).exitToLock(lockId)).to.not.be.reverted;
      expect(await accessStrategyManager.totalUnits()).to.equal(0n);
    });

    it("reverts when strategy cannot cover exit", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, lockManager, asmMockStrategy, signers: { admin, user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100));

      // Invest all idle, then block divest
      await accessStrategyManager.connect(admin).invest(usdc6(100));
      await asmMockStrategy.connect(admin).setFailDivest(true);

      await expect(
        lockManager.connect(user1).exitToLock(lockId)
      ).to.be.reverted;
    });

    it("user can unlock after exitToLock if lock is mature", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, signers: { user1 } } = fixture;

      const { lockId } = await enterASM(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).exitToLock(lockId);

      await expect(lockManager.connect(user1).unlock(lockId)).to.not.be.reverted;
    });

    it("reverts NotLockManager when exit() is called directly", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await expect(
        accessStrategyManager.connect(user1).exit(1n)
      ).to.be.revertedWithCustomError(accessStrategyManager, "NotLockManager");
    });
  });

  // ===========================================================================
  // 4. invest() / divestFromStrategy() / emergencyExitStrategy()
  // ===========================================================================

  describe("invest() / divestFromStrategy() / emergencyExitStrategy()", function () {
    it("invest() moves idle USDC from ASM to strategy", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, asmMockStrategy, usdc, signers: { admin, user1 } } = fixture;
      const asmAddr      = await accessStrategyManager.getAddress();
      const strategyAddr = await asmMockStrategy.getAddress();

      await enterASM(fixture, user1, usdc6(200));
      const totalBefore = await accessStrategyManager.totalManagedAssets();

      await accessStrategyManager.connect(admin).invest(usdc6(100));

      expect(await usdc.balanceOf(asmAddr)).to.equal(usdc6(100));
      expect(await usdc.balanceOf(strategyAddr)).to.equal(usdc6(100));
      // totalManagedAssets unchanged — just moved locations
      expect(await accessStrategyManager.totalManagedAssets()).to.equal(totalBefore);
    });

    it("invest() emits Invested event", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await expect(accessStrategyManager.connect(admin).invest(usdc6(50)))
        .to.emit(accessStrategyManager, "Invested").withArgs(usdc6(50));
    });

    it("invest() reverts ZeroAmount", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).invest(0n))
        .to.be.revertedWithCustomError(accessStrategyManager, "ZeroAmount");
    });

    it("invest() reverts InsufficientIdle when amount > idle", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await expect(accessStrategyManager.connect(admin).invest(usdc6(200)))
        .to.be.revertedWithCustomError(accessStrategyManager, "InsufficientIdle");
    });

    it("invest() reverts NoStrategy when strategy not set", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { signers: { admin } } = fixture;

      // Deploy a bare ASM with no strategy wired
      const usdcAddr  = await fixture.usdc.getAddress();
      const vaultAddr = await fixture.vault.getAddress();
      const asm2 = await ethers
        .getContractFactory("AccessStrategyManagerV21")
        .then(f => f.deploy(usdcAddr, vaultAddr, ethers.ZeroAddress, 100, admin.address));

      // Give it some idle balance to attempt invest
      await fixture.usdc.mint(await asm2.getAddress(), usdc6(100));

      await expect(asm2.connect(admin).invest(usdc6(100)))
        .to.be.revertedWithCustomError(asm2, "NoStrategy");
    });

    it("keeper can call invest()", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { keeper, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await expect(accessStrategyManager.connect(keeper).invest(usdc6(50))).to.not.be.reverted;
    });

    it("user cannot call invest()", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await expect(accessStrategyManager.connect(user1).invest(usdc6(50)))
        .to.be.revertedWithCustomError(accessStrategyManager, "Unauthorized");
    });

    it("divestFromStrategy() pulls USDC back from strategy and emits event", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, asmMockStrategy, usdc, signers: { admin, user1 } } = fixture;
      const asmAddr   = await accessStrategyManager.getAddress();
      const stratAddr = await asmMockStrategy.getAddress();

      await enterASM(fixture, user1, usdc6(100));
      await accessStrategyManager.connect(admin).invest(usdc6(100));

      expect(await usdc.balanceOf(stratAddr)).to.equal(usdc6(100));

      await expect(accessStrategyManager.connect(admin).divestFromStrategy(usdc6(50)))
        .to.emit(accessStrategyManager, "DivestFromStrategy");

      expect(await usdc.balanceOf(asmAddr)).to.equal(usdc6(50));
    });

    it("only admin can call divestFromStrategy()", async function () {
      const { accessStrategyManager, signers: { keeper, user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(keeper).divestFromStrategy(usdc6(1))).to.be.reverted;
      await expect(accessStrategyManager.connect(user1).divestFromStrategy(usdc6(1))).to.be.reverted;
    });

    it("emergencyExitStrategy() empties strategy and emits EmergencyExitStrategy", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, asmMockStrategy, usdc, signers: { admin, user1 } } = fixture;
      const stratAddr = await asmMockStrategy.getAddress();
      const asmAddr   = await accessStrategyManager.getAddress();

      await enterASM(fixture, user1, usdc6(100));
      await accessStrategyManager.connect(admin).invest(usdc6(100));

      expect(await usdc.balanceOf(stratAddr)).to.equal(usdc6(100));

      await expect(accessStrategyManager.connect(admin).emergencyExitStrategy())
        .to.emit(accessStrategyManager, "EmergencyExitStrategy");

      expect(await usdc.balanceOf(stratAddr)).to.equal(0n);
      expect(await usdc.balanceOf(asmAddr)).to.equal(usdc6(100));
    });

    it("only admin can call emergencyExitStrategy()", async function () {
      const { accessStrategyManager, signers: { keeper, user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(keeper).emergencyExitStrategy()).to.be.reverted;
      await expect(accessStrategyManager.connect(user1).emergencyExitStrategy()).to.be.reverted;
    });
  });

  // ===========================================================================
  // 5. accrueFee() — management fee dilution
  // ===========================================================================

  describe("accrueFee() — management fee dilution", function () {
    it("feeReceiverUnits increases after elapsed time", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await advanceTime(30n * DAY);

      await accessStrategyManager.connect(admin).accrueFee();
      expect(await accessStrategyManager.feeReceiverUnits()).to.be.gt(0n);
    });

    it("emits FeeAccrued after elapsed time", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await advanceTime(30n * DAY);

      await expect(accessStrategyManager.connect(admin).accrueFee()).to.emit(accessStrategyManager, "FeeAccrued");
    });

    it("fee rate: ~1%/year (100 bps) — verify after full year", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(10_000));

      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      // feeBps = feeUnits * 10000 / (totalUnits - feeUnits)  should ≈ 100 ± 5
      const feeUnits   = await accessStrategyManager.feeReceiverUnits();
      const totalUnits = await accessStrategyManager.totalUnits();
      const feeBps     = feeUnits * 10_000n / (totalUnits - feeUnits);
      expect(feeBps).to.be.closeTo(100n, 5n);
    });

    it("no fee accrued when totalUnits == 0 (nothing entered)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin } } = fixture;

      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      expect(await accessStrategyManager.feeReceiverUnits()).to.equal(0n);
    });

    it("accrueFee is idempotent within same block (elapsed = 0)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await accessStrategyManager.connect(admin).accrueFee(); // first call
      const feeAfterFirst = await accessStrategyManager.feeReceiverUnits();

      await accessStrategyManager.connect(admin).accrueFee(); // same block — no new time
      expect(await accessStrategyManager.feeReceiverUnits()).to.equal(feeAfterFirst);
    });

    it("fee accrual respects zero-fee setting (0 bps → no fee units)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await accessStrategyManager.connect(admin).setManagementFeeBps(0n);
      await enterASM(fixture, user1, usdc6(100));
      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      expect(await accessStrategyManager.feeReceiverUnits()).to.equal(0n);
    });

    it("keeper can call accrueFee()", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { keeper, user1 } } = fixture;

      await enterASM(fixture, user1, usdc6(100));
      await advanceTime(DAY);
      await expect(accessStrategyManager.connect(keeper).accrueFee()).to.not.be.reverted;
    });

    it("user cannot call accrueFee()", async function () {
      const { accessStrategyManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(user1).accrueFee())
        .to.be.revertedWithCustomError(accessStrategyManager, "Unauthorized");
    });
  });

  // ===========================================================================
  // 6. redeemFeeUnits()
  // ===========================================================================

  describe("redeemFeeUnits()", function () {
    it("feeReceiver can redeem accrued fee units for USDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, usdc, signers: { admin, user1 } } = fixture;

      // Set feeReceiver to admin signer so we can call from a known key
      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await enterASM(fixture, user1, usdc6(10_000));
      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      const feeUnits   = await accessStrategyManager.feeReceiverUnits();
      expect(feeUnits).to.be.gt(0n);

      const usdcBefore = await usdc.balanceOf(admin.address);
      await accessStrategyManager.connect(admin).redeemFeeUnits(feeUnits);
      const usdcAfter  = await usdc.balanceOf(admin.address);

      expect(usdcAfter).to.be.gt(usdcBefore);
      // redeemFeeUnits calls _accrueFee() internally which may mint 1 block's worth of dust
      expect(await accessStrategyManager.feeReceiverUnits()).to.be.lt(feeUnits / 1_000n + 1n);
    });

    it("emits FeeUnitsRedeemed on redemption", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await enterASM(fixture, user1, usdc6(10_000));
      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      const feeUnits = await accessStrategyManager.feeReceiverUnits();
      await expect(accessStrategyManager.connect(admin).redeemFeeUnits(feeUnits))
        .to.emit(accessStrategyManager, "FeeUnitsRedeemed");
    });

    it("reverts Unauthorized for non-feeReceiver caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await enterASM(fixture, user1, usdc6(10_000));
      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      const feeUnits = await accessStrategyManager.feeReceiverUnits();
      await expect(accessStrategyManager.connect(user1).redeemFeeUnits(feeUnits))
        .to.be.revertedWithCustomError(accessStrategyManager, "Unauthorized");
    });

    it("reverts ZeroAmount when units == 0", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin } } = fixture;

      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await expect(accessStrategyManager.connect(admin).redeemFeeUnits(0n))
        .to.be.revertedWithCustomError(accessStrategyManager, "ZeroAmount");
    });

    it("reverts InsufficientFeeUnits when requesting more than accrued", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user1 } } = fixture;

      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await enterASM(fixture, user1, usdc6(1_000));
      await advanceTime(30n * DAY);
      await accessStrategyManager.connect(admin).accrueFee();

      const feeUnits = await accessStrategyManager.feeReceiverUnits();
      await expect(accessStrategyManager.connect(admin).redeemFeeUnits(feeUnits + 1n))
        .to.be.revertedWithCustomError(accessStrategyManager, "InsufficientFeeUnits");
    });

    it("redeemFeeUnits auto-pulls from strategy when idle is insufficient", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, usdc, signers: { admin, user1 } } = fixture;

      await accessStrategyManager.connect(admin).setFeeReceiver(admin.address);
      await enterASM(fixture, user1, usdc6(10_000));

      // Invest 9,000 USDC — leaves a small idle buffer
      await accessStrategyManager.connect(admin).invest(usdc6(9_000));

      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();

      const feeUnits   = await accessStrategyManager.feeReceiverUnits();
      const usdcBefore = await usdc.balanceOf(admin.address);

      // Should auto-divest from strategy to cover the payout
      await expect(accessStrategyManager.connect(admin).redeemFeeUnits(feeUnits)).to.not.be.reverted;
      expect(await usdc.balanceOf(admin.address)).to.be.gt(usdcBefore);
    });
  });

  // ===========================================================================
  // 7. Admin configuration
  // ===========================================================================

  describe("admin configuration", function () {
    it("setStrategy updates and emits StrategySet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, asmMockStrategy, signers: { admin } } = fixture;
      const stratAddr = await asmMockStrategy.getAddress();

      await expect(accessStrategyManager.connect(admin).setStrategy(stratAddr))
        .to.emit(accessStrategyManager, "StrategySet").withArgs(stratAddr);
      expect(await accessStrategyManager.strategy()).to.equal(stratAddr);
    });

    it("setStrategy reverts ZeroAddress", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).setStrategy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(accessStrategyManager, "ZeroAddress");
    });

    it("setStrategy requires DEFAULT_ADMIN_ROLE", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, asmMockStrategy, signers: { keeper, user1 } } = fixture;
      const addr = await asmMockStrategy.getAddress();
      await expect(accessStrategyManager.connect(keeper).setStrategy(addr)).to.be.reverted;
      await expect(accessStrategyManager.connect(user1).setStrategy(addr)).to.be.reverted;
    });

    it("setFeeReceiver updates and emits FeeReceiverSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user2 } } = fixture;

      await expect(accessStrategyManager.connect(admin).setFeeReceiver(user2.address))
        .to.emit(accessStrategyManager, "FeeReceiverSet").withArgs(user2.address);
      expect(await accessStrategyManager.feeReceiver()).to.equal(user2.address);
    });

    it("setFeeReceiver reverts ZeroAddress", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).setFeeReceiver(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(accessStrategyManager, "ZeroAddress");
    });

    it("setFeeReceiver requires DEFAULT_ADMIN_ROLE", async function () {
      const { accessStrategyManager, signers: { keeper, user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(keeper).setFeeReceiver(user1.address)).to.be.reverted;
      await expect(accessStrategyManager.connect(user1).setFeeReceiver(user1.address)).to.be.reverted;
    });

    it("setManagementFeeBps updates and emits ManagementFeeBpsSet", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).setManagementFeeBps(200n))
        .to.emit(accessStrategyManager, "ManagementFeeBpsSet").withArgs(200n);
      expect(await accessStrategyManager.managementFeeBpsPerYear()).to.equal(200n);
    });

    it("setManagementFeeBps reverts FeeBpsTooHigh when > 2000", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).setManagementFeeBps(2_001n))
        .to.be.revertedWithCustomError(accessStrategyManager, "FeeBpsTooHigh");
    });

    it("setManagementFeeBps accepts 0 (disables fee)", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await accessStrategyManager.connect(admin).setManagementFeeBps(0n);
      expect(await accessStrategyManager.managementFeeBpsPerYear()).to.equal(0n);
    });

    it("setManagementFeeBps requires DEFAULT_ADMIN_ROLE", async function () {
      const { accessStrategyManager, signers: { keeper, user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(keeper).setManagementFeeBps(50n)).to.be.reverted;
      await expect(accessStrategyManager.connect(user1).setManagementFeeBps(50n)).to.be.reverted;
    });

    it("setLockManager updates and emits LockManagerSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { accessStrategyManager, signers: { admin, user2 } } = fixture;

      await expect(accessStrategyManager.connect(admin).setLockManager(user2.address))
        .to.emit(accessStrategyManager, "LockManagerSet").withArgs(user2.address);
      expect(await accessStrategyManager.lockManager()).to.equal(user2.address);
    });

    it("setLockManager reverts ZeroAddress", async function () {
      const { accessStrategyManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(admin).setLockManager(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(accessStrategyManager, "ZeroAddress");
    });

    it("setLockManager requires DEFAULT_ADMIN_ROLE", async function () {
      const { accessStrategyManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(accessStrategyManager.connect(user1).setLockManager(user1.address)).to.be.reverted;
    });

    it("constructor reverts FeeBpsTooHigh when feeBps > 2000", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { usdc, vault, lockManager, signers: { admin } } = fixture;
      const usdcAddr  = await usdc.getAddress();
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();

      const factory = await ethers.getContractFactory("AccessStrategyManagerV21");
      await expect(
        factory.deploy(usdcAddr, vaultAddr, lmAddr, 2_001, admin.address)
      ).to.be.revertedWithCustomError(factory, "FeeBpsTooHigh");
    });
  });

});
