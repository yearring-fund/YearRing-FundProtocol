/**
 * CoreStrategyManager.test.ts
 * ============================
 * Unit / integration tests for CoreStrategyManagerV21.
 *
 * Coverage areas
 * --------------
 *  1. Deployment initial state
 *  2. depositFromVault() — unit issuance (first & proportional)
 *  3. withdrawToVault()  — unit burning, pre-pull from strategy
 *  4. unitPriceRay() and vaultManagedAssets() accounting
 *  5. invest() / divestFromStrategy() / emergencyExitStrategy()
 *  6. _accrueFee() — dilution model, rate, auto-trigger
 *  7. redeemFeeUnits() — feeReceiver exit path
 *  8. setStrategy() / setFeeReceiver() admin config
 *  9. Access-control guards on every role-gated function
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

// ─── Constants (mirror contract) ─────────────────────────────────────────────
const RAY         = 10n ** 27n;
const UNITS_SCALE = 10n ** 12n;
const FEE_BPS     = 50n;
const BPS_DENOM   = 10_000n;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Impersonate `addr` and fund it with 1 ETH for gas. */
async function impersonate(addr: string) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
  await network.provider.send("hardhat_setBalance", [addr, "0xde0b6b3a7640000"]); // 1 ETH
  return ethers.getSigner(addr);
}

