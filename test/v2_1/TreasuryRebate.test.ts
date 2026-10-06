/**
 * TreasuryRebate.test.ts
 * ======================
 * Tests for TreasuryV21 and RebateManagerV21.
 *
 * Coverage — TreasuryV21
 * ----------------------
 *  1. Deployment initial state
 *  2. settleCoreSMFees()  — redeem CSM fee units → yrUSDC reserve
 *  3. settleAccessManagerFees()     — redeem ASM fee units → yrUSDC reserve
 *  4. settleManagers()    — batch settle, minSettlementValue threshold skip
 *  5. ensureLiquidity()   — auto-fills treasury from CSM / ASM fee units
 *  6. withdrawRebate()    — rebateManager-only yrUSDC transfer
 *  7. depositYrUSDC()     — admin manual top-up
 *  8. Admin configuration
 *
 * Coverage — RebateManagerV21
 * ---------------------------
 *  9. Deployment initial state
 * 10. claimRebate() — happy path (Bronze tier lock, treasury pre-funded)
 * 11. claimRebate() — happy path via ensureLiquidity (treasury empty, CSM fills)
 * 12. claimRebate() — error paths
 * 13. Admin configuration
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployV21Fixture,
  usdc6,
  DAY,
  YEAR,
  advanceTime,
  DEFAULT_ADMIN_ROLE,
  KEEPER_ROLE,
} from "../fixtures/V21Fixture";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS  = 7n  * DAY;
const THIRTY_DAYS = 30n * DAY;

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
 * Create a 30-day lock with 1000 USDC, advance past Bronze tier, checkpoint rebate.
 * Returns lockId with claimableRebateUSDC > 0.
 */
async function openBronzeLockWithRebate(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user:    Awaited<ReturnType<typeof ethers.getSigner>>
): Promise<bigint> {
  const { lockManager } = fixture;
  const { lockId } = await openLock(fixture, user, usdc6(1_000), THIRTY_DAYS);
  await advanceTime(THIRTY_DAYS + DAY);
  await lockManager.connect(user).checkpointRebate(lockId);
  return lockId;
}

/**
 * Fund treasury with `yrUSDCAmount` from admin's yrUSDC balance.
 */
async function fundTreasury(
  fixture:       Awaited<ReturnType<typeof deployV21Fixture>>,
  yrUSDCAmount:  bigint
): Promise<void> {
  const { vault, treasury, signers: { admin } } = fixture;
  const treasuryAddr = await treasury.getAddress();
  await vault.connect(admin).approve(treasuryAddr, yrUSDCAmount);
  await treasury.connect(admin).depositYrUSDC(yrUSDCAmount);
}

/**
 * Accrue CSM fees:
 *  1. Have user1 deposit a large amount to boost CSM's managed assets
 *     (seed-only gives ~9 USDC in CSM → too small for 100 USDC threshold).
 *  2. Advance 1 year, call accrueFee.
 *  3. Return accrued fee units.
 */
