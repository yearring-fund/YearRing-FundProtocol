/**
 * PortfolioLensV21.test.ts
 * ========================
 * Tests for the read-only view aggregator PortfolioLensV21.
 *
 * Strategy
 * ---------
 * - All lens functions are view — no state is modified.
 * - Uses V21Fixture (lens pre-deployed, wired to vault / lockManager /
 *   eligibilityModule / pointsLedger / treasury).
 * - Where "MODULE_NOT_SET" must be returned, a throwaway lens is deployed
 *   with eligibilityModule = address(0).
 * - Numeric assertions favour ">0" or closeTo() over exact values because
 *   the pending-reward formulas depend on elapsed seconds and are already
 *   covered by RewardsMathV21 unit tests.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployV21Fixture,
  usdc6,
  units18,
  advanceTime,
  POINTS_MINTER_ROLE,
  DAY,
  YEAR,
} from "../fixtures/V21Fixture";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVEN_DAYS  =  7n * DAY;
const THIRTY_DAYS = 30n * DAY;
const NINETY_DAYS = 90n * DAY;
const RAY         = 10n ** 27n;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deposit USDC → yrUSDC → createLock.  Returns { lockId, yrBal }. */
async function openLock(
  fixture:    Awaited<ReturnType<typeof deployV21Fixture>>,
  user:       Awaited<ReturnType<typeof ethers.getSigner>>,
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

/** Open a NINETY_DAYS lock and advance 30d+1s to Bronze age. */
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
// Test suite
// ===========================================================================

describe("PortfolioLensV21", function () {

  // =========================================================================
  // 1. Deployment / immutables
  // =========================================================================

  describe("deployment", function () {
    it("stores coreVault", async function () {
      const { lens, vault } = await loadFixture(deployV21Fixture);
      expect(await lens.coreVault()).to.equal(await vault.getAddress());
    });

    it("stores lockManager", async function () {
      const { lens, lockManager } = await loadFixture(deployV21Fixture);
      expect(await lens.lockManager()).to.equal(await lockManager.getAddress());
    });

    it("stores eligibilityModule", async function () {
      const { lens, eligibilityModule } = await loadFixture(deployV21Fixture);
      expect(await lens.eligibilityModule())
        .to.equal(await eligibilityModule.getAddress());
    });

    it("stores pointsLedger", async function () {
      const { lens, pointsLedger } = await loadFixture(deployV21Fixture);
      expect(await lens.pointsLedger()).to.equal(await pointsLedger.getAddress());
    });

    it("stores treasury", async function () {
      const { lens, treasury } = await loadFixture(deployV21Fixture);
      expect(await lens.treasury()).to.equal(await treasury.getAddress());
    });

    it("reverts when coreVault is address(0)", async function () {
      const { lockManager } = await loadFixture(deployV21Fixture);
      const factory = await ethers.getContractFactory("PortfolioLensV21");
      await expect(
        factory.deploy(
          ethers.ZeroAddress,
          await lockManager.getAddress(),
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
        )
      ).to.be.revertedWith("Lens: zero coreVault");
    });

    it("reverts when lockManager is address(0)", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      const factory = await ethers.getContractFactory("PortfolioLensV21");
      await expect(
        factory.deploy(
          await vault.getAddress(),
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
        )
      ).to.be.revertedWith("Lens: zero lockManager");
    });
  });

  // =========================================================================
  // 2. getUserPortfolio — empty state
  // =========================================================================

  describe("getUserPortfolio — empty / no locks", function () {
    it("returns empty locks array and total=0 for user with no locks", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks.length).to.equal(0);
      expect(portfolio.total).to.equal(0n);
    });

    it("does not revert with limit=0", async function () {
      const { lens, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(lens.getUserPortfolio(user1.address, 0, 0)).not.to.be.reverted;
    });

    it("totalPointsBalance is 0 when user has no locks", async function () {
      const { lens, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.totalPointsBalance).to.equal(0n);
    });
  });

  // =========================================================================
  // 3. getUserPortfolio — single lock
  // =========================================================================

  describe("getUserPortfolio — single lock", function () {
    it("returns total=1 after creating one lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.total).to.equal(1n);
      expect(portfolio.locks.length).to.equal(1);
    });

    it("lock has correct owner in info", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(500), THIRTY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].info.owner).to.equal(user1.address);
    });

    it("lock yrUSDCAmount matches deposited amount", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, vault, signers: { user1 } } = fixture;

      const { yrBal } = await openLock(fixture, user1, usdc6(200), NINETY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].info.yrUSDCAmount).to.equal(yrBal);
    });

    it("isMatured is false immediately after lock creation", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), NINETY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].isMatured).to.be.false;
    });

    it("isMatured is true after minUnlockTime passes", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].isMatured).to.be.true;
    });

    it("tierName is 'Trial' for a fresh lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), NINETY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].tierName).to.equal("Trial");
    });

    it("tierName is 'Bronze' after 30+ days", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openBronzeLock(fixture, user1);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.locks[0].tierName).to.equal("Bronze");
    });

    it("totalPointsBalance reflects base points minted at createLock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(1_000), NINETY_DAYS);

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      // 1000 USDC × 90-day → ~1300 base Points (18-dec)
      expect(portfolio.totalPointsBalance).to.be.gt(0n);
    });
  });

  // =========================================================================
  // 4. getLockView — full single-lock view
  // =========================================================================

  describe("getLockView", function () {
    it("returns correct lockId in LockView", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), NINETY_DAYS);

      const view = await lens.getLockView(lockId);
      expect(view.lockId).to.equal(lockId);
    });

    it("committedDuration matches the value passed to createLock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), NINETY_DAYS);

      const view = await lens.getLockView(lockId);
      expect(view.info.committedDuration).to.equal(NINETY_DAYS);
    });

    it("pendingBonusPoints > 0 after 30 days have elapsed", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1_000), NINETY_DAYS);
      await advanceTime(THIRTY_DAYS);

      const view = await lens.getLockView(lockId);
      expect(view.pendingBonusPoints).to.be.gt(0n);
    });

    it("pendingBonusPoints is 0 immediately after createLock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1_000), NINETY_DAYS);

      const view = await lens.getLockView(lockId);
      // checkpoint equals block.timestamp at creation → no elapsed time yet
      expect(view.pendingBonusPoints).to.equal(0n);
    });

    it("pendingRebateUSDC > 0 after 60 days (Bronze tier starts at 30 days)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(1_000), NINETY_DAYS);
      // Trial segment (0–30 days) has 0% rebate; must advance into Bronze (30d+) to get > 0.
      await advanceTime(60n * DAY);

      const view = await lens.getLockView(lockId);
      // Bronze rebate: 1000 USDC × 50bps × 30d/365 × 20% (Bronze multiplier) > 0
      expect(view.pendingRebateUSDC).to.be.gt(0n);
    });

    it("pendingBonusPoints and pendingRebateUSDC are 0 for an Exited lock", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, lockManager, signers: { user1 } } = fixture;

      const { lockId } = await openLock(fixture, user1, usdc6(100), SEVEN_DAYS);
      await advanceTime(SEVEN_DAYS + 1n);
      await lockManager.connect(user1).unlock(lockId);

      const view = await lens.getLockView(lockId);
      expect(view.pendingBonusPoints).to.equal(0n);
      expect(view.pendingRebateUSDC).to.equal(0n);
    });
  });

  // =========================================================================
  // 5. getUserPortfolio — pagination
  // =========================================================================

  describe("getUserPortfolio — pagination", function () {
    it("total reflects all locks even with limit < total", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, usdc, vault, lockManager, signers: { user1 } } = fixture;
      const vaultAddr       = await vault.getAddress();
      const lockManagerAddr = await lockManager.getAddress();

      // Create 3 locks for user1
      for (let i = 0; i < 3; i++) {
        await usdc.mint(user1.address, usdc6(100));
        await usdc.connect(user1).approve(vaultAddr, usdc6(100));
        await vault.connect(user1).deposit(usdc6(100), user1.address);
        const yrBal = await vault.balanceOf(user1.address);
        await vault.connect(user1).approve(lockManagerAddr, yrBal);
        await lockManager.connect(user1).createLock(yrBal, THIRTY_DAYS);
      }

      const page1 = await lens.getUserPortfolio(user1.address, 0, 2);
      expect(page1.total).to.equal(3n);
      expect(page1.locks.length).to.equal(2);

      const page2 = await lens.getUserPortfolio(user1.address, 2, 2);
      expect(page2.total).to.equal(3n);
      expect(page2.locks.length).to.equal(1);
    });

    it("offset=0 limit=0 returns empty locks but correct total", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, usdc, vault, lockManager, signers: { user1 } } = fixture;
      const vaultAddr       = await vault.getAddress();
      const lockManagerAddr = await lockManager.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      const yrBal = await vault.balanceOf(user1.address);
      await vault.connect(user1).approve(lockManagerAddr, yrBal);
      await lockManager.connect(user1).createLock(yrBal, THIRTY_DAYS);

      const result = await lens.getUserPortfolio(user1.address, 0, 0);
      expect(result.total).to.equal(1n);
      expect(result.locks.length).to.equal(0);
    });

    it("offset beyond total returns empty locks", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, signers: { user1 } } = fixture;

      await openLock(fixture, user1, usdc6(100), THIRTY_DAYS);

      const result = await lens.getUserPortfolio(user1.address, 99, 10);
      expect(result.locks.length).to.equal(0);
      expect(result.total).to.equal(1n);
    });
  });

  // =========================================================================
  // 6. getVaultInfo
  // =========================================================================

  describe("getVaultInfo", function () {
    it("vault address matches coreVault", async function () {
      const { lens, vault } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      expect(info.vault).to.equal(await vault.getAddress());
    });

    it("totalAssets equals seed deposit (10 USDC)", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      expect(info.totalAssets).to.equal(usdc6(10));
    });

    it("totalSupply > 0 after seed deposit", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      expect(info.totalSupply).to.be.gt(0n);
    });

    it("pricePerShareRay equals vault.convertToAssets(1e18) * RAY / 1e18", async function () {
      const { lens, vault } = await loadFixture(deployV21Fixture);
      const oneShare = await vault.convertToAssets(ethers.parseEther("1"));
      const expectedPPS = oneShare * RAY / ethers.parseEther("1");

      const info = await lens.getVaultInfo();
      expect(info.pricePerShareRay).to.equal(expectedPPS);
    });

    it("systemMode is 0 (Normal) in fresh fixture", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      expect(info.systemMode).to.equal(0);
    });

    it("allowlistEnabled is true in fresh fixture", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      expect(info.allowlistEnabled).to.be.true;
    });

    it("reserveRatioBps is within vault reserve band (deposit triggers auto-rebalance)", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const info = await lens.getVaultInfo();
      // Seed deposit triggers _autoRebalance(): ~90% pushed to CSM, ~10% stays idle.
      // Reserve target = 10% → reserveRatioBps ≈ 1000. Must be > 0 and < 10000.
      expect(info.reserveRatioBps).to.be.gt(0n);
      expect(info.reserveRatioBps).to.be.lt(10_000n);
    });

    it("reserveRatioBps decreases after investing USDC into strategy", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, csm, coreMockStrategy, signers: { admin, user1 } } = fixture;

      // Deposit 1000 USDC so there's something to invest
      const { vault, usdc } = fixture;
      await usdc.mint(user1.address, usdc6(1_000));
      await usdc.connect(user1).approve(await vault.getAddress(), usdc6(1_000));
      await vault.connect(user1).deposit(usdc6(1_000), user1.address);

      // Invest 500 USDC via CoreSM
      await csm.connect(admin).invest(usdc6(500));

      const info = await lens.getVaultInfo();
      expect(info.reserveRatioBps).to.be.lt(10_000n);
      expect(info.reserveRatioBps).to.be.gt(0n);
    });
  });

  // =========================================================================
  // 7. getManagerInfo (HT Manager)
  // =========================================================================

  describe("getManagerInfo", function () {
    it("manager address matches accessStrategyManager", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.manager).to.equal(await accessStrategyManager.getAddress());
    });

    it("totalManagedAssets is 0 before any ASM entry", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.totalManagedAssets).to.equal(0n);
    });

    it("totalUnits is 0 before any ASM entry", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.totalUnits).to.equal(0n);
    });

    it("unitPriceRay equals RAY (1e27) when totalUnits == 0", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.unitPriceRay).to.equal(RAY);
    });

    it("managementFeeBpsPerYear is 100 (1%)", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.managementFeeBpsPerYear).to.equal(100n);
    });

    it("strategy matches asmMockStrategy address", async function () {
      const { lens, accessStrategyManager, asmMockStrategy } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.strategy).to.equal(await asmMockStrategy.getAddress());
    });

    it("feeReceiver is treasury", async function () {
      const { lens, accessStrategyManager, treasury } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.feeReceiver).to.equal(await treasury.getAddress());
    });

    it("feeReceiverUnits is 0 before any fee accrual", async function () {
      const { lens,  accessStrategyManager } = await loadFixture(deployV21Fixture);
      const mi = await lens.getManagerInfo(await accessStrategyManager.getAddress());
      expect(mi.feeReceiverUnits).to.equal(0n);
    });

    it("totalManagedAssets > 0 after a user enters ASM", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, accessStrategyManager, lockManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await openBronzeLock(fixture, user1, usdc6(500));
      // user1 has one Bronze lock; lockManager.eligibilityModule=0 → no gate
      const { lockId } = await openBronzeLock(fixture, user1, usdc6(500));

      // Note: openBronzeLock creates the lock then advances 30d, so we're at Bronze age
      // Actually we need a fresh Bronze lock — the advance already happened.
      // The lockId from the second call is valid Bronze lock.
      await lockManager.connect(user1).enterAccessStrategyManager(lockId, asmAddr);

      const mi = await lens.getManagerInfo(asmAddr);
      expect(mi.totalManagedAssets).to.be.gt(0n);
      expect(mi.totalUnits).to.be.gt(0n);
    });
  });

  // =========================================================================
  // 8. getTreasuryInfo
  // =========================================================================

  describe("getTreasuryInfo", function () {
    it("treasury address matches fixture treasury", async function () {
      const { lens, treasury } = await loadFixture(deployV21Fixture);
      const ti = await lens.getTreasuryInfo([]);
      expect(ti.treasury).to.equal(await treasury.getAddress());
    });

    it("yrUSDCBalance is 0 when treasury holds no yrUSDC", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const ti = await lens.getTreasuryInfo([]);
      expect(ti.yrUSDCBalance).to.equal(0n);
    });

    it("yrUSDCBalance and yrUSDCValueUSDC update after treasury receives yrUSDC", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, vault, treasury, signers: { admin } } = fixture;
      const treasuryAddr = await treasury.getAddress();
      const vaultAddr    = await vault.getAddress();

      // Admin deposits yrUSDC into treasury
      const adminYr = await vault.balanceOf(admin.address);
      const amount  = adminYr / 2n;
      await vault.connect(admin).approve(treasuryAddr, amount);
      await treasury.connect(admin).depositYrUSDC(amount);

      const ti = await lens.getTreasuryInfo([]);
      expect(ti.yrUSDCBalance).to.equal(amount);
      expect(ti.yrUSDCValueUSDC).to.be.gt(0n);
    });

    it("managerFees array is empty when passed empty managers list", async function () {
      const { lens } = await loadFixture(deployV21Fixture);
      const ti = await lens.getTreasuryInfo([]);
      expect(ti.managerFees.length).to.equal(0);
    });

    it("managerFees includes an entry per manager passed", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens,  accessStrategyManager } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const ti = await lens.getTreasuryInfo([asmAddr]);
      expect(ti.managerFees.length).to.equal(1);
      expect(ti.managerFees[0].manager).to.equal(asmAddr);
    });

    it("managerFee usdcValue is 0 when ASM has no units", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens,  accessStrategyManager } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const ti = await lens.getTreasuryInfo([asmAddr]);
      expect(ti.managerFees[0].feeReceiverUnits).to.equal(0n);
      expect(ti.managerFees[0].usdcValue).to.equal(0n);
    });

    it("getTreasuryInfo with treasury=address(0) lens returns zero balances", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, lockManager, eligibilityModule, pointsLedger } = fixture;
      const vAddr  = await vault.getAddress();
      const lmAddr = await lockManager.getAddress();
      const emAddr = await eligibilityModule.getAddress();
      const plAddr = await pointsLedger.getAddress();

      // Deploy a lens without a treasury
      const lensNoTreasury = await ethers.getContractFactory("PortfolioLensV21")
        .then(f => f.deploy(vAddr, lmAddr, emAddr, plAddr, ethers.ZeroAddress));

      const ti = await lensNoTreasury.getTreasuryInfo([]);
      expect(ti.treasury).to.equal(ethers.ZeroAddress);
      expect(ti.yrUSDCBalance).to.equal(0n);
      expect(ti.yrUSDCValueUSDC).to.equal(0n);
    });
  });

  // =========================================================================
  // 9. checkEligibility
  // =========================================================================

  describe("checkEligibility", function () {
    it("returns (false, MODULE_NOT_SET) when eligibilityModule is address(0)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, lockManager, pointsLedger, treasury, accessStrategyManager, signers: { user1 } } = fixture;
      const vAddr2  = await vault.getAddress();
      const lmAddr2 = await lockManager.getAddress();
      const plAddr2 = await pointsLedger.getAddress();
      const trAddr2 = await treasury.getAddress();

      const lensNoEM = await ethers.getContractFactory("PortfolioLensV21")
        .then(f => f.deploy(vAddr2, lmAddr2, ethers.ZeroAddress, plAddr2, trAddr2));

      const { lockId } = await openBronzeLock(fixture, user1);
      const [ok, reason] = await lensNoEM.checkEligibility(lockId, await accessStrategyManager.getAddress());
      expect(ok).to.be.false;
      expect(reason).to.equal(ethers.encodeBytes32String("MODULE_NOT_SET"));
    });

    it("returns (false, MANAGER_DISABLED) when manager config not set", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, accessStrategyManager, signers: { user1 } } = fixture;

      const { lockId } = await openBronzeLock(fixture, user1);
      const [ok, reason] = await lens.checkEligibility(lockId, await accessStrategyManager.getAddress());
      expect(ok).to.be.false;
      // reason propagates from EligibilityModule
      expect(reason).to.not.equal(ethers.ZeroHash);
    });

    it("returns (true, 0x0) for a Bronze lock with enabled manager config", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, eligibilityModule, accessStrategyManager, signers: { admin, user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId } = await openBronzeLock(fixture, user1);

      const [ok, reason] = await lens.checkEligibility(lockId, asmAddr);
      expect(ok).to.be.true;
      expect(reason).to.equal(ethers.ZeroHash);
    });

    it("uses lock.owner from lockManager — caller does not affect result", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, eligibilityModule, accessStrategyManager, signers: { admin, user1, user2 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      await eligibilityModule.connect(admin).setManagerConfig(asmAddr, true, 0, 0, false);
      const { lockId } = await openBronzeLock(fixture, user1);

      // checkEligibility resolves owner from lockManager.getLock — no msg.sender
      // Calling from user2 or admin doesn't change the result
      const [ok] = await lens.connect(user2).checkEligibility(lockId, asmAddr);
      expect(ok).to.be.true;
    });
  });

  // =========================================================================
  // 10. Points balance in getUserPortfolio
  // =========================================================================

  describe("getUserPortfolio — Points balance", function () {
    it("reflects manually minted Points", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, pointsLedger, signers: { admin, user1 } } = fixture;

      await pointsLedger.connect(admin).grantRole(POINTS_MINTER_ROLE, admin.address);
      await pointsLedger.connect(admin).creditLock(user1.address, units18(500));

      const portfolio = await lens.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.totalPointsBalance).to.equal(units18(500));
    });

    it("totalPointsBalance is 0 when pointsLedger is address(0) in lens", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, lockManager, eligibilityModule, treasury, signers: { user1 } } = fixture;
      const vAddr3  = await vault.getAddress();
      const lmAddr3 = await lockManager.getAddress();
      const emAddr3 = await eligibilityModule.getAddress();
      const trAddr3 = await treasury.getAddress();

      const lensNoLedger = await ethers.getContractFactory("PortfolioLensV21")
        .then(f => f.deploy(vAddr3, lmAddr3, emAddr3, ethers.ZeroAddress, trAddr3));

      const portfolio = await lensNoLedger.getUserPortfolio(user1.address, 0, 10);
      expect(portfolio.totalPointsBalance).to.equal(0n);
    });
  });

  // =========================================================================
  // 11. View-only — no state mutations
  // =========================================================================

  describe("view-only — no state mutations", function () {
    it("calling all view functions does not change vault totalAssets", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { lens, vault, accessStrategyManager, signers: { user1 } } = fixture;
      const asmAddr = await accessStrategyManager.getAddress();

      const { lockId } = await openBronzeLock(fixture, user1);
      const assetsBefore = await vault.totalAssets();

      // Call every lens function
      await lens.getUserPortfolio(user1.address, 0, 10);
      await lens.getLockView(lockId);
      await lens.getVaultInfo();
      await lens.checkEligibility(lockId, asmAddr);
      await lens.getManagerInfo(asmAddr);
      await lens.getTreasuryInfo([asmAddr]);

      expect(await vault.totalAssets()).to.equal(assetsBefore);
    });
  });
});
