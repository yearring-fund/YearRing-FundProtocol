/**
 * EligibilityModuleV21.test.ts
 * ============================
 * Unit tests for the EligibilityModuleV21 eligibility guard.
 *
 * Test strategy
 * -------------
 * - Uses V21Fixture (eligibilityModule pre-deployed, wired to lockManager + pointsLedger).
 * - lockManager.eligibilityModule is NOT set in fixture (intentional) — tests that need
 *   LM integration attach / detach the module manually.
 * - canEnterManager is a view that returns (bool ok, bytes32 reason) — never reverts.
 * - AccessStrategyManager is used as the "Access Strategy Manager under test" unless stated otherwise.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployV21Fixture,
  usdc6,
  units18,
  advanceTime,
  DEFAULT_ADMIN_ROLE,
  POINTS_MINTER_ROLE,
  DAY,
} from "../fixtures/V21Fixture";

// ─── Duration constants ───────────────────────────────────────────────────────

const SEVEN_DAYS   =  7n * DAY;
const THIRTY_DAYS  = 30n * DAY;
const NINETY_DAYS  = 90n * DAY;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deposit USDC → yrUSDC → createLock for `user`.
 * Returns { lockId, yrBal } — yrBal is the amount locked.
 */
async function openLock(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user:    Awaited<ReturnType<typeof ethers.getSigner>>,
  amountUSDC: bigint,
  duration:   bigint,
): Promise<{ lockId: bigint; yrBal: bigint }> {
  const { usdc, vault, lockManager } = fixture;
  const vaultAddr       = await vault.getAddress();
  const lockManagerAddr = await lockManager.getAddress();

  await usdc.mint(user.address, amountUSDC);
  await usdc.connect(user).approve(vaultAddr, amountUSDC);
  await vault.connect(user).deposit(amountUSDC, user.address);

  const yrBal = await vault.balanceOf(user.address);
  await vault.connect(user).approve(lockManagerAddr, yrBal);

  const lockId = await lockManager.connect(user).createLock.staticCall(yrBal, duration);
  await lockManager.connect(user).createLock(yrBal, duration);

  return { lockId, yrBal };
}

/**
 * Open a NINETY_DAYS lock and advance 30 days + 1s to reach Bronze age.
 */
async function openBronzeLock(
  fixture:    Awaited<ReturnType<typeof deployV21Fixture>>,
  user:       Awaited<ReturnType<typeof ethers.getSigner>>,
  amountUSDC: bigint = usdc6(1_000),
): Promise<{ lockId: bigint; yrBal: bigint }> {
  const result = await openLock(fixture, user, amountUSDC, NINETY_DAYS);
  await advanceTime(THIRTY_DAYS + 1n);
  return result;
}

// ===========================================================================
// Main test suite
// ===========================================================================