async function accrueCSMFees(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>
): Promise<bigint> {
  const { csm, treasury, vault, usdc, signers: { admin, user1 } } = fixture;
  const vaultAddr = await vault.getAddress();

  // Deposit 100,000 USDC → autoRebalance pushes ~90,000 to CSM
  // Fee after 1 year at 50bps = ~450 USDC → well above 100 USDC threshold
  const bigDeposit = usdc6(100_000);
  await usdc.mint(user1.address, bigDeposit);
  await usdc.connect(user1).approve(vaultAddr, bigDeposit);
  await vault.connect(user1).deposit(bigDeposit, user1.address);

  await advanceTime(YEAR);
  await csm.connect(admin).accrueFee();
  const units = await csm.unitsOf(await treasury.getAddress());
  return units;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("TreasuryV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("coreVault is set correctly", async function () {
      const { treasury, vault } = await loadFixture(deployV21Fixture);
      expect(await treasury.coreVault()).to.equal(await vault.getAddress());
    });

    it("coreStrategyManager is set to CSM", async function () {
      const { treasury, csm } = await loadFixture(deployV21Fixture);
      expect(await treasury.coreStrategyManager()).to.equal(await csm.getAddress());
    });

    it("rebateManager is wired in fixture", async function () {
      const { treasury, rebateManager } = await loadFixture(deployV21Fixture);
      expect(await treasury.rebateManager()).to.equal(await rebateManager.getAddress());
    });

    it("Access Manager is registered (accessManagerCount = 1)", async function () {
      const { treasury } = await loadFixture(deployV21Fixture);
      expect(await treasury.accessManagerCount()).to.equal(1n);
    });

    it("accessManagerAt(0) is accessStrategyManager address", async function () {
      const { treasury,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      expect(await treasury.accessManagerAt(0n)).to.equal(await accessStrategyManager.getAddress());
    });

    it("minSettlementValueUSDC defaults to 100 USDC", async function () {
      const { treasury } = await loadFixture(deployV21Fixture);
      expect(await treasury.minSettlementValueUSDC()).to.equal(usdc6(100));
    });

    it("yrUSDCBalance is 0 initially", async function () {
      const { treasury } = await loadFixture(deployV21Fixture);
      expect(await treasury.yrUSDCBalance()).to.equal(0n);
    });

    it("admin holds DEFAULT_ADMIN_ROLE and KEEPER_ROLE", async function () {
      const { treasury, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await treasury.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await treasury.hasRole(KEEPER_ROLE, admin.address)).to.be.true;
    });
  });

  // ===========================================================================
  // 2. settleCoreSMFees()
  // ===========================================================================

  describe("settleCoreSMFees()", function () {
    it("redeems CSM fee units and deposits yrUSDC to treasury", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      const units = await accrueCSMFees(fixture);
      expect(units).to.be.gt(0n);

      await treasury.connect(admin).settleCoreSMFees(units);
      expect(await treasury.yrUSDCBalance()).to.be.gt(0n);
    });

    it("emits CoreSMFeesSettled", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      const units = await accrueCSMFees(fixture);
      await expect(treasury.connect(admin).settleCoreSMFees(units))
        .to.emit(treasury, "CoreSMFeesSettled")
        .withArgs(units, anyValue, anyValue);
    });

    it("reverts ZeroAmount when units == 0", async function () {
      const { treasury, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).settleCoreSMFees(0n))
        .to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("keeper can call settleCoreSMFees", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin, keeper } } = fixture;

      // Fixture does not grant keeper on treasury — grant it here
      await treasury.connect(admin).grantRole(KEEPER_ROLE, keeper.address);
      const units = await accrueCSMFees(fixture);
      await expect(treasury.connect(keeper).settleCoreSMFees(units)).to.not.be.reverted;
    });

    it("user cannot call settleCoreSMFees", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { user1 } } = fixture;

      await advanceTime(YEAR);
      await expect(treasury.connect(user1).settleCoreSMFees(1n))
        .to.be.revertedWithCustomError(treasury, "Unauthorized");
    });
  });

  // ===========================================================================
  // 3. settleAccessManagerFees()
  // ===========================================================================

  describe("settleAccessManagerFees()", function () {
    it("redeems ASM fee units and deposits yrUSDC to treasury", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, accessStrategyManager, lockManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      // Enter ASM to generate fee-accruing AUM
      const { shares } = await openLock(fixture, user1, usdc6(10_000), THIRTY_DAYS);
      await vault_connect_user1_approve_lm_enterASM(fixture, user1, asmAddr);

      await advanceTime(YEAR);
      await accessStrategyManager.connect(admin).accrueFee();
      const units = await accessStrategyManager.feeReceiverUnits();
      expect(units).to.be.gt(0n);

      await expect(treasury.connect(admin).settleAccessManagerFees(asmAddr, units))
        .to.emit(treasury, "AccessManagerFeesSettled")
        .withArgs(asmAddr, units, anyValue, anyValue);

      expect(await treasury.yrUSDCBalance()).to.be.gt(0n);
    });

    it("reverts AccessManagerNotRegistered for unknown address", async function () {
      const { treasury, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).settleAccessManagerFees(user1.address, 1n))
        .to.be.revertedWithCustomError(treasury, "AccessManagerNotRegistered");
    });

    it("reverts ZeroAmount when units == 0", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();
      await expect(treasury.connect(admin).settleAccessManagerFees(asmAddr, 0n))
        .to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });
  });

  // ===========================================================================
  // 4. settleManagers()
  // ===========================================================================

  describe("settleManagers()", function () {
    it("settles CSM via address(0) sentinel and emits ManagersBatchSettled", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      await accrueCSMFees(fixture);

      await expect(treasury.connect(admin).settleManagers([ethers.ZeroAddress]))
        .to.emit(treasury, "ManagersBatchSettled")
        .withArgs(1n, anyValue, anyValue);

      expect(await treasury.yrUSDCBalance()).to.be.gt(0n);
    });

    it("settles CSM via coreStrategyManager address", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, csm, signers: { admin } } = fixture;
      const csmAddr = await csm.getAddress();

      await accrueCSMFees(fixture);

      await expect(treasury.connect(admin).settleManagers([csmAddr]))
        .to.emit(treasury, "ManagersBatchSettled");
    });

    it("emits ManagersBatchSettled with settled=0 when all managers below threshold", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      // Set unreachably high threshold
      await treasury.connect(admin).setMinSettlementValueUSDC(usdc6(1_000_000));

      await accrueCSMFees(fixture);

      // CSM fee value (< 0.1 USDC) is far below 1M threshold — should be skipped
      await expect(treasury.connect(admin).settleManagers([ethers.ZeroAddress]))
        .to.emit(treasury, "ManagerSettlementSkipped")
        .and.to.emit(treasury, "ManagersBatchSettled")
        .withArgs(0n, 0n, 0n);

      expect(await treasury.yrUSDCBalance()).to.equal(0n);
    });

    it("silently skips unrecognised addresses", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin, user1 } } = fixture;

      await accrueCSMFees(fixture);

      // user1.address is unrecognised — should be silently skipped
      await expect(
        treasury.connect(admin).settleManagers([user1.address])
      ).to.emit(treasury, "ManagersBatchSettled").withArgs(0n, 0n, 0n);
    });

    it("keeper can call settleManagers", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin, keeper } } = fixture;

      await treasury.connect(admin).grantRole(KEEPER_ROLE, keeper.address);
      await accrueCSMFees(fixture);
      await expect(
        treasury.connect(keeper).settleManagers([ethers.ZeroAddress])
      ).to.not.be.reverted;
    });

    it("user cannot call settleManagers", async function () {
      const { treasury, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        treasury.connect(user1).settleManagers([ethers.ZeroAddress])
      ).to.be.revertedWithCustomError(treasury, "Unauthorized");
    });
  });

  // ===========================================================================
  // 5. ensureLiquidity()
  // ===========================================================================

  describe("ensureLiquidity()", function () {
    it("returns early when treasury already has enough yrUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      // Fund treasury with 1e18 yrUSDC from admin seed
      await fundTreasury(fixture, 1n);

      // No error and balance unchanged
      await expect(treasury.connect(admin).ensureLiquidity(1n)).to.not.be.reverted;
    });

    it("fills treasury from CSM fee units when balance is insufficient", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin } } = fixture;

      // Treasury starts empty; CSM has accrued fee units after 1 year
      await accrueCSMFees(fixture);

      expect(await treasury.yrUSDCBalance()).to.equal(0n);
      await treasury.connect(admin).ensureLiquidity(1n);

      // ensureLiquidity should have settled CSM fees → treasury now has yrUSDC
      expect(await treasury.yrUSDCBalance()).to.be.gt(0n);
    });

    it("rebateManager can call ensureLiquidity", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, rebateManager } = fixture;

      const rebateManagerAddr = await rebateManager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [rebateManagerAddr]);
      await ethers.provider.send("hardhat_setBalance", [rebateManagerAddr, "0xde0b6b3a7640000"]);
      const rmSigner = await ethers.getSigner(rebateManagerAddr);

      await expect(treasury.connect(rmSigner).ensureLiquidity(0n)).to.not.be.reverted;
    });

    it("user cannot call ensureLiquidity", async function () {
      const { treasury, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(user1).ensureLiquidity(0n))
        .to.be.revertedWithCustomError(treasury, "Unauthorized");
    });
  });

  // ===========================================================================
  // 6. withdrawRebate()
  // ===========================================================================

  describe("withdrawRebate()", function () {
    it("rebateManager can withdraw yrUSDC to recipient", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, vault, rebateManager, signers: { admin, user1 } } = fixture;
      const rebateManagerAddr = await rebateManager.getAddress();

      // Admin seed gave admin 10e18 yrUSDC; fund treasury with half
      const amount = 5n * 10n ** 18n;
      await fundTreasury(fixture, amount);
      expect(await treasury.yrUSDCBalance()).to.equal(amount);

      // Impersonate rebateManager to call withdrawRebate
      await ethers.provider.send("hardhat_impersonateAccount", [rebateManagerAddr]);
      await ethers.provider.send("hardhat_setBalance", [rebateManagerAddr, "0xde0b6b3a7640000"]);
      const rmSigner = await ethers.getSigner(rebateManagerAddr);

      const balBefore = await vault.balanceOf(user1.address);
      await treasury.connect(rmSigner).withdrawRebate(user1.address, amount);
      expect(await vault.balanceOf(user1.address)).to.equal(balBefore + amount);
      expect(await treasury.yrUSDCBalance()).to.equal(0n);
    });

    it("emits RebateWithdrawn", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, rebateManager, signers: { admin, user1 } } = fixture;
      const rebateManagerAddr = await rebateManager.getAddress();

      const amount = 10n * 10n ** 18n;
      await fundTreasury(fixture, amount);

      await ethers.provider.send("hardhat_impersonateAccount", [rebateManagerAddr]);
      await ethers.provider.send("hardhat_setBalance", [rebateManagerAddr, "0xde0b6b3a7640000"]);
      const rmSigner = await ethers.getSigner(rebateManagerAddr);

      await expect(treasury.connect(rmSigner).withdrawRebate(user1.address, amount))
        .to.emit(treasury, "RebateWithdrawn").withArgs(user1.address, amount);
    });

    it("reverts Unauthorized for non-rebateManager caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, signers: { admin, user1 } } = fixture;

      await fundTreasury(fixture, 10n * 10n ** 18n);
      await expect(treasury.connect(admin).withdrawRebate(user1.address, 1n))
        .to.be.revertedWithCustomError(treasury, "Unauthorized");
    });

    it("reverts InsufficientYrUSDC when balance < requested", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, rebateManager, signers: { user1 } } = fixture;
      const rebateManagerAddr = await rebateManager.getAddress();

      await ethers.provider.send("hardhat_impersonateAccount", [rebateManagerAddr]);
      await ethers.provider.send("hardhat_setBalance", [rebateManagerAddr, "0xde0b6b3a7640000"]);
      const rmSigner = await ethers.getSigner(rebateManagerAddr);

      // Treasury has 0 yrUSDC
      await expect(
        treasury.connect(rmSigner).withdrawRebate(user1.address, 1n)
      ).to.be.revertedWithCustomError(treasury, "InsufficientYrUSDC");
    });

    it("reverts ZeroAmount", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, rebateManager } = fixture;
      const rebateManagerAddr = await rebateManager.getAddress();

      await ethers.provider.send("hardhat_impersonateAccount", [rebateManagerAddr]);
      await ethers.provider.send("hardhat_setBalance", [rebateManagerAddr, "0xde0b6b3a7640000"]);
      const rmSigner = await ethers.getSigner(rebateManagerAddr);

      await expect(treasury.connect(rmSigner).withdrawRebate(ethers.ZeroAddress, 0n))
        .to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });
  });

  // ===========================================================================
  // 7. depositYrUSDC()
  // ===========================================================================

  describe("depositYrUSDC()", function () {
    it("admin can deposit yrUSDC into treasury", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, vault, signers: { admin } } = fixture;
      const treasuryAddr = await treasury.getAddress();

      const amount = 5n * 10n ** 18n;
      await vault.connect(admin).approve(treasuryAddr, amount);
      await expect(treasury.connect(admin).depositYrUSDC(amount))
        .to.emit(treasury, "YrUSDCDeposited").withArgs(admin.address, amount);

      expect(await treasury.yrUSDCBalance()).to.equal(amount);
    });

    it("reverts ZeroAmount", async function () {
      const { treasury, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).depositYrUSDC(0n))
        .to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("user cannot call depositYrUSDC", async function () {
      const { treasury, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(user1).depositYrUSDC(1n))
        .to.be.revertedWithCustomError(treasury, "Unauthorized");
    });
  });

  // ===========================================================================
  // 8. Admin configuration
  // ===========================================================================

  describe("admin configuration", function () {
    it("setRebateManager updates and emits RebateManagerSet", async function () {
      const { treasury, signers: { admin, user2 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).setRebateManager(user2.address))
        .to.emit(treasury, "RebateManagerSet").withArgs(user2.address);
      expect(await treasury.rebateManager()).to.equal(user2.address);
    });

    it("setCoreStrategyManager updates and emits CoreSMSet", async function () {
      const { treasury, signers: { admin, user2 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).setCoreStrategyManager(user2.address))
        .to.emit(treasury, "CoreSMSet").withArgs(user2.address);
      expect(await treasury.coreStrategyManager()).to.equal(user2.address);
    });

    it("addAccessManager adds and emits AccessManagerAdded", async function () {
      const { treasury, signers: { admin, user2 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).addAccessManager(user2.address))
        .to.emit(treasury, "AccessManagerAdded").withArgs(user2.address);
      expect(await treasury.accessManagerCount()).to.equal(2n);
    });

    it("addAccessManager reverts AccessManagerAlreadyRegistered on duplicate", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(treasury.connect(admin).addAccessManager(asmAddr))
        .to.be.revertedWithCustomError(treasury, "AccessManagerAlreadyRegistered");
    });

    it("removeAccessManager removes and emits AccessManagerRemoved", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { treasury, accessStrategyManager, signers: { admin } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await expect(treasury.connect(admin).removeAccessManager(asmAddr))
        .to.emit(treasury, "AccessManagerRemoved").withArgs(asmAddr);
      expect(await treasury.accessManagerCount()).to.equal(0n);
    });

    it("removeAccessManager reverts AccessManagerNotRegistered for unknown address", async function () {
      const { treasury, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).removeAccessManager(user1.address))
        .to.be.revertedWithCustomError(treasury, "AccessManagerNotRegistered");
    });

    it("setMinSettlementValueUSDC updates and emits MinSettlementValueSet", async function () {
      const { treasury, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(admin).setMinSettlementValueUSDC(usdc6(50)))
        .to.emit(treasury, "MinSettlementValueSet").withArgs(usdc6(50));
      expect(await treasury.minSettlementValueUSDC()).to.equal(usdc6(50));
    });

    it("admin config setters require DEFAULT_ADMIN_ROLE", async function () {
      const { treasury, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(treasury.connect(user1).setRebateManager(user1.address)).to.be.reverted;
      await expect(treasury.connect(user1).setCoreStrategyManager(user1.address)).to.be.reverted;
      await expect(treasury.connect(user1).addAccessManager(user1.address)).to.be.reverted;
      await expect(treasury.connect(user1).setMinSettlementValueUSDC(0n)).to.be.reverted;
    });
  });
});

