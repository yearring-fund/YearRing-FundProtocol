import { expect } from "chai";
import { ethers } from "hardhat";
import {
  LockLedgerV02, LockBenefitV02, LockRewardManagerV02,
  FundVaultV01, MockUSDC, RewardToken
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Tier reward amount alignment tests.
 *
 * Reward token formula (contract constants):
 *   tokens = lockedUSDCValue × USDC_TO_TOKEN_SCALE × durationDays × multiplierBps
 *            / REWARD_DENOMINATOR
 *   where USDC_TO_TOKEN_SCALE = 1e12, REWARD_DENOMINATOR = 10_000 × 500 = 5_000_000
 *
 * Rebate formula (contract constants):
 *   rebate = lockedShares × mgmtFeeBps × discountBps × elapsed
 *            / (BPS_DENOMINATOR² × SECONDS_PER_MONTH)
 *   where BPS_DENOMINATOR = 10_000, SECONDS_PER_MONTH = 30 days
 *
 * Setup: Alice deposits 1000 USDC → 1000e18 shares.
 *   convertToAssets(1000e18) = 1000e6 exactly (math shown in formula comments).
 *   mgmtFeeBpsPerMonth = 100 (1%/month) set explicitly.
 */
describe("LockRewardManager — tier reward amounts", function () {
  let ledger:   LockLedgerV02;
  let benefit:  LockBenefitV02;
  let manager:  LockRewardManagerV02;
  let vault:    FundVaultV01;
  let usdc:     MockUSDC;
  let rwToken:  RewardToken;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;

  const D6  = (n: number) => ethers.parseUnits(String(n), 6);
  const D18 = (n: number) => ethers.parseUnits(String(n), 18);
  const DAY  = 86_400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;
  const D180 = 180n * DAY;

  // Mirror contract constants for expected-value calculation
  const BPS_DENOMINATOR    = 10_000n;
  const REWARD_DENOMINATOR = 5_000_000n; // 10_000 × 500
  const USDC_SCALE         = 1_000_000_000_000n; // 1e12
  const MONTH              = 30n * DAY;

  // Tier multipliers (bps)
  const BRONZE_MULT = 10_000n;
  const SILVER_MULT = 13_000n;
  const GOLD_MULT   = 18_000n;

  // Tier fee discounts (bps)
  const BRONZE_DISC = 2_000n;
  const SILVER_DISC = 4_000n;
  const GOLD_DISC   = 6_000n;

  const MGMT_FEE_BPS = 100n; // 1% / month

  let aliceShares: bigint;

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  async function lockAndGetId(shares: bigint, duration: bigint): Promise<bigint> {
    const tx = await manager.connect(alice).lockWithReward(shares, duration);
    const receipt = await tx.wait();
    const ev = receipt!.logs
      .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "LockedWithReward");
    return ev!.args.lockId;
  }

  /** Expected reward tokens for a tier lock (pure formula, no rounding) */
  function expectedTokens(usdcRaw: bigint, durationDays: bigint, multBps: bigint): bigint {
    return usdcRaw * USDC_SCALE * durationDays * multBps / REWARD_DENOMINATOR;
  }

  /** Expected rebate for a full-duration claim (elapsed = duration, cancels MONTH) */
  function expectedRebate(shares: bigint, discountBps: bigint, durationSeconds: bigint): bigint {
    return shares * MGMT_FEE_BPS * discountBps * durationSeconds
           / (BPS_DENOMINATOR * BPS_DENOMINATOR * MONTH);
  }

  beforeEach(async function () {
    [, admin, guardian, treasury, alice] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
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
      treasury.address,
      admin.address,
      guardian.address
    );

    // OPERATOR_ROLE on ledger → manager
    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());

    // Alice deposits 1000 USDC → gets shares
    // NOTE: mgmtFee is 0 here so _deposit → accrueManagementFee mints nothing.
    //   convertToAssets(aliceShares) will be exactly 1000e6 = 1000 USDC.
    await usdc.mint(alice.address, D6(1_000));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(1_000));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    aliceShares = await vault.balanceOf(alice.address);

    // Treasury deposits 200 USDC → gets vault shares to fund rebate payouts
    // Still at mgmtFee = 0; no fee shares minted during this deposit.
    await usdc.mint(treasury.address, D6(200));
    await usdc.connect(treasury).approve(await vault.getAddress(), D6(200));
    await vault.connect(admin).addToAllowlist(treasury.address);
    await vault.connect(treasury).deposit(D6(200), treasury.address);

    // Set mgmt fee AFTER all deposits so accrueManagementFee during deposit
    // does not mint fee shares and dilute convertToAssets(aliceShares).
    await vault.connect(admin).setMgmtFeeBpsPerMonth(Number(MGMT_FEE_BPS));

    // Treasury approves manager: reward tokens (upfront issuance) + vault shares (rebate)
    await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);
    await vault.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

    // Alice approves vault shares to ledger (lockWithReward pulls from alice)
    await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
  });

  // -------------------------------------------------------------------------
  // Reward tokens — issued upfront at lock time
  // -------------------------------------------------------------------------

  describe("reward tokens — upfront issuance", function () {
    it("Bronze (30d): issues 60 RWT for 1000 USDC", async function () {
      // lockedUSDCValue = 1000e6, days = 30, mult = 10_000
      // tokens = 1000e6 × 1e12 × 30 × 10000 / 5_000_000 = 60e18
      const expected = expectedTokens(D6(1_000), 30n, BRONZE_MULT);
      expect(expected).to.equal(D18(60));

      const id = await lockAndGetId(aliceShares, D30);
      expect(await manager.issuedRewardTokens(id)).to.equal(expected);
      expect(await rwToken.balanceOf(alice.address)).to.equal(expected);
    });

    it("Silver (90d): issues 234 RWT for 1000 USDC", async function () {
      // lockedUSDCValue = 1000e6, days = 90, mult = 13_000
      // tokens = 1000e6 × 1e12 × 90 × 13000 / 5_000_000 = 234e18
      const expected = expectedTokens(D6(1_000), 90n, SILVER_MULT);
      expect(expected).to.equal(D18(234));

      const id = await lockAndGetId(aliceShares, D90);
      expect(await manager.issuedRewardTokens(id)).to.equal(expected);
      expect(await rwToken.balanceOf(alice.address)).to.equal(expected);
    });

    it("Gold (180d): issues 648 RWT for 1000 USDC", async function () {
      // lockedUSDCValue = 1000e6, days = 180, mult = 18_000
      // tokens = 1000e6 × 1e12 × 180 × 18000 / 5_000_000 = 648e18
      const expected = expectedTokens(D6(1_000), 180n, GOLD_MULT);
      expect(expected).to.equal(D18(648));

      const id = await lockAndGetId(aliceShares, D180);
      expect(await manager.issuedRewardTokens(id)).to.equal(expected);
      expect(await rwToken.balanceOf(alice.address)).to.equal(expected);
    });

    it("Silver/Bronze reward ratio = 3.9× (duration 3× × multiplier 1.3×)", async function () {
      const bronze = expectedTokens(D6(1_000), 30n, BRONZE_MULT);
      const silver = expectedTokens(D6(1_000), 90n, SILVER_MULT);
      // silver / bronze = 234 / 60 = 3.9 → silver * 10 == bronze * 39
      expect(silver * 10n).to.equal(bronze * 39n);
    });

    it("Gold/Bronze reward ratio = 10.8× (duration 6× × multiplier 1.8×)", async function () {
      const bronze = expectedTokens(D6(1_000), 30n, BRONZE_MULT);
      const gold   = expectedTokens(D6(1_000), 180n, GOLD_MULT);
      // gold / bronze = 648 / 60 = 10.8 → gold * 10 == bronze * 108
      expect(gold * 10n).to.equal(bronze * 108n);
    });
  });

  // -------------------------------------------------------------------------
  // Management fee rebate — linear accrual, claimed after full duration
  // -------------------------------------------------------------------------

  describe("rebate — full-duration claim", function () {
    it("Bronze (30d): rebate = 2 shares at 1% fee with 20% discount", async function () {
      // rebate = 1000e18 × 100 × 2000 × D30 / (1e4² × D30) = 2e18
      // MONTH = D30, so elapsed/MONTH = 1 → 1000e18 × 100 × 2000 / 1e8 = 2e18
      const expected = expectedRebate(aliceShares, BRONZE_DISC, D30);
      expect(expected).to.equal(D18(2));

      const id = await lockAndGetId(aliceShares, D30);
      expect(await manager.previewRebate(id)).to.equal(0n); // nothing accrued yet

      await advance(D30);

      expect(await manager.previewRebate(id)).to.equal(expected);
      await manager.connect(alice).claimRebate(id);
      // alice should have received exactly 2 shares from treasury
      expect(await vault.balanceOf(alice.address)).to.equal(expected);
    });

    it("Silver (90d): rebate = 12 shares at 1% fee with 40% discount", async function () {
      // rebate = 1000e18 × 100 × 4000 × D90 / (1e4² × D30)
      //        = 1000e18 × 100 × 4000 × 3 / 1e8 = 12e18
      const expected = expectedRebate(aliceShares, SILVER_DISC, D90);
      expect(expected).to.equal(D18(12));

      const id = await lockAndGetId(aliceShares, D90);
      await advance(D90);

      expect(await manager.previewRebate(id)).to.equal(expected);
      await manager.connect(alice).claimRebate(id);
      expect(await vault.balanceOf(alice.address)).to.equal(expected);
    });

    it("Gold (180d): rebate = 36 shares at 1% fee with 60% discount", async function () {
      // rebate = 1000e18 × 100 × 6000 × D180 / (1e4² × D30)
      //        = 1000e18 × 100 × 6000 × 6 / 1e8 = 36e18
      const expected = expectedRebate(aliceShares, GOLD_DISC, D180);
      expect(expected).to.equal(D18(36));

      const id = await lockAndGetId(aliceShares, D180);
      await advance(D180);

      expect(await manager.previewRebate(id)).to.equal(expected);
      await manager.connect(alice).claimRebate(id);
      expect(await vault.balanceOf(alice.address)).to.equal(expected);
    });

    it("Silver/Bronze rebate ratio = 6× (duration 3× × discount 2×)", async function () {
      const bronze = expectedRebate(aliceShares, BRONZE_DISC, D30);
      const silver = expectedRebate(aliceShares, SILVER_DISC, D90);
      expect(silver).to.equal(bronze * 6n);
    });

    it("Gold/Bronze rebate ratio = 18× (duration 6× × discount 3×)", async function () {
      const bronze = expectedRebate(aliceShares, BRONZE_DISC, D30);
      const gold   = expectedRebate(aliceShares, GOLD_DISC, D180);
      expect(gold).to.equal(bronze * 18n);
    });
  });

  // -------------------------------------------------------------------------
  // Rebate: partial accrual and capped at unlockAt
  // -------------------------------------------------------------------------

  describe("rebate — partial accrual", function () {
    it("rebate is proportional to elapsed time (halfway through Bronze)", async function () {
      const id = await lockAndGetId(aliceShares, D30);

      await advance(D30 / 2n);
      const halfRebate = await manager.previewRebate(id);

      await advance(D30 / 2n);
      const fullRebate = await manager.previewRebate(id);

      // full = 2e18; half ≈ 1e18
      expect(fullRebate).to.equal(D18(2));
      expect(halfRebate * 2n).to.equal(fullRebate);
    });

    it("rebate caps at unlockAt even if claim is delayed post-maturity", async function () {
      const id = await lockAndGetId(aliceShares, D30);
      await advance(D30);
      const atMaturity = await manager.previewRebate(id);

      await advance(DAY * 10n); // 10 days after maturity
      const afterDelay = await manager.previewRebate(id);

      expect(atMaturity).to.equal(afterDelay); // no extra accrual past unlockAt
    });

    it("second claimRebate returns 0 if called in same block as first", async function () {
      const id = await lockAndGetId(aliceShares, D30);
      await advance(D30);

      await manager.connect(alice).claimRebate(id);
      // After claiming, lastRebateClaimedAt = unlockAt; effectiveNow = unlockAt → elapsed = 0
      expect(await manager.previewRebate(id)).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // Revert guards
  // -------------------------------------------------------------------------

  describe("revert guards", function () {
    it("lockWithReward reverts with InsufficientVaultSharesAllowance when not approved to ledger", async function () {
      // Reset alice's approval to 0
      await vault.connect(alice).approve(await ledger.getAddress(), 0n);
      await expect(manager.connect(alice).lockWithReward(aliceShares, D30))
        .to.be.revertedWithCustomError(manager, "InsufficientVaultSharesAllowance");
    });

    it("lockWithReward reverts with InsufficientRewardTokenAllowance when treasury has not approved", async function () {
      await rwToken.connect(treasury).approve(await manager.getAddress(), 0n);
      await expect(manager.connect(alice).lockWithReward(aliceShares, D30))
        .to.be.revertedWithCustomError(manager, "InsufficientRewardTokenAllowance");
    });

    it("claimRebate reverts with InsufficientVaultSharesAllowance when treasury vault shares not approved", async function () {
      await vault.connect(treasury).approve(await manager.getAddress(), 0n);
      const id = await lockAndGetId(aliceShares, D30);
      await advance(D30);
      await expect(manager.connect(alice).claimRebate(id))
        .to.be.revertedWithCustomError(manager, "InsufficientVaultSharesAllowance");
    });

    it("claimRebate reverts when called after unlock", async function () {
      const id = await lockAndGetId(aliceShares, D30);
      await advance(D30);
      await ledger.connect(alice).unlock(id);
      await expect(manager.connect(alice).claimRebate(id))
        .to.be.revertedWithCustomError(manager, "LockNotActive");
    });
  });
});