describe("EligibilityModuleV21", function () {

  // =========================================================================
  // 1. Deployment
  // =========================================================================

  describe("deployment", function () {
    it("stores lockManager address", async function () {
      const { eligibilityModule, lockManager } = await loadFixture(deployV21Fixture);
      expect(await eligibilityModule.lockManager())
        .to.equal(await lockManager.getAddress());
    });

    it("stores pointsLedger address", async function () {
      const { eligibilityModule, pointsLedger } = await loadFixture(deployV21Fixture);
      expect(await eligibilityModule.pointsLedger())
        .to.equal(await pointsLedger.getAddress());
    });

    it("yrfpToken defaults to address(0)", async function () {
      const { eligibilityModule } = await loadFixture(deployV21Fixture);
      expect(await eligibilityModule.yrfpToken()).to.equal(ethers.ZeroAddress);
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
      const { eligibilityModule, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await eligibilityModule.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("reverts when admin_ is address(0)", async function () {
      const { lockManager, pointsLedger } = await loadFixture(deployV21Fixture);
      const factory = await ethers.getContractFactory("EligibilityModuleV21");
      await expect(
        factory.deploy(
          await lockManager.getAddress(),
          await pointsLedger.getAddress(),
          ethers.ZeroAddress,
        )
      ).to.be.reverted;
    });
  });

  // =========================================================================
  // 2. canEnterManager — lock not found / wrong owner
  // =========================================================================

  describe("canEnterManager — lock validity", function () {

    it("returns LOCK_NOT_FOUND when eligibilityModule.lockManager == address(0)", async function () {
      const { signers: { admin, user1 },  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const asmAddr = await accessStrategyManager.getAddress();

      // Deploy a fresh module with zero lockManager
      const emptyEM = await ethers.getContractFactory("EligibilityModuleV21")
        .then(f => f.deploy(ethers.ZeroAddress, ethers.ZeroAddress, admin.address));

      const [ok, reason] = await emptyEM.canEnterManager(
        user1.address, 1n, asmAddr, usdc6(100)
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await emptyEM.LOCK_NOT_FOUND());
    });

    it("returns LOCK_NOT_FOUND for a non-existent lockId", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, 9999n, asmAddr, usdc6(100)
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.LOCK_NOT_FOUND());
    });

    it("returns NOT_LOCK_OWNER when caller is not the lock owner", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { user1, user2 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      // user2 tries to reference user1's lock
      const [ok, reason] = await eligibilityModule.canEnterManager(
        user2.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.NOT_LOCK_OWNER());
    });

    it("returns LOCK_NOT_ACTIVE for an exited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, lockManager, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const { lockId, yrBal } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);           // status → Exited

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.LOCK_NOT_ACTIVE());
    });

    it("returns LOCK_NOT_ACTIVE for an early-exited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, lockManager, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const { lockId, yrBal } = await openLock(fixture, user1, usdc6(100), NINETY_DAYS);
      await lockManager.connect(user1).earlyExit(lockId);        // status → EarlyExited

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.LOCK_NOT_ACTIVE());
    });

    it("returns LOCK_NOT_YRUSDC for a lock in MANAGER_UNITS state", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, lockManager, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // Create Bronze lock, then enter ASM (LM.eligibilityModule=0 → no gate here)
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);
      // Lock is now MANAGER_UNITS

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.LOCK_NOT_YRUSDC());
    });

    it("returns TRIAL_NOT_ELIGIBLE when lock age < 30 days", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // Enable manager config first (so age check fires, not MANAGER_DISABLED)
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);

      const { lockId, yrBal } = await openLock(fixture, user1, usdc6(500), NINETY_DAYS);
      await advanceTime(15n * DAY);   // 15 days — still Trial

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.TRIAL_NOT_ELIGIBLE());
    });

    it("returns INVALID_AMOUNT when yrUSDCAmount is 0", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, 0n
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.INVALID_AMOUNT());
    });

    it("returns INVALID_AMOUNT when yrUSDCAmount > lock.yrUSDCAmount", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal + 1n
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.INVALID_AMOUNT());
    });
  });

  // =========================================================================
  // 3. canEnterManager — manager config checks
  // =========================================================================

  describe("canEnterManager — manager config", function () {

    it("returns MANAGER_DISABLED when manager is not configured", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const { lockId, yrBal } = await openBronzeLock(fixture, user1);
      // manager config never set → enabled = false by default

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.MANAGER_DISABLED());
    });

    it("returns MANAGER_DISABLED when manager is explicitly disabled", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, false, 0, 0, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.MANAGER_DISABLED());
    });

    it("passes when requiredPoints = 0 (no Points check)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      // user has 0 Points — should still pass
      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
    });

    it("returns INSUFFICIENT_POINTS when user has fewer than requiredPoints", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // required = 1 000 Points; 10 USDC × 90-day lock mints only ~13 base Points
      const required = units18(1_000);
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, required, 0, false);
      // Use a tiny lock so base points are well below required
      const { lockId, yrBal } = await openBronzeLock(fixture, user1, usdc6(10));

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.INSUFFICIENT_POINTS());
    });

    it("passes when user has enough Points", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, pointsLedger, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // Same tiny lock (13 base Points) + mint 1 000 → total 1 013 >= required 1 000
      const required = units18(1_000);
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, required, 0, false);

      // Grant admin minting rights and top up user1's Points
      await pointsLedger.connect(admin).grantRole(POINTS_MINTER_ROLE, admin.address);
      await pointsLedger.connect(admin).creditLock(user1.address, units18(1_000));

      const { lockId, yrBal } = await openBronzeLock(fixture, user1, usdc6(10));

      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
    });

    it("returns INSUFFICIENT_YRFP when user lacks required YRFP balance", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // Deploy a mock ERC20 as YRFP token (reuse MockUSDC)
      const mockYRFP = await ethers.getContractFactory("MockUSDC").then(f => f.deploy());
      const yrfpAddr = await mockYRFP.getAddress();
      await eligibilityModule.connect(admin).setYRFPToken(yrfpAddr);

      const requiredYRFP = units18(100);
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, requiredYRFP, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);
      // user has 0 YRFP

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.INSUFFICIENT_YRFP());
    });

    it("passes when user has enough YRFP balance", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const mockYRFP = await ethers.getContractFactory("MockUSDC").then(f => f.deploy());
      const yrfpAddr = await mockYRFP.getAddress();
      await eligibilityModule.connect(admin).setYRFPToken(yrfpAddr);

      const requiredYRFP = units18(100);
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, requiredYRFP, false);
      await mockYRFP.mint(user1.address, requiredYRFP); // exactly required

      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
    });

    it("YRFP threshold is skipped when yrfpToken is address(0)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // requiredYRFP > 0 but no yrfpToken set → check is skipped
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, units18(100), false);
      // yrfpToken = address(0) (default)
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
    });

    it("returns NOT_ALLOWLISTED when allowlistRequired and user not on list", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, true);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.false;
      expect(reason).to.equal(await eligibilityModule.NOT_ALLOWLISTED());
    });

    it("passes when user is on the allowlist", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, true);
      await eligibilityModule.connect(admin).setManagerAllowlist(asmAddr, user1.address, true);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
    });
  });

  // =========================================================================
  // 4. canEnterManager — full pass (Bronze lock, all defaults)
  // =========================================================================

  describe("canEnterManager — full pass", function () {

    it("returns (true, 0x0) for Bronze lock with all defaults enabled", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal
      );
      expect(ok).to.be.true;
      expect(reason).to.equal(ethers.ZeroHash);
    });

    it("accepts partial yrUSDCAmount (<= lock balance)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId, yrBal } = await openBronzeLock(fixture, user1, usdc6(1_000));

      const [ok] = await eligibilityModule.canEnterManager(
        user1.address, lockId, asmAddr, yrBal / 2n   // half
      );
      expect(ok).to.be.true;
    });

    it("isManagerEnabled() reflects setManagerConfig enabled flag", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      expect(await eligibilityModule.isManagerEnabled(asmAddr)).to.be.false;
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      expect(await eligibilityModule.isManagerEnabled(asmAddr)).to.be.true;
    });
  });

  // =========================================================================
  // 5. Admin — setManagerConfig
  // =========================================================================

  describe("admin — setManagerConfig", function () {

    it("updates all config fields and emits ManagerConfigSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(
        eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, units18(50), units18(10), true)
      )
        .to.emit(eligibilityModule, "ManagerConfigSet")
        .withArgs(asmAddr, true, units18(50), units18(10), true);

      expect(await eligibilityModule.isManagerEnabled(asmAddr)).to.be.true;
      expect(await eligibilityModule.requiredPoints(asmAddr)).to.equal(units18(50));
      expect(await eligibilityModule.requiredYRFP(asmAddr)).to.equal(units18(10));
      expect(await eligibilityModule.allowlistRequired(asmAddr)).to.be.true;
    });

    it("reverts for non-admin caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(
        eligibilityModule.connect(user1).setManagerConfig(asmAddr, true, 0, 0, false)
      ).to.be.reverted;
    });

    it("reverts when manager address is zero", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { admin } } = fixture;

      await expect(
        eligibilityModule.connect(admin).setManagerConfig(ethers.ZeroAddress, true, 0, 0, false)
      ).to.be.revertedWith("EligibilityModule: zero manager");
    });

    it("can overwrite config to disable a previously enabled manager", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      expect(await eligibilityModule.isManagerEnabled(asmAddr)).to.be.true;

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, false, 0, 0, false);
      expect(await eligibilityModule.isManagerEnabled(asmAddr)).to.be.false;
    });
  });

  // =========================================================================
  // 6. Admin — setManagerAllowlist
  // =========================================================================

  describe("admin — setManagerAllowlist", function () {

    it("adds user to allowlist and emits ManagerAllowlistUpdated", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      expect(await eligibilityModule.isAllowlisted(user1.address, asmAddr)).to.be.false;

      await expect(
        eligibilityModule.connect(admin).setManagerAllowlist(asmAddr, user1.address, true)
      )
        .to.emit(eligibilityModule, "ManagerAllowlistUpdated")
        .withArgs(asmAddr, user1.address, true);

      expect(await eligibilityModule.isAllowlisted(user1.address, asmAddr)).to.be.true;
    });

    it("removes user from allowlist", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerAllowlist(asmAddr, user1.address, true);
      await eligibilityModule.connect(admin).setManagerAllowlist(asmAddr, user1.address, false);
      expect(await eligibilityModule.isAllowlisted(user1.address, asmAddr)).to.be.false;
    });

    it("reverts for non-admin caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { user1, user2 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(
        eligibilityModule.connect(user1).setManagerAllowlist(asmAddr, user2.address, true)
      ).to.be.reverted;
    });

    it("reverts when manager or user is address(0)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(
        eligibilityModule.connect(admin).setManagerAllowlist(ethers.ZeroAddress, user1.address, true)
      ).to.be.revertedWith("EligibilityModule: zero address");

      await expect(
        eligibilityModule.connect(admin).setManagerAllowlist(asmAddr, ethers.ZeroAddress, true)
      ).to.be.revertedWith("EligibilityModule: zero address");
    });
  });

  // =========================================================================
  // 7. Admin — reference address setters
  // =========================================================================

  describe("admin — reference address setters", function () {

    it("setLockManager updates lockManager and emits LockManagerSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { admin, user1 } } = fixture;

      await expect(
        eligibilityModule.connect(admin).setLockManager(user1.address)
      )
        .to.emit(eligibilityModule, "LockManagerSet")
        .withArgs(user1.address);

      expect(await eligibilityModule.lockManager()).to.equal(user1.address);
    });

    it("setLockManager reverts for non-admin", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { user1, user2 } } = fixture;

      await expect(
        eligibilityModule.connect(user1).setLockManager(user2.address)
      ).to.be.reverted;
    });

    it("setPointsLedger updates pointsLedger and emits PointsLedgerSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { admin, user1 } } = fixture;

      await expect(
        eligibilityModule.connect(admin).setPointsLedger(user1.address)
      )
        .to.emit(eligibilityModule, "PointsLedgerSet")
        .withArgs(user1.address);

      expect(await eligibilityModule.pointsLedger()).to.equal(user1.address);
    });

    it("setPointsLedger reverts for non-admin", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { user1, user2 } } = fixture;

      await expect(
        eligibilityModule.connect(user1).setPointsLedger(user2.address)
      ).to.be.reverted;
    });

    it("setYRFPToken updates yrfpToken and emits YRFPTokenSet", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { admin, user1 } } = fixture;

      await expect(
        eligibilityModule.connect(admin).setYRFPToken(user1.address)
      )
        .to.emit(eligibilityModule, "YRFPTokenSet")
        .withArgs(user1.address);

      expect(await eligibilityModule.yrfpToken()).to.equal(user1.address);
    });

    it("setYRFPToken reverts for non-admin", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { eligibilityModule, signers: { user1, user2 } } = fixture;

      await expect(
        eligibilityModule.connect(user1).setYRFPToken(user2.address)
      ).to.be.reverted;
    });
  });

  // =========================================================================
  // 8. LockManager integration — eligibilityModule = address(0) skips gate
  // =========================================================================

  describe("LockManager integration — address(0) skips eligibility gate", function () {

    it("enterAccessStrategyManager succeeds without eligibilityModule connected (Trial lock blocked but Bronze passes)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // lockManager.eligibilityModule = address(0) in fixture — no gate
      expect(await lockManager.eligibilityModule()).to.equal(ethers.ZeroAddress);

      // Bronze lock: no eligibility module means no restriction on age/points/config
      const { lockId } = await openBronzeLock(fixture, user1, usdc6(500));
      const managerUnits = await lockManager.connect(user1).enterAccessStrategyManager.staticCall(lockId, asmAddr);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);
      expect(managerUnits).to.be.gt(0n);
    });

    it("enterAccessStrategyManager reverts EligibilityCheckFailed when module is connected and manager is disabled", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr   = await accessStrategyManager.getAddress();
      const emAddr    = await eligibilityModule.getAddress();

      // Connect the eligibility module
      await lockManager.connect(admin).setEligibilityModule(emAddr);
      // Don't enable the manager → MANAGER_DISABLED reason
      const { lockId } = await openBronzeLock(fixture, user1, usdc6(500));

      await expect(
        lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr)
      ).to.be.revertedWithCustomError(lockManager, "EligibilityCheckFailed");
    });

    it("enterAccessStrategyManager succeeds when eligibilityModule is connected and all checks pass", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lockManager, eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();
      const emAddr  = await eligibilityModule.getAddress();

      // Wire module and enable manager
      await lockManager.connect(admin).setEligibilityModule(emAddr);
      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);

      const { lockId } = await openBronzeLock(fixture, user1, usdc6(500));
      const managerUnits = await lockManager.connect(user1).enterAccessStrategyManager.staticCall(lockId, asmAddr);
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);
      expect(managerUnits).to.be.gt(0n);
    });
  });
});
