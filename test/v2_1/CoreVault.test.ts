/**
 * CoreVault.test.ts
 * =================
 * Unit / integration tests for YearRingCoreVaultV21.
 *
 * Coverage areas
 * --------------
 *  1. Deployment initial state
 *  2. totalAssets accounting (idle + CSM-managed)
 *  3. Allowlist enforcement
 *  4. deposit() / mint()
 *  5. depositWithMinShares() slippage guard
 *  6. redeem() / withdraw() including pre-pull from CSM
 *  7. _autoRebalance() — push (reserve > MAX) and pull (reserve < MIN)
 *  8. rebalance() manual cooldown
 *  9. System modes (Normal / Paused / EmergencyExit)
 * 10. Admin configuration (setCoreStrategyManager, setRebalanceCooldown)
 * 11. InsufficientVaultLiquidity guard
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployV21Fixture,
  usdc6,
  units18,
  advanceTime,
  DEFAULT_ADMIN_ROLE,
  KEEPER_ROLE,
  ALLOWLIST_ROLE,
  EMERGENCY_ROLE,
} from "../fixtures/V21Fixture";

// ─── Reserve band constants (mirrors contract) ───────────────────────────────
const BPS                = 10_000n;
const MIN_RESERVE_BPS    =    500n; //  5%
const TARGET_RESERVE_BPS =  1_000n; // 10%
const MAX_RESERVE_BPS    =  1_500n; // 15%

// ─────────────────────────────────────────────────────────────────────────────

describe("YearRingCoreVaultV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("systemMode is Normal (0) after deploy", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      expect(await vault.systemMode()).to.equal(0);
    });

    it("allowlistEnabled is true by default", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      expect(await vault.allowlistEnabled()).to.be.true;
    });

    it("coreStrategyManager is wired to csm", async function () {
      const { vault, csm } = await loadFixture(deployV21Fixture);
      expect(await vault.coreStrategyManager()).to.equal(await csm.getAddress());
    });

    it("admin holds DEFAULT_ADMIN_ROLE, EMERGENCY_ROLE, KEEPER_ROLE, ALLOWLIST_ROLE", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      expect(await vault.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await vault.hasRole(EMERGENCY_ROLE,     admin.address)).to.be.true;
      expect(await vault.hasRole(KEEPER_ROLE,        admin.address)).to.be.true;
      expect(await vault.hasRole(ALLOWLIST_ROLE,     admin.address)).to.be.true;
    });

    it("keeper holds KEEPER_ROLE", async function () {
      const { vault, signers: { keeper } } = await loadFixture(deployV21Fixture);
      expect(await vault.hasRole(KEEPER_ROLE, keeper.address)).to.be.true;
    });

    it("decimals() returns 18", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      expect(await vault.decimals()).to.equal(18);
    });

    it("seed deposit sets totalAssets = 10 USDC", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      expect(await vault.totalAssets()).to.equal(usdc6(10));
    });

    it("initial PPS: 1 yrUSDC ≈ 1e-12 USDC (12-decimal offset applied)", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      // convertToAssets(1e18) ≈ 1 USDC (= 1e6) because of 12-dec offset
      const assets = await vault.convertToAssets(units18(1));
      expect(assets).to.be.closeTo(usdc6(1), usdc6(1) / 100n); // within 1%
    });

    it("rebalanceCooldown defaults to 1 hour", async function () {
      const { vault } = await loadFixture(deployV21Fixture);
      expect(await vault.rebalanceCooldown()).to.equal(3600n);
    });
  });

  // ===========================================================================
  // 2. totalAssets
  // ===========================================================================

  describe("totalAssets", function () {
    it("equals vault idle USDC + csm.vaultManagedAssets()", async function () {
      const { vault, csm, usdc } = await loadFixture(deployV21Fixture);
      const idle    = await usdc.balanceOf(await vault.getAddress());
      const managed = await csm.vaultManagedAssets();
      expect(await vault.totalAssets()).to.equal(idle + managed);
    });

    it("returns only vault idle when CSM is disconnected", async function () {
      const { vault, usdc, signers: { admin } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).setCoreStrategyManager(ethers.ZeroAddress);
      const idle = await usdc.balanceOf(await vault.getAddress());
      expect(await vault.totalAssets()).to.equal(idle);
    });

    it("increases by deposit amount when CSM is disconnected", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      await vault.connect(admin).setCoreStrategyManager(ethers.ZeroAddress);

      const before  = await vault.totalAssets();
      const amount  = usdc6(50);
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);

      expect(await vault.totalAssets()).to.equal(before + amount);
    });
  });

  // ===========================================================================
  // 3. Allowlist
  // ===========================================================================

  describe("allowlist", function () {
    it("deposit reverts NotAllowed for non-allowlisted address", async function () {
      const { vault, usdc } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const [, , , , , , stranger] = await ethers.getSigners();

      await usdc.mint(stranger.address, usdc6(10));
      await usdc.connect(stranger).approve(vaultAddr, usdc6(10));

      await expect(
        vault.connect(stranger).deposit(usdc6(10), stranger.address)
      ).to.be.revertedWithCustomError(vault, "NotAllowed");
    });

    it("deposit succeeds after setAllowlist(account, true)", async function () {
      const { vault, usdc, signers: { admin } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const [, , , , , , newUser] = await ethers.getSigners();

      await vault.connect(admin).setAllowlist(newUser.address, true);
      await usdc.mint(newUser.address, usdc6(10));
      await usdc.connect(newUser).approve(vaultAddr, usdc6(10));

      await expect(
        vault.connect(newUser).deposit(usdc6(10), newUser.address)
      ).to.not.be.reverted;
    });

    it("revoking allowlist blocks further deposits", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).setAllowlist(user1.address, false);
      await usdc.mint(user1.address, usdc6(10));
      await usdc.connect(user1).approve(vaultAddr, usdc6(10));

      await expect(
        vault.connect(user1).deposit(usdc6(10), user1.address)
      ).to.be.revertedWithCustomError(vault, "NotAllowed");
    });

    it("ALLOWLIST_ROLE holder can manage allowlist entries", async function () {
      const { vault, signers: { admin, keeper } } = await loadFixture(deployV21Fixture);
      // Grant ALLOWLIST_ROLE to keeper
      await vault.connect(admin).grantRole(ALLOWLIST_ROLE, keeper.address);
      const [, , , , , , newUser] = await ethers.getSigners();

      await expect(
        vault.connect(keeper).setAllowlist(newUser.address, true)
      ).to.emit(vault, "AllowlistUpdated").withArgs(newUser.address, true);
    });

    it("unauthorized address reverts Unauthorized on setAllowlist", async function () {
      const { vault, signers: { user1, user2 } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(user1).setAllowlist(user2.address, true)
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("setAllowlist(address(0), ...) reverts ZeroAddress", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(admin).setAllowlist(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("setAllowlistEnabled(false) opens deposits to everyone", async function () {
      const { vault, usdc, signers: { admin } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const [, , , , , , stranger] = await ethers.getSigners();

      await vault.connect(admin).setAllowlistEnabled(false);
      expect(await vault.allowlistEnabled()).to.be.false;

      await usdc.mint(stranger.address, usdc6(10));
      await usdc.connect(stranger).approve(vaultAddr, usdc6(10));

      await expect(
        vault.connect(stranger).deposit(usdc6(10), stranger.address)
      ).to.not.be.reverted;
    });

    it("setAllowlistEnabled emits AllowlistEnabledSet", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(vault.connect(admin).setAllowlistEnabled(false))
        .to.emit(vault, "AllowlistEnabledSet").withArgs(false);
    });

    it("setAllowlistEnabled requires DEFAULT_ADMIN_ROLE", async function () {
      const { vault, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(keeper).setAllowlistEnabled(false)
      ).to.be.reverted;
    });
  });

  // ===========================================================================
  // 4. deposit() / mint()
  // ===========================================================================

  describe("deposit()", function () {
    it("mints yrUSDC shares and increases totalAssets", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount = usdc6(100);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      const totalBefore  = await vault.totalAssets();
      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).deposit(amount, user1.address);

      expect(await vault.totalAssets()).to.equal(totalBefore + amount);
      expect(await vault.balanceOf(user1.address)).to.be.gt(sharesBefore);
    });

    it("emits Deposit event", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount = usdc6(50);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      await expect(
        vault.connect(user1).deposit(amount, user1.address)
      ).to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, amount, anyValue);
    });

    it("receiver gets the shares (receiver != caller)", async function () {
      const { vault, usdc, signers: { user1, user2 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount = usdc6(100);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user2.address);

      expect(await vault.balanceOf(user2.address)).to.be.gt(0n);
      expect(await vault.balanceOf(user1.address)).to.equal(0n);
    });

    it("reverts DepositsArePaused in Paused mode", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).pause();
      await usdc.mint(user1.address, usdc6(50));
      await usdc.connect(user1).approve(vaultAddr, usdc6(50));

      await expect(
        vault.connect(user1).deposit(usdc6(50), user1.address)
      ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
    });

    it("reverts DepositsArePaused in EmergencyExit mode", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).setEmergencyExit();
      await usdc.mint(user1.address, usdc6(50));
      await usdc.connect(user1).approve(vaultAddr, usdc6(50));

      await expect(
        vault.connect(user1).deposit(usdc6(50), user1.address)
      ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
    });

    it("shares are proportional to PPS (two equal deposits get equal shares)", async function () {
      const { vault, usdc, signers: { user1, user2 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount = usdc6(100);

      for (const signer of [user1, user2]) {
        await usdc.mint(signer.address, amount);
        await usdc.connect(signer).approve(vaultAddr, amount);
        await vault.connect(signer).deposit(amount, signer.address);
      }

      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);
      expect(shares1).to.equal(shares2);
    });
  });

  describe("mint()", function () {
    it("pulls required USDC and delivers exact target shares", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const targetShares = units18(50);
      const required     = await vault.previewMint(targetShares);

      await usdc.mint(user1.address, required);
      await usdc.connect(user1).approve(vaultAddr, required);

      await vault.connect(user1).mint(targetShares, user1.address);
      expect(await vault.balanceOf(user1.address)).to.equal(targetShares);
    });

    it("reverts DepositsArePaused in Paused mode", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).pause();
      await usdc.mint(user1.address, usdc6(200));
      await usdc.connect(user1).approve(vaultAddr, usdc6(200));

      await expect(
        vault.connect(user1).mint(units18(50), user1.address)
      ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
    });
  });

  // ===========================================================================
  // 5. depositWithMinShares()
  // ===========================================================================

  describe("depositWithMinShares()", function () {
    it("succeeds when minted shares == minShares (exact)", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(100);
      const expected  = await vault.previewDeposit(amount);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      await expect(
        vault.connect(user1).depositWithMinShares(amount, user1.address, expected)
      ).to.not.be.reverted;
    });

    it("succeeds when minShares is 0 (no guard)", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(50);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      await expect(
        vault.connect(user1).depositWithMinShares(amount, user1.address, 0n)
      ).to.not.be.reverted;
    });

    it("reverts MinSharesNotMet when minShares > actual shares", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(100);
      const tooHigh   = (await vault.previewDeposit(amount)) + units18(1);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      await expect(
        vault.connect(user1).depositWithMinShares(amount, user1.address, tooHigh)
      ).to.be.revertedWithCustomError(vault, "MinSharesNotMet");
    });

    it("reverts DepositsArePaused in Paused mode (inherits from _depositCore)", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).pause();
      await usdc.mint(user1.address, usdc6(100));
      await usdc.connect(user1).approve(vaultAddr, usdc6(100));

      await expect(
        vault.connect(user1).depositWithMinShares(usdc6(100), user1.address, 0n)
      ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
    });

    it("returns same shares as deposit() for identical inputs", async function () {
      const { vault, usdc, signers: { user1, user2 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(100);

      // user1: regular deposit
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);
      const shares1 = await vault.balanceOf(user1.address);

      // user2: depositWithMinShares (minShares=0 → no constraint)
      await usdc.mint(user2.address, amount);
      await usdc.connect(user2).approve(vaultAddr, amount);
      await vault.connect(user2).depositWithMinShares(amount, user2.address, 0n);
      const shares2 = await vault.balanceOf(user2.address);

      expect(shares1).to.equal(shares2);
    });
  });

  // ===========================================================================
  // 6. redeem() / withdraw()
  // ===========================================================================

  describe("redeem()", function () {
    async function setupDeposit(
      fixture: Awaited<ReturnType<typeof deployV21Fixture>>,
      amount: bigint
    ) {
      const { vault, usdc, signers: { user1 } } = fixture;
      const vaultAddr = await vault.getAddress();
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);
    }

    it("burns shares and transfers USDC to receiver", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { user1 } } = fixture;

      await setupDeposit(fixture, usdc6(100));

      const shares     = await vault.balanceOf(user1.address);
      const usdcBefore = await usdc.balanceOf(user1.address);

      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0n);
      expect(await usdc.balanceOf(user1.address)).to.be.gt(usdcBefore);
    });

    it("emits Withdraw event", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { user1 } } = fixture;

      await setupDeposit(fixture, usdc6(50));
      const shares = await vault.balanceOf(user1.address);

      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.emit(vault, "Withdraw");
    });

    it("pre-pull: vault pulls from CSM when idle < requested", async function () {
      // After fixture + 100 USDC deposit: vault idle ≈ 11 USDC, CSM ≈ 99 USDC
      // Redeeming 80 USDC requires pre-pull from CSM.
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { user1 } } = fixture;

      await setupDeposit(fixture, usdc6(100));

      // Vault idle is ≈ 11 USDC. Withdraw 60 USDC — requires pre-pull.
      const withdrawAmt = usdc6(60);
      const usdcBefore  = await usdc.balanceOf(user1.address);

      await expect(
        vault.connect(user1).withdraw(withdrawAmt, user1.address, user1.address)
      ).to.not.be.reverted;

      expect(await usdc.balanceOf(user1.address) - usdcBefore).to.equal(withdrawAmt);
    });

    it("redeem works in Paused mode (redeems not blocked)", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { admin, user1 } } = fixture;

      await setupDeposit(fixture, usdc6(100));
      await vault.connect(admin).pause();

      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.not.be.reverted;
    });

    it("reverts RedeemsArePaused in EmergencyExit mode", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { admin, user1 } } = fixture;

      await setupDeposit(fixture, usdc6(100));
      await vault.connect(admin).setEmergencyExit();

      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "RedeemsArePaused");
    });

    it("approved spender can redeem on owner's behalf", async function () {
      const fixture = await loadFixture(deployV21Fixture);
      const { vault, usdc, signers: { user1, user2 } } = fixture;

      await setupDeposit(fixture, usdc6(100));
      const shares = await vault.balanceOf(user1.address);

      // user1 approves user2 to spend shares
      await vault.connect(user1).approve(user2.address, shares);

      await expect(
        vault.connect(user2).redeem(shares, user2.address, user1.address)
      ).to.not.be.reverted;

      expect(await vault.balanceOf(user1.address)).to.equal(0n);
    });
  });

  describe("withdraw()", function () {
    it("burns correct shares and transfers exact assets", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr   = await vault.getAddress();
      const dep         = usdc6(200);
      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      const withdrawAmt = usdc6(50);
      const usdcBefore  = await usdc.balanceOf(user1.address);

      await vault.connect(user1).withdraw(withdrawAmt, user1.address, user1.address);

      expect(await usdc.balanceOf(user1.address) - usdcBefore).to.equal(withdrawAmt);
    });

    it("reverts RedeemsArePaused in EmergencyExit mode", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const dep       = usdc6(100);
      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      await vault.connect(admin).setEmergencyExit();

      await expect(
        vault.connect(user1).withdraw(usdc6(50), user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "RedeemsArePaused");
    });
  });

  // ===========================================================================
  // 7. Auto-rebalance (via deposit / redeem)
  // ===========================================================================

  describe("_autoRebalance", function () {
    it("reserve lands within band after a large deposit (push path)", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(500);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);
      await vault.connect(user1).deposit(amount, user1.address);

      const total      = await vault.totalAssets();
      const vaultIdle  = await usdc.balanceOf(vaultAddr);
      const reserveBps = (vaultIdle * BPS) / total;

      expect(reserveBps).to.be.gte(MIN_RESERVE_BPS);
      expect(reserveBps).to.be.lte(MAX_RESERVE_BPS);
    });

    it("emits RebalanceTriggered(direction=1) on push to CSM", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const amount    = usdc6(200);

      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      await expect(
        vault.connect(user1).deposit(amount, user1.address)
      ).to.emit(vault, "RebalanceTriggered").withArgs(anyValue, 1, anyValue);
    });

    it("reserve stays in band after half-redeem (pull path)", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      // Deposit 500 USDC → push most to CSM
      const dep = usdc6(500);
      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      // Redeem half the shares — triggers pre-pull + autoRebalance
      const halfShares = (await vault.balanceOf(user1.address)) / 2n;
      await vault.connect(user1).redeem(halfShares, user1.address, user1.address);

      const total      = await vault.totalAssets();
      const vaultIdle  = await usdc.balanceOf(vaultAddr);
      if (total === 0n) return; // edge: full redemption
      const reserveBps = (vaultIdle * BPS) / total;

      // Allow ±200bps tolerance for rounding in pull/push sequence
      expect(reserveBps).to.be.gte(MIN_RESERVE_BPS - 200n);
      expect(reserveBps).to.be.lte(MAX_RESERVE_BPS + 200n);
    });

    it("skips rebalance when CSM is address(0)", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      await vault.connect(admin).setCoreStrategyManager(ethers.ZeroAddress);

      const amount = usdc6(50);
      await usdc.mint(user1.address, amount);
      await usdc.connect(user1).approve(vaultAddr, amount);

      // No RebalanceTriggered event should be emitted
      const tx      = await vault.connect(user1).deposit(amount, user1.address);
      const receipt = await tx.wait();

      const rebalanceSig = vault.interface.getEvent("RebalanceTriggered").topicHash;
      const triggered = receipt?.logs.some(l => l.topics[0] === rebalanceSig) ?? false;
      expect(triggered).to.be.false;
    });

    it("skips rebalance in Paused mode after redeem", async function () {
      const { vault, usdc, signers: { admin, user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();

      // Deposit while Normal
      const dep = usdc6(100);
      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      // Pause, then redeem — redeem is allowed, but _autoRebalance should skip
      await vault.connect(admin).pause();

      const shares = (await vault.balanceOf(user1.address)) / 2n;
      const tx     = await vault.connect(user1).redeem(shares, user1.address, user1.address);
      const receipt = await tx.wait();

      const rebalanceSig = vault.interface.getEvent("RebalanceTriggered").topicHash;
      const triggered = receipt?.logs.some(l => l.topics[0] === rebalanceSig) ?? false;
      expect(triggered).to.be.false;
    });
  });

  // ===========================================================================
  // 8. Manual rebalance()
  // ===========================================================================

  describe("rebalance()", function () {
    it("admin can call rebalance after cooldown", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n); // 1 hour + 1 second
      await expect(vault.connect(admin).rebalance()).to.not.be.reverted;
    });

    it("keeper can call rebalance after cooldown", async function () {
      const { vault, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n);
      await expect(vault.connect(keeper).rebalance()).to.not.be.reverted;
    });

    it("emits ManualRebalance event", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n);
      await expect(vault.connect(admin).rebalance())
        .to.emit(vault, "ManualRebalance");
    });

    it("reverts RebalanceCooldown if called again within 1 hour", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n);
      await vault.connect(admin).rebalance(); // first succeeds

      await expect(
        vault.connect(admin).rebalance()
      ).to.be.revertedWithCustomError(vault, "RebalanceCooldown");
    });

    it("succeeds again after cooldown elapses between calls", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n);
      await vault.connect(admin).rebalance();
      await advanceTime(3_601n);
      await expect(vault.connect(admin).rebalance()).to.not.be.reverted;
    });

    it("non-admin/keeper reverts Unauthorized", async function () {
      const { vault, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await advanceTime(3_601n);
      await expect(
        vault.connect(user1).rebalance()
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("setRebalanceCooldown(0) allows consecutive rebalance() calls", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).setRebalanceCooldown(0n);
      await vault.connect(admin).rebalance();
      await expect(vault.connect(admin).rebalance()).to.not.be.reverted;
    });

    it("setRebalanceCooldown requires DEFAULT_ADMIN_ROLE", async function () {
      const { vault, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(keeper).setRebalanceCooldown(0n)
      ).to.be.reverted; // OZ AccessControl revert
    });
  });

  // ===========================================================================
  // 9. System modes
  // ===========================================================================

  describe("system modes", function () {
    it("pause() → Paused (1), emits SystemModeChanged", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(vault.connect(admin).pause())
        .to.emit(vault, "SystemModeChanged").withArgs(1);
      expect(await vault.systemMode()).to.equal(1);
    });

    it("unpause() → Normal (0), emits SystemModeChanged", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).pause();
      await expect(vault.connect(admin).unpause())
        .to.emit(vault, "SystemModeChanged").withArgs(0);
      expect(await vault.systemMode()).to.equal(0);
    });

    it("setEmergencyExit() → EmergencyExit (2), emits SystemModeChanged", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await expect(vault.connect(admin).setEmergencyExit())
        .to.emit(vault, "SystemModeChanged").withArgs(2);
      expect(await vault.systemMode()).to.equal(2);
    });

    it("EMERGENCY_ROLE can pause", async function () {
      const { vault, signers: { admin, keeper } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).grantRole(EMERGENCY_ROLE, keeper.address);
      await expect(vault.connect(keeper).pause()).to.not.be.reverted;
    });

    it("EMERGENCY_ROLE can setEmergencyExit", async function () {
      const { vault, signers: { admin, keeper } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).grantRole(EMERGENCY_ROLE, keeper.address);
      await expect(vault.connect(keeper).setEmergencyExit()).to.not.be.reverted;
    });

    it("only DEFAULT_ADMIN_ROLE can unpause (EMERGENCY_ROLE cannot)", async function () {
      const { vault, signers: { admin, keeper } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).grantRole(EMERGENCY_ROLE, keeper.address);
      await vault.connect(keeper).pause();
      // keeper holds EMERGENCY_ROLE but not DEFAULT_ADMIN_ROLE → should revert
      await expect(vault.connect(keeper).unpause()).to.be.reverted;
    });

    it("unauthorized address cannot pause", async function () {
      const { vault, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(user1).pause()
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("unauthorized address cannot setEmergencyExit", async function () {
      const { vault, signers: { user1 } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(user1).setEmergencyExit()
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });
  });

  // ===========================================================================
  // 10. Admin configuration
  // ===========================================================================

  describe("setCoreStrategyManager()", function () {
    it("updates address and emits CoreStrategyManagerSet", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      const newAddr = ethers.Wallet.createRandom().address;

      await expect(vault.connect(admin).setCoreStrategyManager(newAddr))
        .to.emit(vault, "CoreStrategyManagerSet").withArgs(newAddr);
      expect(await vault.coreStrategyManager()).to.equal(newAddr);
    });

    it("accepts address(0) to disconnect CSM", async function () {
      const { vault, signers: { admin } } = await loadFixture(deployV21Fixture);
      await vault.connect(admin).setCoreStrategyManager(ethers.ZeroAddress);
      expect(await vault.coreStrategyManager()).to.equal(ethers.ZeroAddress);
    });

    it("reverts for non-admin", async function () {
      const { vault, signers: { keeper } } = await loadFixture(deployV21Fixture);
      await expect(
        vault.connect(keeper).setCoreStrategyManager(ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  // ===========================================================================
  // 11. InsufficientVaultLiquidity
  // ===========================================================================

  describe("InsufficientVaultLiquidity", function () {
    it("reverts when CSM cannot cover the full shortfall", async function () {
      // Setup: user deposits 100 USDC, vault pushes 90 USDC to CSM (idle, not invested)
      // Then invest CSM idle into MockStrategy, make strategy fail divest → CSM can't withdraw
      const { vault, usdc, csm, coreMockStrategy, signers: { admin, user1 } } =
        await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const csmAddr   = await csm.getAddress();

      // user1 deposits 100 USDC
      const dep = usdc6(100);
      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      // Admin invests all CSM idle into MockStrategy (push model: transfer then invest())
      const csmIdle = await usdc.balanceOf(csmAddr);
      await csm.connect(admin).invest(csmIdle); // CSM pushes to strategy

      // Make strategy divest fail
      await coreMockStrategy.connect(admin).setFailDivest(true);

      // Now vault has ~11 USDC idle, CSM has 0 idle, strategy won't divest
      // Attempting to redeem 80 USDC (> vault idle) should trigger InsufficientVaultLiquidity
      const shares80 = await vault.convertToShares(usdc6(80));

      await expect(
        vault.connect(user1).redeem(shares80, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "InsufficientVaultLiquidity");
    });

    it("redeem succeeds up to total available (vault idle + CSM idle)", async function () {
      const { vault, usdc, signers: { user1 } } = await loadFixture(deployV21Fixture);
      const vaultAddr = await vault.getAddress();
      const dep       = usdc6(100);

      await usdc.mint(user1.address, dep);
      await usdc.connect(user1).approve(vaultAddr, dep);
      await vault.connect(user1).deposit(dep, user1.address);

      // Withdraw exactly 60 USDC — vault idle ≈ 11, needs pre-pull of 49 from CSM
      const withdrawAmt = usdc6(60);
      const usdcBefore  = await usdc.balanceOf(user1.address);

      await vault.connect(user1).withdraw(withdrawAmt, user1.address, user1.address);

      expect(await usdc.balanceOf(user1.address) - usdcBefore).to.equal(withdrawAmt);
    });
  });

});
