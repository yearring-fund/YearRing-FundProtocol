import { expect } from "chai";
import { ethers } from "hardhat";
import {
  FundVaultV01, LockLedgerV02, LockBenefitV02,
  LockRewardManagerV02, BeneficiaryModuleV02, MockUSDC, RewardToken,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Accounting.test.ts — V2 accounting invariant suite
 *
 * Verifies that V2 lock / rebate / earlyExit paths do NOT break FundVaultV01 accounting.
 * All three paths are pure ERC20 transfers — no mint, no burn — so vault NAV must be stable.
 *
 * Four groups per d12Accouting.md:
 *   1. lockWithReward     — totalAssets/totalSupply unchanged; shares move user → ledger
 *   2. claimRebate        — totalAssets/totalSupply unchanged; shares move treasury → user
 *   3. earlyExitWithReturn — totalAssets/totalSupply unchanged; shares return ledger → user
 *   4. Append-only counter — nextLockId / totalLocksEver never decrements
 */
describe("Accounting invariants — V2 paths do not break vault accounting", function () {
  let vault:   FundVaultV01;
  let ledger:  LockLedgerV02;
  let benefit: LockBenefitV02;
  let manager: LockRewardManagerV02;
  let usdc:    MockUSDC;
  let rwToken: RewardToken;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;

  const D6  = (n: number) => ethers.parseUnits(String(n), 6);
  const D18 = (n: number) => ethers.parseUnits(String(n), 18);
  const DAY = 86_400n;

  // Bronze: 30d lock, discount = 25%, multiplier = 1×
  const LOCK_DURATION = Number(30n * DAY);
  const MGMT_FEE_BPS  = 100n;  // 1% / month

  let aliceShares:    bigint;
  let treasuryShares: bigint;

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    [, admin, guardian, treasury, alice] = await ethers.getSigners();

    usdc    = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault   = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "Fund Vault Shares", "fbUSDC",
      treasury.address, admin.address
    );
    ledger  = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
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

    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());

    // All deposits first — mgmtFee set AFTER to avoid fee dilution skewing convertToAssets
    await usdc.mint(alice.address,    D6(1_000));
    await usdc.mint(treasury.address, D6(500));

    await usdc.connect(alice).approve(await vault.getAddress(), D6(1_000));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(1_000), alice.address);

    await usdc.connect(treasury).approve(await vault.getAddress(), D6(500));
    await vault.connect(admin).addToAllowlist(treasury.address);
    await vault.connect(treasury).deposit(D6(500), treasury.address);

    aliceShares    = await vault.balanceOf(alice.address);
    treasuryShares = await vault.balanceOf(treasury.address);

    // Set fee rate AFTER all deposits
    await vault.connect(admin).setMgmtFeeBpsPerMonth(Number(MGMT_FEE_BPS));

    // Approvals
    await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
    await vault.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);
    await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);
  });

  // ─── Group 1: lockWithReward ──────────────────────────────────────────────────
  //
  // Shares transfer from alice → ledger (ERC20 transferFrom).
  // No USDC moves in or out of the vault → totalAssets unchanged.
  // No shares minted or burned          → totalSupply unchanged.

  describe("Group 1 — lockWithReward: vault accounting unchanged", function () {
    it("vault.totalAssets() is unchanged before and after lockWithReward", async function () {
      const assetsBefore = await vault.totalAssets();
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      expect(await vault.totalAssets()).to.equal(assetsBefore);
    });

    it("vault.totalSupply() is unchanged before and after lockWithReward", async function () {
      const supplyBefore = await vault.totalSupply();
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      expect(await vault.totalSupply()).to.equal(supplyBefore);
    });

    it("alice vault.balanceOf decreases by exactly the locked shares", async function () {
      const lockAmount = aliceShares / 2n;
      const aliceBefore = await vault.balanceOf(alice.address);
      await manager.connect(alice).lockWithReward(lockAmount, LOCK_DURATION);
      expect(await vault.balanceOf(alice.address)).to.equal(aliceBefore - lockAmount);
    });

    it("ledger.totalLockedShares() increases by exactly the locked shares", async function () {
      const lockAmount   = aliceShares / 2n;
      const lockedBefore = await ledger.totalLockedShares();
      await manager.connect(alice).lockWithReward(lockAmount, LOCK_DURATION);
      expect(await ledger.totalLockedShares()).to.equal(lockedBefore + lockAmount);
    });

    it("ledger contract vault.balanceOf increases by exactly the locked shares", async function () {
      const lockAmount    = aliceShares / 2n;
      const ledgerAddr    = await ledger.getAddress();
      const ledgerBefore  = await vault.balanceOf(ledgerAddr);
      await manager.connect(alice).lockWithReward(lockAmount, LOCK_DURATION);
      expect(await vault.balanceOf(ledgerAddr)).to.equal(ledgerBefore + lockAmount);
    });

    it("alice.balanceOf + ledger.balanceOf = constant (shares only change hands)", async function () {
      const ledgerAddr = await ledger.getAddress();
      const sumBefore  = (await vault.balanceOf(alice.address)) + (await vault.balanceOf(ledgerAddr));
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      const sumAfter   = (await vault.balanceOf(alice.address)) + (await vault.balanceOf(ledgerAddr));
      expect(sumAfter).to.equal(sumBefore);
    });
  });

  // ─── Group 2: claimRebate ────────────────────────────────────────────────────
  //
  // Rebate shares transfer from treasury → alice (ERC20 transferFrom).
  // No USDC moves in or out of the vault → totalAssets unchanged.
  // No shares minted or burned          → totalSupply unchanged.
  // Rebate amount ≤ formula upper bound (full-duration max).

  describe("Group 2 — claimRebate: vault accounting unchanged", function () {
    let lockId: bigint;

    beforeEach(async function () {
      lockId = await manager.connect(alice).lockWithReward.staticCall(aliceShares, LOCK_DURATION);
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      await advance(15n * DAY); // half duration
    });

    it("vault.totalAssets() is unchanged before and after claimRebate", async function () {
      const assetsBefore = await vault.totalAssets();
      await manager.connect(alice).claimRebate(lockId);
      expect(await vault.totalAssets()).to.equal(assetsBefore);
    });

    it("vault.totalSupply() is unchanged before and after claimRebate", async function () {
      const supplyBefore = await vault.totalSupply();
      await manager.connect(alice).claimRebate(lockId);
      expect(await vault.totalSupply()).to.equal(supplyBefore);
    });

    it("treasury.balanceOf decreases and alice.balanceOf increases by the same rebate amount", async function () {
      const treasuryBefore = await vault.balanceOf(treasury.address);
      const aliceBefore    = await vault.balanceOf(alice.address);

      await manager.connect(alice).claimRebate(lockId);

      const treasuryAfter = await vault.balanceOf(treasury.address);
      const aliceAfter    = await vault.balanceOf(alice.address);

      // Shares transferred out of treasury == shares received by alice
      const rebateTransferred = treasuryBefore - treasuryAfter;
      expect(rebateTransferred).to.be.gt(0n);
      expect(aliceAfter - aliceBefore).to.equal(rebateTransferred);
    });

    it("rebate is non-zero after 15 days (fee rate > 0, discount > 0)", async function () {
      const rebate = await manager.previewRebate(lockId);
      expect(rebate).to.be.gt(0n);
    });

    it("rebate does not exceed formula max (full duration, Bronze 25% discount)", async function () {
      // Max rebate = shares × mgmtFeeBps × discountBps × duration / (BPS² × SECONDS_PER_MONTH)
      // Bronze discountBps = 2500 (25%)
      const DISCOUNT_BPS       = 2500n;
      const SECONDS_PER_MONTH  = 30n * DAY;
      const maxRebate = aliceShares * MGMT_FEE_BPS * DISCOUNT_BPS * SECONDS_PER_MONTH
                        / (10_000n * 10_000n * SECONDS_PER_MONTH);

      const rebate = await manager.previewRebate(lockId);
      expect(rebate).to.be.lte(maxRebate);
    });

    it("treasury.balanceOf + alice.balanceOf = constant during rebate (shares only change hands)", async function () {
      const sumBefore = (await vault.balanceOf(treasury.address)) + (await vault.balanceOf(alice.address));
      await manager.connect(alice).claimRebate(lockId);
      const sumAfter  = (await vault.balanceOf(treasury.address)) + (await vault.balanceOf(alice.address));
      expect(sumAfter).to.equal(sumBefore);
    });
  });

  // ─── Group 3: earlyExitWithReturn ────────────────────────────────────────────
  //
  // earlyExitWithReturn atomically:
  //   (a) settles final rebate (treasury → alice shares)
  //   (b) pulls reward tokens back (alice → treasury rwToken)
  //   (c) releases locked shares (ledger → alice)
  //
  // No USDC moves → totalAssets unchanged.
  // No shares minted or burned → totalSupply unchanged.

  describe("Group 3 — earlyExitWithReturn: vault accounting unchanged", function () {
    let lockId:        bigint;
    let lockedAmount:  bigint;

    beforeEach(async function () {
      lockedAmount = aliceShares;
      lockId = await manager.connect(alice).lockWithReward.staticCall(lockedAmount, LOCK_DURATION);
      await manager.connect(alice).lockWithReward(lockedAmount, LOCK_DURATION);
      await advance(10n * DAY); // partial time elapsed

      // Approve reward tokens for return
      const issued = await manager.issuedRewardTokens(lockId);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
    });

    it("vault.totalAssets() is unchanged before and after earlyExitWithReturn", async function () {
      const assetsBefore = await vault.totalAssets();
      await manager.connect(alice).earlyExitWithReturn(lockId);
      expect(await vault.totalAssets()).to.equal(assetsBefore);
    });

    it("vault.totalSupply() is unchanged before and after earlyExitWithReturn", async function () {
      const supplyBefore = await vault.totalSupply();
      await manager.connect(alice).earlyExitWithReturn(lockId);
      expect(await vault.totalSupply()).to.equal(supplyBefore);
    });

    it("ledger.totalLockedShares() decreases by the full locked amount", async function () {
      const lockedBefore = await ledger.totalLockedShares();
      await manager.connect(alice).earlyExitWithReturn(lockId);
      expect(await ledger.totalLockedShares()).to.equal(lockedBefore - lockedAmount);
      expect(await ledger.totalLockedShares()).to.equal(0n);
    });

    it("alice vault.balanceOf increases by the full locked amount (principal fully returned)", async function () {
      const aliceBefore = await vault.balanceOf(alice.address);
      await manager.connect(alice).earlyExitWithReturn(lockId);
      // alice gets back locked shares (+ possible rebate from settle, but alice had 0 free shares)
      const aliceAfter = await vault.balanceOf(alice.address);
      expect(aliceAfter).to.be.gte(aliceBefore + lockedAmount);
    });

    it("treasury rwToken.balanceOf increases by the issued reward tokens", async function () {
      const issued          = await manager.issuedRewardTokens(lockId);
      const treasuryRWBefore = await rwToken.balanceOf(treasury.address);
      await manager.connect(alice).earlyExitWithReturn(lockId);
      expect(await rwToken.balanceOf(treasury.address)).to.equal(treasuryRWBefore + issued);
    });

    it("issuedRewardTokens[lockId] is cleared to 0 after earlyExit", async function () {
      await manager.connect(alice).earlyExitWithReturn(lockId);
      expect(await manager.issuedRewardTokens(lockId)).to.equal(0n);
    });

    it("ledger.balanceOf + alice.balanceOf = constant (shares return from ledger to alice)", async function () {
      const ledgerAddr = await ledger.getAddress();
      // Before exit: ledger holds lockedAmount, alice holds 0 free shares
      const ledgerBefore = await vault.balanceOf(ledgerAddr);
      const aliceBefore  = await vault.balanceOf(alice.address);
      const sumBefore    = ledgerBefore + aliceBefore;

      await manager.connect(alice).earlyExitWithReturn(lockId);

      const ledgerAfter = await vault.balanceOf(ledgerAddr);
      const aliceAfter  = await vault.balanceOf(alice.address);
      // alice also receives rebate from treasury, so sum changes by rebate amount
      // The conservation check is: ledger gave back exactly lockedAmount to alice
      expect(ledgerBefore - ledgerAfter).to.equal(lockedAmount);
      expect(aliceAfter - aliceBefore).to.be.gte(lockedAmount); // ≥ lockedAmount due to rebate
    });
  });

  // ─── Group 4: Append-only counter ────────────────────────────────────────────
  //
  // nextLockId = ledger.nextLockId() is a monotonically increasing counter.
  // It reflects total positions ever created, not currently active positions.
  // earlyExit must NOT decrement it.

  describe("Group 4 — append-only counter: nextLockId never decrements", function () {
    it("nextLockId starts at 0", async function () {
      expect(await ledger.nextLockId()).to.equal(0n);
    });

    it("nextLockId increments by 1 per lockWithReward", async function () {
      await manager.connect(alice).lockWithReward(aliceShares / 2n, LOCK_DURATION);
      expect(await ledger.nextLockId()).to.equal(1n);

      await manager.connect(alice).lockWithReward(aliceShares / 2n, LOCK_DURATION);
      expect(await ledger.nextLockId()).to.equal(2n);
    });

    it("nextLockId does NOT decrement after earlyExitWithReturn", async function () {
      const lockId = await manager.connect(alice).lockWithReward.staticCall(aliceShares, LOCK_DURATION);
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);

      const idAfterLock = await ledger.nextLockId();
      expect(idAfterLock).to.equal(1n);

      const issued = await manager.issuedRewardTokens(lockId);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(lockId);

      // Counter must remain at 1 — earlyExit does not roll back history
      expect(await ledger.nextLockId()).to.equal(idAfterLock);
    });

    it("nextLockId does NOT decrement after normal unlock", async function () {
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      const idAfterLock = await ledger.nextLockId();

      // Advance past unlock time
      await advance(31n * DAY);
      await ledger.connect(alice).unlock(0n);

      expect(await ledger.nextLockId()).to.equal(idAfterLock);
    });
  });

  // ─── Group 5: Pre-flight views (checkClaimRebate / checkEarlyExit) ───────────
  //
  // Frontend / script readiness checks.
  // Return the amounts needed to determine feasibility before submitting a TX.
  // Return all zeros when the lock is inactive, already exited, or mature.

  describe("Group 5 — pre-flight views: checkClaimRebate / checkEarlyExit", function () {
    let lockId: bigint;

    beforeEach(async function () {
      lockId = await manager.connect(alice).lockWithReward.staticCall(aliceShares, LOCK_DURATION);
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);
      await advance(15n * DAY);
    });

    // ── checkClaimRebate ──────────────────────────────────────────────────────

    it("checkClaimRebate: rebateShares matches previewRebate", async function () {
      const preview = await manager.previewRebate(lockId);
      const [rebate] = await manager.checkClaimRebate(lockId);
      // Allow 1-block drift between the two view calls
      expect(rebate).to.be.closeTo(preview, preview / 1000n + 1n);
    });

    it("checkClaimRebate: treasuryBalance equals vault.balanceOf(treasury)", async function () {
      const [, balance] = await manager.checkClaimRebate(lockId);
      expect(balance).to.equal(await vault.balanceOf(treasury.address));
    });

    it("checkClaimRebate: treasuryAllowance equals vault.allowance(treasury, manager)", async function () {
      const managerAddr = await manager.getAddress();
      const [,, allowance] = await manager.checkClaimRebate(lockId);
      expect(allowance).to.equal(await vault.allowance(treasury.address, managerAddr));
    });

    it("checkClaimRebate: returns (0,0,0) for an inactive lock", async function () {
      // earlyExit the lock to make it inactive
      const issued = await manager.issuedRewardTokens(lockId);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(lockId);

      const [rebate, bal, allow] = await manager.checkClaimRebate(lockId);
      expect(rebate).to.equal(0n);
      expect(bal).to.equal(0n);
      expect(allow).to.equal(0n);
    });

    // ── checkEarlyExit ────────────────────────────────────────────────────────

    it("checkEarlyExit: tokensToReturn matches issuedRewardTokens[lockId]", async function () {
      const [, tokens] = await manager.checkEarlyExit(lockId);
      expect(tokens).to.equal(await manager.issuedRewardTokens(lockId));
    });

    it("checkEarlyExit: treasuryShareBalance equals vault.balanceOf(treasury)", async function () {
      const [,, bal] = await manager.checkEarlyExit(lockId);
      expect(bal).to.equal(await vault.balanceOf(treasury.address));
    });

    it("checkEarlyExit: userTokenBalance equals rewardToken.balanceOf(alice)", async function () {
      const [,,,, userBal] = await manager.checkEarlyExit(lockId);
      expect(userBal).to.equal(await rwToken.balanceOf(alice.address));
    });

    it("checkEarlyExit: userTokenAllowance equals rewardToken.allowance(alice, manager)", async function () {
      const managerAddr = await manager.getAddress();
      const [,,,,, userAllow] = await manager.checkEarlyExit(lockId);
      expect(userAllow).to.equal(await rwToken.allowance(alice.address, managerAddr));
    });

    it("checkEarlyExit: returns (0,...) for a mature lock", async function () {
      await advance(16n * DAY); // total > 30d → mature
      const result = await manager.checkEarlyExit(lockId);
      for (const val of result) {
        expect(val).to.equal(0n);
      }
    });

    it("checkEarlyExit: returns (0,...) for an already-exited lock", async function () {
      const issued = await manager.issuedRewardTokens(lockId);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(lockId);

      const result = await manager.checkEarlyExit(lockId);
      for (const val of result) {
        expect(val).to.equal(0n);
      }
    });
  });

  // ─── Group 6: Beneficiary claim accounting isolation ─────────────────────
  //
  // ph_04 check point 6: beneficiary claim asset attribution.
  //
  // executeClaim transfers lock ownership (pos.owner = beneficiary).
  // All shares remain physically in LockLedger — no USDC moves, no shares mint/burn.
  // Free fbUSDC of the original owner is NOT transferred on-chain (known V2 limitation).
  // After inheritance, the new owner (bob) can unlock after maturity — only then do
  // shares move from ledger → bob; vault.totalAssets() still unchanged throughout.

  describe("Group 6 — beneficiary claim: vault accounting isolated end-to-end", function () {
    let beneficiary: BeneficiaryModuleV02;
    let bob: SignerWithAddress;
    let lockId: bigint;

    before(async function () {
      // Capture bob from signers (index 5 relative to the outer beforeEach signer list)
      [, , , , , bob] = await ethers.getSigners();
    });

    beforeEach(async function () {
      // Deploy beneficiary module, grant OPERATOR_ROLE
      beneficiary = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
        await ledger.getAddress(), admin.address
      );
      const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
      await ledger.connect(admin).grantRole(OPERATOR_ROLE, await beneficiary.getAddress());

      // Alice locks all her shares
      lockId = await manager.connect(alice).lockWithReward.staticCall(aliceShares, LOCK_DURATION);
      await manager.connect(alice).lockWithReward(aliceShares, LOCK_DURATION);

      // Alice sets bob as beneficiary, admin marks alice inactive (demo trigger)
      await beneficiary.connect(alice).setBeneficiary(bob.address);
      await beneficiary.connect(admin).adminMarkInactive(alice.address);
    });

    it("vault.totalAssets() unchanged after executeClaim (ownership transfer only)", async function () {
      const assetsBefore = await vault.totalAssets();
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      expect(await vault.totalAssets()).to.equal(assetsBefore);
    });

    it("vault.totalSupply() unchanged after executeClaim", async function () {
      const supplyBefore = await vault.totalSupply();
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      expect(await vault.totalSupply()).to.equal(supplyBefore);
    });

    it("ledger.totalLockedShares() unchanged after executeClaim (shares stay in ledger)", async function () {
      const lockedBefore = await ledger.totalLockedShares();
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      expect(await ledger.totalLockedShares()).to.equal(lockedBefore);
    });

    it("lock pos.owner changes to bob after executeClaim, shares field unchanged", async function () {
      const sharesBefore = (await ledger.getLock(lockId)).shares;
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      const posAfter = await ledger.getLock(lockId);
      expect(posAfter.owner).to.equal(bob.address);
      expect(posAfter.shares).to.equal(sharesBefore);
    });

    it("pricePerShare() unchanged after executeClaim", async function () {
      const priceBefore = await vault.pricePerShare();
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      expect(await vault.pricePerShare()).to.equal(priceBefore);
    });

    it("vault.totalAssets() unchanged when bob unlocks inherited lock after maturity", async function () {
      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);
      const assetsBefore = await vault.totalAssets();

      // Advance past unlock time
      await advance(31n * DAY);
      const bobSharesBefore = await vault.balanceOf(bob.address);
      await ledger.connect(bob).unlock(lockId);

      // Shares moved from ledger → bob, but USDC still in vault → totalAssets unchanged
      expect(await vault.totalAssets()).to.equal(assetsBefore);
      expect(await vault.balanceOf(bob.address)).to.be.gt(bobSharesBefore);
    });

    it("free shares of alice are NOT transferred by executeClaim (known V2 design)", async function () {
      // alice has 0 free shares here (all locked), but principle holds:
      // executeClaim records event only for free balance; no on-chain transfer occurs.
      const aliceFreeBefore = await vault.balanceOf(alice.address);
      const bobFreeBefore   = await vault.balanceOf(bob.address);

      await beneficiary.connect(bob).executeClaim(alice.address, [lockId]);

      expect(await vault.balanceOf(alice.address)).to.equal(aliceFreeBefore);
      expect(await vault.balanceOf(bob.address)).to.equal(bobFreeBefore);
    });
  });
});