// =============================================================================
// RebateManagerV21
// =============================================================================

describe("RebateManagerV21", function () {

  // ===========================================================================
  // 9. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("coreVault is set correctly", async function () {
      const { rebateManager, vault } = await loadFixture(deployV21Fixture);
      expect(await rebateManager.coreVault()).to.equal(await vault.getAddress());
    });

    it("lockManager is wired in fixture", async function () {
      const { rebateManager, lockManager } = await loadFixture(deployV21Fixture);
      expect(await rebateManager.lockManager()).to.equal(await lockManager.getAddress());
    });

    it("treasury is wired in fixture", async function () {
      const { rebateManager, treasury } = await loadFixture(deployV21Fixture);
      expect(await rebateManager.treasury()).to.equal(await treasury.getAddress());
    });

    it("admin holds DEFAULT_ADMIN_ROLE", async function () {
      const { rebateManager, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await rebateManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });
  });

  // ===========================================================================
  // 10. claimRebate() — happy path (treasury pre-funded)
  // ===========================================================================

  describe("claimRebate() — happy path (treasury pre-funded)", function () {
    it("transfers yrUSDC to lock owner and zeroes claimableRebateUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, lockManager, vault, signers: { admin, user1 } } = fixture;

      const lockId = await openBronzeLockWithRebate(fixture, user1);
      const lock   = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);

      // Pre-fund treasury with generous buffer (admin has 10e18 yrUSDC from seed)
      await fundTreasury(fixture, 5n * 10n ** 18n);

      const balBefore = await vault.balanceOf(user1.address);
      await rebateManager.connect(user1).claimRebate(lockId);
      const balAfter  = await vault.balanceOf(user1.address);

      expect(balAfter).to.be.gt(balBefore);
      expect((await lockManager.getLock(lockId)).claimableRebateUSDC).to.equal(0n);
    });

    it("emits RebateClaimed with correct lockId and owner", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, signers: { admin, user1 } } = fixture;

      const lockId = await openBronzeLockWithRebate(fixture, user1);
      await fundTreasury(fixture, 5n * 10n ** 18n);

      await expect(rebateManager.connect(user1).claimRebate(lockId))
        .to.emit(rebateManager, "RebateClaimed")
        .withArgs(lockId, user1.address, anyValue, anyValue);
    });

    it("Exited lock (normal unlock) can still claim rebate", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, lockManager, vault, signers: { admin, user1 } } = fixture;

      const lockId = await openBronzeLockWithRebate(fixture, user1);
      // Advance past maturity and unlock
      await lockManager.connect(user1).unlock(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);

      await fundTreasury(fixture, 5n * 10n ** 18n);

      const balBefore = await vault.balanceOf(user1.address);
      await expect(rebateManager.connect(user1).claimRebate(lockId)).to.not.be.reverted;
      expect(await vault.balanceOf(user1.address)).to.be.gt(balBefore);
    });
  });

  // ===========================================================================
  // 11. claimRebate() — treasury auto-filled via ensureLiquidity
  // ===========================================================================

  describe("claimRebate() — treasury auto-filled via ensureLiquidity", function () {
    it("claim succeeds when treasury is empty but CSM fee units can cover rebate", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, vault, lockManager, usdc, signers: { admin, user1, user2 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const lmAddr    = await lockManager.getAddress();

      // Boost CSM's managed assets: user2 deposits 100,000 USDC so CSM earns
      // ~450 USDC/year in fees (well above any tiny rebate from a small lock).
      const bigDeposit = usdc6(100_000);
      await usdc.mint(user2.address, bigDeposit);
      await usdc.connect(user2).approve(vaultAddr, bigDeposit);
      await vault.connect(user2).deposit(bigDeposit, user2.address);

      // Create a tiny lock (10 USDC, 30-day) for user1 — smallest possible rebate
      await usdc.mint(user1.address, usdc6(10));
      await usdc.connect(user1).approve(vaultAddr, usdc6(10));
      await vault.connect(user1).deposit(usdc6(10), user1.address);
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

      // Advance past Bronze → checkpoint rebate (small USDC amount)
      await advanceTime(THIRTY_DAYS + DAY);
      await lockManager.connect(user1).checkpointRebate(lockId);

      const lock = await lockManager.getLock(lockId);
      expect(lock.claimableRebateUSDC).to.be.gt(0n);

      // Keeper accrues CSM fees (mints fee units to treasury).
      // ensureLiquidity reads unitsOf(treasury) — if 0, CSM path is skipped.
      await fixture.csm.connect(admin).accrueFee();
      expect(await fixture.csm.unitsOf(await fixture.treasury.getAddress())).to.be.gt(0n);

      // Treasury is empty — ensureLiquidity will draw from accrued CSM fee units
      expect(await fixture.treasury.yrUSDCBalance()).to.equal(0n);

      await expect(rebateManager.connect(user1).claimRebate(lockId)).to.not.be.reverted;
      expect(await vault.balanceOf(user1.address)).to.be.gt(0n);
    });
  });

  // ===========================================================================
  // 12. claimRebate() — error paths
  // ===========================================================================

  describe("claimRebate() — error paths", function () {
    it("reverts NotLockOwner for wrong caller", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, signers: { admin, user1, user2 } } = fixture;

      const lockId = await openBronzeLockWithRebate(fixture, user1);
      await fundTreasury(fixture, 5n * 10n ** 18n);

      await expect(rebateManager.connect(user2).claimRebate(lockId))
        .to.be.revertedWithCustomError(rebateManager, "NotLockOwner");
    });

    it("reverts LockNotClaimable for EarlyExited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, lockManager, signers: { admin, user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await lockManager.connect(user1).earlyExit(lockId);
      await fundTreasury(fixture, 5n * 10n ** 18n);

      await expect(rebateManager.connect(user1).claimRebate(lockId))
        .to.be.revertedWithCustomError(rebateManager, "LockNotClaimable");
    });

    it("reverts NothingToClaim for Trial lock with no rebate accrued", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, signers: { admin, user1 } } = fixture;

      // Trial lock — no rebate in first 30 days
      const { lockId } = await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);
      await fundTreasury(fixture, 5n * 10n ** 18n);

      await expect(rebateManager.connect(user1).claimRebate(lockId))
        .to.be.revertedWithCustomError(rebateManager, "NothingToClaim");
    });

    it("reverts InsufficientRebateReserve when treasury empty and fees can't cover", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { rebateManager, treasury, signers: { admin, user1 } } = fixture;

      const lockId = await openBronzeLockWithRebate(fixture, user1);

      // Disconnect CSM and remove ASM → ensureLiquidity can't fill from fee units
      await treasury.connect(admin).setCoreStrategyManager(ethers.ZeroAddress);
      await treasury.connect(admin).removeAccessManager(await fixture.accessStrategyManager.getAddress());

      // Treasury has 0 yrUSDC and no sources to fill → InsufficientRebateReserve
      await expect(rebateManager.connect(user1).claimRebate(lockId))
        .to.be.revertedWithCustomError(rebateManager, "InsufficientRebateReserve");
    });
  });

  // ===========================================================================
  // 13. Admin configuration
  // ===========================================================================

  describe("admin configuration", function () {
    it("setLockManager updates and emits LockManagerSet", async function () {
      const { rebateManager, signers: { admin, user2 } } = await loadFixture(deployV21Fixture);
      await expect(rebateManager.connect(admin).setLockManager(user2.address))
        .to.emit(rebateManager, "LockManagerSet").withArgs(user2.address);
      expect(await rebateManager.lockManager()).to.equal(user2.address);
    });

    it("setTreasury updates and emits TreasurySet", async function () {
      const { rebateManager, signers: { admin, user2 } } = await loadFixture(deployV21Fixture);
      await expect(rebateManager.connect(admin).setTreasury(user2.address))
        .to.emit(rebateManager, "TreasurySet").withArgs(user2.address);
      expect(await rebateManager.treasury()).to.equal(user2.address);
    });

    it("setLockManager requires DEFAULT_ADMIN_ROLE", async function () {
      const { rebateManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(rebateManager.connect(user1).setLockManager(user1.address)).to.be.reverted;
    });

    it("setTreasury requires DEFAULT_ADMIN_ROLE", async function () {
      const { rebateManager, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(rebateManager.connect(user1).setTreasury(user1.address)).to.be.reverted;
    });
  });
});

// ─── Inline helpers referenced in tests above ────────────────────────────────

/**
 * enterASM helper used inline in settleAccessManagerFees test.
 * (Avoids circular dependency with the outer helper function.)
 */
async function vault_connect_user1_approve_lm_enterASM(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user:    Awaited<ReturnType<typeof ethers.getSigner>>,
  asmAddr: string
): Promise<void> {
  const { vault, lockManager } = fixture;
  const lmAddr = await lockManager.getAddress();

  // User already has yrUSDC from openLock call above — find first active lock
  // For simplicity, re-use the lock created in openLock (id = nextLockId - 1)
  const nextId  = await lockManager.nextLockId();
  const lockId  = nextId - 1n;
  await lockManager.connect(user).enterAccessStrategyManager(lockId, asmAddr);
}

/**
 * Checkpoint rebate for a given lock — used in ensureLiquidity auto-fill test.
 */
async function lockManager_checkpoint(
  fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
  user:    Awaited<ReturnType<typeof ethers.getSigner>>,
  lockId:  bigint
): Promise<void> {
  const { lockManager } = fixture;
  await lockManager.connect(user).checkpointRebate(lockId);
}