async function stopImpersonate(addr: string) {
  await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [addr] });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("CoreStrategyManagerV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("vault is immutable and matches CoreVault address", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      expect(await csm.vault()).to.equal(await vault.getAddress());
    });

    it("underlying() returns USDC address", async function () {
      const { csm, usdc } = await loadFixture(deployV21Fixture);
      expect(await csm.underlying()).to.equal(await usdc.getAddress());
    });

    it("lastFeeAccrualAt is set to deploy timestamp", async function () {
      const { csm } = await loadFixture(deployV21Fixture);
      expect(await csm.lastFeeAccrualAt()).to.be.gt(0n);
    });

    it("admin holds DEFAULT_ADMIN_ROLE", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await csm.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("feeReceiver is set to treasury by fixture", async function () {
      const { csm, treasury } = await loadFixture(deployV21Fixture);
      expect(await csm.feeReceiver()).to.equal(await treasury.getAddress());
    });

    it("strategy is set to coreMockStrategy by fixture", async function () {
      const { csm, coreMockStrategy } = await loadFixture(deployV21Fixture);
      expect(await csm.strategy()).to.equal(await coreMockStrategy.getAddress());
    });

    it("FEE_BPS = 50, UNITS_SCALE = 1e12", async function () {
      const { csm } = await loadFixture(deployV21Fixture);
      expect(await csm.FEE_BPS()).to.equal(50n);
      expect(await csm.UNITS_SCALE()).to.equal(UNITS_SCALE);
    });

    it("seed deposit established initial units: 9 USDC → 9e18 units at vault", async function () {
      // After fixture: seed = 10 USDC → autoRebalance pushes 9 USDC to CSM (TARGET 10% kept)
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const units     = await csm.unitsOf(vaultAddr);
      expect(units).to.equal(usdc6(9) * UNITS_SCALE); // 9e6 * 1e12 = 9e18
    });
  });

  // ===========================================================================
  // 2. depositFromVault()
  // ===========================================================================

  describe("depositFromVault()", function () {
    it("first deposit issues units at UNITS_SCALE (assets × 1e12)", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      // Seed already did the first deposit; check that 9 USDC → 9e18 units
      expect(await csm.unitsOf(vaultAddr)).to.equal(usdc6(9) * UNITS_SCALE);
      expect(await csm.totalUnits()).to.equal(usdc6(9) * UNITS_SCALE);
    });

    it("second deposit preserves unit price (proportional issuance)", async function () {
      const { csm, vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      const priceBefore = await csm.unitPriceRay();

      // user1 deposits 100 USDC → vault autoRebalances → pushes ~90 USDC to CSM
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const priceAfter = await csm.unitPriceRay();
      // Unit price should not change on deposit (no yield, same ratio)
      expect(priceAfter).to.be.closeTo(priceBefore, priceBefore / 1000n); // within 0.1%
    });

    it("totalManagedAssets increases by deposited amount", async function () {
      const { csm, vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      const managedBefore = await csm.totalManagedAssets();
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      // CSM received ~90 USDC from the autoRebalance push
      expect(await csm.totalManagedAssets()).to.be.gt(managedBefore);
    });

    it("reverts NotVault when called by non-vault", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(
        csm.connect(admin).depositFromVault(usdc6(1))
      ).to.be.revertedWithCustomError(csm, "NotVault");
    });

    it("reverts ZeroAmount", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultSigner = await impersonate(await vault.getAddress());
      await expect(
        csm.connect(vaultSigner).depositFromVault(0n)
      ).to.be.revertedWithCustomError(csm, "ZeroAmount");
      await stopImpersonate(await vault.getAddress());
    });

    it("emits DepositedFromVault", async function () {
      const { csm, vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));

      // The deposit transaction internally triggers depositFromVault on CSM
      await expect(
        vault.connect(user1).deposit(usdc6(100), user1.address)
      ).to.emit(csm, "DepositedFromVault");
    });
  });

  // ===========================================================================
  // 3. withdrawToVault()
  // ===========================================================================

  describe("withdrawToVault()", function () {
    it("burns units proportionally and returns USDC to vault", async function () {
      const { csm, vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      // Deposit then redeem
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const unitsBefore = await csm.unitsOf(vaultAddr);

      // Redeem half shares → vault calls withdrawToVault internally
      const halfShares = (await vault.balanceOf(user1.address)) / 2n;
      await vault.connect(user1).redeem(halfShares, user1.address, user1.address);

      const unitsAfter = await csm.unitsOf(vaultAddr);
      expect(unitsAfter).to.be.lt(unitsBefore);
    });

    it("pulls from strategy when CSM idle is insufficient", async function () {
      const { csm, vault, usdc, coreMockStrategy, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      // Deposit 100 USDC
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      // Invest all CSM idle into strategy
      const idle = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(idle);

      // Confirm strategy holds USDC and CSM is empty
      expect(await usdc.balanceOf(csmAddr)).to.equal(0n);
      expect(await usdc.balanceOf(await coreMockStrategy.getAddress())).to.be.gt(0n);

      // Redeem half shares — CSM must divest from strategy to cover
      const halfShares = (await vault.balanceOf(user1.address)) / 2n;
      const usdcBefore = await usdc.balanceOf(user1.address);

      await expect(
        vault.connect(user1).redeem(halfShares, user1.address, user1.address)
      ).to.not.be.reverted;

      expect(await usdc.balanceOf(user1.address)).to.be.gt(usdcBefore);
    });

    it("reverts NotVault when called by non-vault", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(
        csm.connect(admin).withdrawToVault(usdc6(1))
      ).to.be.revertedWithCustomError(csm, "NotVault");
    });

    it("reverts ZeroAmount", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultSigner = await impersonate(await vault.getAddress());
      await expect(
        csm.connect(vaultSigner).withdrawToVault(0n)
      ).to.be.revertedWithCustomError(csm, "ZeroAmount");
      await stopImpersonate(await vault.getAddress());
    });

    it("reverts InsufficientManagedAssets when requesting more than available", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultSigner = await impersonate(await vault.getAddress());
      const managed     = await csm.totalManagedAssets();

      await expect(
        csm.connect(vaultSigner).withdrawToVault(managed + usdc6(1))
      ).to.be.revertedWithCustomError(csm, "InsufficientManagedAssets");
      await stopImpersonate(await vault.getAddress());
    });

    it("emits WithdrawnToVault", async function () {
      const { csm, vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.emit(csm, "WithdrawnToVault");
    });
  });

  // ===========================================================================
  // 4. unitPriceRay() and vaultManagedAssets()
  // ===========================================================================

  describe("unitPriceRay()", function () {
    it("returns RAY (1e27) when totalUnits is 0", async function () {
      // Deploy a fresh CSM (not wired to vault to avoid seed deposit)
      const [deployer, admin] = await ethers.getSigners();
      const usdcF = await ethers.getContractFactory("MockUSDC");
      const usdc  = await usdcF.deploy();
      const usdcAddr = await usdc.getAddress();
      const vaultF   = await ethers.getContractFactory("YearRingCoreVaultV21");
      const vault    = await vaultF.deploy(usdcAddr, admin.address, "T", "T");
      const csmF     = await ethers.getContractFactory("CoreStrategyManagerV21");
      const csm      = await csmF.deploy(usdcAddr, await vault.getAddress(), admin.address);

      expect(await csm.unitPriceRay()).to.equal(RAY);
    });

    it("stays near initial price after deposit (no yield accrued)", async function () {
      const { csm } = await loadFixture(deployV21Fixture);
      // unitPriceRay = 9e6 * 1e27 / 9e18 = 1e15
      const price = await csm.unitPriceRay();
      expect(price).to.equal(RAY / UNITS_SCALE); // 1e27 / 1e12 = 1e15
    });

    it("increases when yield is added to strategy", async function () {
      const { csm, vault, usdc, coreMockStrategy, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      // Deposit and invest
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      const idle = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(idle);

      const priceBefore = await csm.unitPriceRay();

      // Add 1 USDC yield to strategy
      await usdc.mint(admin.address, usdc6(1));
      await usdc.connect(admin).approve(await coreMockStrategy.getAddress(), usdc6(1));
      await coreMockStrategy.connect(admin).addYield(usdc6(1));

      const priceAfter = await csm.unitPriceRay();
      expect(priceAfter).to.be.gt(priceBefore);
    });
  });

  describe("vaultManagedAssets()", function () {
    it("equals vault's proportional share of totalManagedAssets", async function () {
      const { csm, vault } = await loadFixture(deployV21Fixture);
      const vaultAddr  = await vault.getAddress();
      const managed    = await csm.totalManagedAssets();
      const vaultUnits = await csm.unitsOf(vaultAddr);
      const total      = await csm.totalUnits();
      const expected   = managed * vaultUnits / total;
      expect(await csm.vaultManagedAssets()).to.equal(expected);
    });

    it("returns 0 when totalUnits is 0", async function () {
      const [, admin] = await ethers.getSigners();
      const usdcF = await ethers.getContractFactory("MockUSDC");
      const usdc  = await usdcF.deploy();
      const usdcAddr = await usdc.getAddress();
      const vaultF   = await ethers.getContractFactory("YearRingCoreVaultV21");
      const vault    = await vaultF.deploy(usdcAddr, admin.address, "T", "T");
      const csmF     = await ethers.getContractFactory("CoreStrategyManagerV21");
      const csm      = await csmF.deploy(usdcAddr, await vault.getAddress(), admin.address);
      expect(await csm.vaultManagedAssets()).to.equal(0n);
    });

    it("increases when yield accrues in strategy", async function () {
      const { csm, vault, usdc, coreMockStrategy, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      await csm.connect(admin).invest(await usdc.balanceOf(csmAddr));

      const before = await csm.vaultManagedAssets();

      await usdc.mint(admin.address, usdc6(10));
      await usdc.connect(admin).approve(await coreMockStrategy.getAddress(), usdc6(10));
      await coreMockStrategy.connect(admin).addYield(usdc6(10));

      expect(await csm.vaultManagedAssets()).to.be.gt(before);
    });
  });

  // ===========================================================================
  // 5. invest() / divestFromStrategy() / emergencyExitStrategy()
  // ===========================================================================

  describe("invest()", function () {
    it("transfers idle USDC to strategy", async function () {
      const { csm, vault, usdc, coreMockStrategy, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr    = await vault.getAddress();
      const csmAddr      = await csm.getAddress();
      const strategyAddr = await coreMockStrategy.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const idle = await usdc.balanceOf(csmAddr);
      expect(idle).to.be.gt(0n);

      await csm.connect(admin).invest(idle);

      expect(await usdc.balanceOf(csmAddr)).to.equal(0n);
      expect(await usdc.balanceOf(strategyAddr)).to.be.gt(0n);
    });

    it("emits Invested event", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      const idle = await usdc.balanceOf(csmAddr);

      await expect(csm.connect(admin).invest(idle))
        .to.emit(csm, "Invested").withArgs(idle);
    });

    it("keeper can call invest", async function () {
      const { csm, vault, usdc, signers: { keeper, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      const idle = await usdc.balanceOf(csmAddr);

      await expect(csm.connect(keeper).invest(idle)).to.not.be.reverted;
    });

    it("reverts NoStrategy when strategy == address(0)", async function () {
      const [, admin] = await ethers.getSigners();
      const usdcF = await ethers.getContractFactory("MockUSDC");
      const usdc  = await usdcF.deploy();
      const usdcAddr = await usdc.getAddress();
      const vaultF   = await ethers.getContractFactory("YearRingCoreVaultV21");
      const vault    = await vaultF.deploy(usdcAddr, admin.address, "T", "T");
      const csmF     = await ethers.getContractFactory("CoreStrategyManagerV21");
      const csm      = await csmF.deploy(usdcAddr, await vault.getAddress(), admin.address);
      await expect(
        csm.connect(admin).invest(usdc6(1))
      ).to.be.revertedWithCustomError(csm, "NoStrategy");
    });

    it("reverts InsufficientIdle when amount > CSM balance", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      const csmBalance = await (await ethers.getContractAt("MockUSDC",
        await csm.underlying())).balanceOf(await csm.getAddress());
      await expect(
        csm.connect(admin).invest(csmBalance + usdc6(1))
      ).to.be.revertedWithCustomError(csm, "InsufficientIdle");
    });

    it("reverts ZeroAmount", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(admin).invest(0n))
        .to.be.revertedWithCustomError(csm, "ZeroAmount");
    });

    it("reverts Unauthorized for non-admin/keeper", async function () {
      const { csm, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(user1).invest(usdc6(1)))
        .to.be.revertedWithCustomError(csm, "Unauthorized");
    });
  });

  describe("divestFromStrategy()", function () {
    it("pulls USDC from strategy back to CSM idle", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const idle = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(idle);
      expect(await usdc.balanceOf(csmAddr)).to.equal(0n);

      await csm.connect(admin).divestFromStrategy(idle);
      expect(await usdc.balanceOf(csmAddr)).to.equal(idle);
    });

    it("emits DivestFromStrategy", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      const idle = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(idle);

      await expect(csm.connect(admin).divestFromStrategy(idle))
        .to.emit(csm, "DivestFromStrategy");
    });

    it("keeper cannot call divestFromStrategy (admin-only)", async function () {
      const { csm, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(keeper).divestFromStrategy(usdc6(1)))
        .to.be.reverted;
    });

    it("reverts NoStrategy when strategy == address(0)", async function () {
      const [, admin] = await ethers.getSigners();
      const usdcF = await ethers.getContractFactory("MockUSDC");
      const usdc  = await usdcF.deploy();
      const usdcAddr = await usdc.getAddress();
      const vaultF   = await ethers.getContractFactory("YearRingCoreVaultV21");
      const vault    = await vaultF.deploy(usdcAddr, admin.address, "T", "T");
      const csmF     = await ethers.getContractFactory("CoreStrategyManagerV21");
      const csm      = await csmF.deploy(usdcAddr, await vault.getAddress(), admin.address);
      await expect(csm.connect(admin).divestFromStrategy(usdc6(1)))
        .to.be.revertedWithCustomError(csm, "NoStrategy");
    });
  });

  describe("emergencyExitStrategy()", function () {
    it("withdraws all strategy assets to CSM idle", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);

      const invested = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(invested);

      const managedBefore = await csm.totalManagedAssets();
      await csm.connect(admin).emergencyExitStrategy();

      // CSM idle should now equal what was in the strategy
      expect(await usdc.balanceOf(csmAddr)).to.equal(managedBefore);
    });

    it("emits EmergencyExitStrategy", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await vault.connect(user1).deposit(usdc6(100), user1.address);
      await csm.connect(admin).invest(await usdc.balanceOf(csmAddr));

      await expect(csm.connect(admin).emergencyExitStrategy())
        .to.emit(csm, "EmergencyExitStrategy");
    });

    it("keeper cannot call emergencyExitStrategy (admin-only)", async function () {
      const { csm, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(keeper).emergencyExitStrategy())
        .to.be.reverted;
    });
  });

  // ===========================================================================
  // 6. Fee accrual (_accrueFee)
  // ===========================================================================

  describe("fee accrual", function () {
    it("mints fee units to feeReceiver after time elapses", async function () {
      const { csm, treasury } = await loadFixture(deployV21Fixture);
      const treasuryAddr = await treasury.getAddress();

      const unitsBefore = await csm.unitsOf(treasuryAddr);
      await advanceTime(DAY * 30n); // 30 days
      await csm.connect((await ethers.getSigners())[1]).accrueFee(); // admin

      expect(await csm.unitsOf(treasuryAddr)).to.be.gt(unitsBefore);
    });

    it("emits FeeAccrued with non-zero elapsed", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await advanceTime(DAY);
      await expect(csm.connect(admin).accrueFee())
        .to.emit(csm, "FeeAccrued");
    });

    it("no-op when called twice in same block (elapsed == 0)", async function () {
      const { csm, treasury, signers: { admin } } = await loadFixture(deployV21Fixture);
      const treasuryAddr = await treasury.getAddress();

      await advanceTime(DAY);
      await csm.connect(admin).accrueFee(); // first call — accrues

      const unitsAfterFirst = await csm.unitsOf(treasuryAddr);
      await csm.connect(admin).accrueFee(); // second call same block — no-op
      expect(await csm.unitsOf(treasuryAddr)).to.equal(unitsAfterFirst);
    });

    it("no-op when feeReceiver is address(0)", async function () {
      // Deploy CSM without setting feeReceiver
      const [, admin] = await ethers.getSigners();
      const usdcFactory = await ethers.getContractFactory("MockUSDC");
      const usdc = await usdcFactory.deploy();
      const vaultF = await ethers.getContractFactory("YearRingCoreVaultV21");
      const vault  = await vaultF.deploy(await usdc.getAddress(), admin.address, "T", "T");
      const csmF   = await ethers.getContractFactory("CoreStrategyManagerV21");
      const csm    = await csmF.deploy(await usdc.getAddress(), await vault.getAddress(), admin.address);
      // feeReceiver not set → accrueFee is no-op
      await advanceTime(DAY);
      const tx = await csm.connect(admin).accrueFee();
      const receipt = await tx.wait();
      const feeSig = csm.interface.getEvent("FeeAccrued").topicHash;
      expect(receipt?.logs.some(l => l.topics[0] === feeSig)).to.be.false;
    });

    it("keeper can call accrueFee", async function () {
      const { csm, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await advanceTime(DAY);
      await expect(csm.connect(keeper).accrueFee()).to.not.be.reverted;
    });

    it("user cannot call accrueFee", async function () {
      const { csm, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(user1).accrueFee())
        .to.be.revertedWithCustomError(csm, "Unauthorized");
    });

    it("annual fee ≈ 0.5% of managed assets (FEE_BPS = 50)", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr    = await vault.getAddress();
      const csmAddr      = await csm.getAddress();
      const treasuryAddr = await csm.feeReceiver();

      // Deposit 1000 USDC and invest all
      await usdc.mint(user1.address, usdc6(1000));
      await usdc.connect(user1).approve(vaultAddr, usdc6(1000));
      await vault.connect(user1).deposit(usdc6(1000), user1.address);
      await csm.connect(admin).invest(await usdc.balanceOf(csmAddr));

      const managed         = await csm.totalManagedAssets();
      const totalUnitsBefore = await csm.totalUnits();

      // Advance exactly 1 year
      await advanceTime(YEAR);
      await csm.connect(admin).accrueFee();

      // feeReceiver units represent ~0.5% of total
      const feeUnits   = await csm.unitsOf(treasuryAddr);
      const totalUnits = await csm.totalUnits();

      // fee share ≈ 0.5% → feeUnits / totalUnits ≈ 0.005
      const feeBps = feeUnits * 10_000n / totalUnits;
      expect(feeBps).to.be.closeTo(50n, 5n); // 0.50% ± 0.05%
    });

    it("auto-accrues on depositFromVault (via vault.deposit)", async function () {
      const { csm, treasury, vault, usdc, signers: { user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr    = await vault.getAddress();
      const treasuryAddr = await treasury.getAddress();

      await advanceTime(DAY * 30n);

      // deposit triggers _autoRebalance → depositFromVault → _accrueFee inside
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));
      await expect(
        vault.connect(user1).deposit(usdc6(100), user1.address)
      ).to.emit(csm, "FeeAccrued");
    });
  });

  // ===========================================================================
  // 7. redeemFeeUnits()
  // ===========================================================================

  describe("redeemFeeUnits()", function () {
    /** Setup: deposit + invest + advance 30 days to accumulate fee units. */
    async function setupWithFeeUnits() {
      const fixture = await loadFixture(deployV21Fixture);
      const { csm, vault, usdc, treasury, signers: { admin, user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(1000));
      await usdc.connect(user1).approve(vaultAddr, usdc6(1000));
      await vault.connect(user1).deposit(usdc6(1000), user1.address);
      await csm.connect(admin).invest(await usdc.balanceOf(csmAddr));

      await advanceTime(DAY * 30n);
      await csm.connect(admin).accrueFee();

      return fixture;
    }

    it("feeReceiver (treasury) can redeem units for USDC", async function () {
      const { csm, usdc, treasury, signers: { admin } } = await setupWithFeeUnits();
      const treasuryAddr = await treasury.getAddress();

      const feeUnits = await csm.unitsOf(treasuryAddr);
      expect(feeUnits).to.be.gt(0n);

      const usdcBefore = await usdc.balanceOf(treasuryAddr);
      await csm.connect(
        await impersonate(treasuryAddr)
      ).redeemFeeUnits(feeUnits);
      await stopImpersonate(treasuryAddr);

      expect(await usdc.balanceOf(treasuryAddr)).to.be.gt(usdcBefore);
    });

    it("emits FeeUnitsRedeemed", async function () {
      const { csm, treasury, signers: { admin } } = await setupWithFeeUnits();
      const treasuryAddr = await treasury.getAddress();
      const feeUnits     = await csm.unitsOf(treasuryAddr);

      const treasurySigner = await impersonate(treasuryAddr);
      await expect(csm.connect(treasurySigner).redeemFeeUnits(feeUnits))
        .to.emit(csm, "FeeUnitsRedeemed");
      await stopImpersonate(treasuryAddr);
    });

    it("reverts Unauthorized for non-feeReceiver caller", async function () {
      const { csm, signers: { admin } } = await setupWithFeeUnits();
      await expect(
        csm.connect(admin).redeemFeeUnits(1n)
      ).to.be.revertedWithCustomError(csm, "Unauthorized");
    });

    it("reverts ZeroAmount when units == 0", async function () {
      const { csm, treasury } = await setupWithFeeUnits();
      const treasuryAddr   = await treasury.getAddress();
      const treasurySigner = await impersonate(treasuryAddr);
      await expect(
        csm.connect(treasurySigner).redeemFeeUnits(0n)
      ).to.be.revertedWithCustomError(csm, "ZeroAmount");
      await stopImpersonate(treasuryAddr);
    });

    it("reverts InsufficientFeeUnits when over-requesting", async function () {
      const { csm, treasury } = await setupWithFeeUnits();
      const treasuryAddr   = await treasury.getAddress();
      const feeUnits        = await csm.unitsOf(treasuryAddr);
      const treasurySigner  = await impersonate(treasuryAddr);
      await expect(
        csm.connect(treasurySigner).redeemFeeUnits(feeUnits + 1n)
      ).to.be.revertedWithCustomError(csm, "InsufficientFeeUnits");
      await stopImpersonate(treasuryAddr);
    });

    it("unit price of remaining holders is unchanged after fee redemption", async function () {
      const { csm, vault, treasury } = await setupWithFeeUnits();
      const vaultAddr    = await vault.getAddress();
      const treasuryAddr = await treasury.getAddress();

      const priceBefore = await csm.unitPriceRay();
      const feeUnits    = await csm.unitsOf(treasuryAddr);

      const treasurySigner = await impersonate(treasuryAddr);
      await csm.connect(treasurySigner).redeemFeeUnits(feeUnits);
      await stopImpersonate(treasuryAddr);

      // After redeeming fee units, price should be approximately the same
      // (fee redemption is proportional — USDC and units both reduced)
      const priceAfter = await csm.unitPriceRay();
      expect(priceAfter).to.be.closeTo(priceBefore, priceBefore / 1000n); // within 0.1%
    });

    it("vault's proportional assets decrease after fee accrual (dilution)", async function () {
      const { csm, vault, usdc, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      await usdc.mint(user1.address, usdc6(1000));
      await usdc.connect(user1).approve(vaultAddr, usdc6(1000));
      await vault.connect(user1).deposit(usdc6(1000), user1.address);
      await csm.connect(admin).invest(await usdc.balanceOf(csmAddr));

      const vaultAssetsBefore = await csm.vaultManagedAssets();
      await advanceTime(YEAR);
      await csm.connect(admin).accrueFee();
      const vaultAssetsAfter = await csm.vaultManagedAssets();

      // Vault proportional share decreases by ≈ 0.5% after 1 year
      expect(vaultAssetsAfter).to.be.lt(vaultAssetsBefore);
      const dilutionBps = (vaultAssetsBefore - vaultAssetsAfter) * 10_000n / vaultAssetsBefore;
      expect(dilutionBps).to.be.closeTo(50n, 5n); // 0.50% ± 0.05%
    });
  });

  // ===========================================================================
  // 8. Admin configuration
  // ===========================================================================

  describe("setStrategy()", function () {
    it("updates strategy address and emits StrategySet", async function () {
      const { csm, usdc, signers: { admin } } = await loadFixture(deployV21Fixture);
      const usdcAddr = await usdc.getAddress();
      const csmAddr  = await csm.getAddress();
      const mockF    = await ethers.getContractFactory("MockStrategyV21");
      const mock     = await mockF.deploy(usdcAddr, csmAddr, admin.address);
      const mockAddr = await mock.getAddress();

      await expect(csm.connect(admin).setStrategy(mockAddr))
        .to.emit(csm, "StrategySet").withArgs(mockAddr);
      expect(await csm.strategy()).to.equal(mockAddr);
    });

    it("reverts ZeroAddress", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(admin).setStrategy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(csm, "ZeroAddress");
    });

    it("reverts for non-admin", async function () {
      const { csm, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(keeper).setStrategy(ethers.Wallet.createRandom().address))
        .to.be.reverted;
    });
  });

  describe("setFeeReceiver()", function () {
    it("updates feeReceiver and emits FeeReceiverSet", async function () {
      const { csm, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(admin).setFeeReceiver(user1.address))
        .to.emit(csm, "FeeReceiverSet").withArgs(user1.address);
      expect(await csm.feeReceiver()).to.equal(user1.address);
    });

    it("reverts ZeroAddress", async function () {
      const { csm, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(csm.connect(admin).setFeeReceiver(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(csm, "ZeroAddress");
    });

    it("reverts for non-admin", async function () {
      const { csm, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(
        csm.connect(keeper).setFeeReceiver(ethers.Wallet.createRandom().address)
      ).to.be.reverted;
    });
  });

});
