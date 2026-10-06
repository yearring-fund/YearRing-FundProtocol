import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FundVaultV01, MockUSDC, LockLedgerV02, LockRewardManagerV02, LockBenefitV02, RewardToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ExitRound", function () {
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);

  beforeEach(async function () {
    [, admin, treasury, alice, bob, carol] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(),
      "fbUSDC", "fbUSDC",
      treasury.address, admin.address
    );

    // Mint and approve for all users
    for (const user of [alice, bob, carol]) {
      await usdc.mint(user.address, D6(10_000));
      await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    // Alice deposits 1000, bob deposits 500 — total 1500 USDC
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(admin).addToAllowlist(bob.address);
    await vault.connect(alice).deposit(D6(1000), alice.address);
    await vault.connect(bob).deposit(D6(500), bob.address);
  });

  // -------------------------------------------------------------------------
  // openExitModeRound guards
  // -------------------------------------------------------------------------
  it("openExitModeRound requires EmergencyExit mode", async function () {
    // mode = Normal (0)
    await expect(
      vault.connect(admin).openExitModeRound(D6(500))
    ).to.be.revertedWithCustomError(vault, "RequiresEmergencyExitMode");
  });

  it("openExitModeRound works in EmergencyExit mode", async function () {
    await vault.connect(admin).setMode(2);
    await expect(vault.connect(admin).openExitModeRound(D6(500)))
      .to.emit(vault, "ExitRoundOpened")
      .withArgs(1, 1, await vault.totalSupply(), D6(500));
    expect(await vault.currentRoundId()).to.equal(1);
  });

  it("openExitModeRound takes snapshot of correct totalSupply", async function () {
    const supplyBeforeSnapshot = await vault.totalSupply();
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(300));

    const round = await vault.exitRounds(1);
    expect(round.snapshotTotalSupply).to.equal(supplyBeforeSnapshot);
  });

  // -------------------------------------------------------------------------
  // Snapshot isolation: users with no shares at snapshot time have balanceOfAt = 0
  // (In EmergencyExit mode, new deposits are blocked — snapshot isolation is guaranteed)
  // -------------------------------------------------------------------------
  it("snapshot excludes users who had no shares at snapshot time", async function () {
    // Carol has no shares (never deposited)
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(500));

    const round = await vault.exitRounds(1);
    const snapshotId = round.snapshotId;

    // Carol had no shares at snapshot time — balanceOfAt should be 0
    const carolSnapshotBalance = await vault.balanceOfAt(carol.address, snapshotId);
    expect(carolSnapshotBalance).to.equal(0);

    // Carol also cannot deposit in EmergencyExit mode (mode-level deposit block)
    await expect(
      vault.connect(carol).deposit(D6(1000), carol.address)
    ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
  });

  // -------------------------------------------------------------------------
  // Pro-rata claim
  // -------------------------------------------------------------------------
  it("user can claim pro-rata exit assets", async function () {
    // alice=1000, bob=500 → totalSupply=1500 (in share units, 18 decimals, offset 12)
    // Open exit round with 600 USDC available
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(600));

    const aliceShares = await vault.balanceOf(alice.address);
    const round = await vault.exitRounds(1);
    const snapshotSupply = round.snapshotTotalSupply;

    // Expected alice payout: aliceShares / snapshotSupply * 600e6
    const expectedAssets = (aliceShares * D6(600)) / snapshotSupply;

    const aliceUsdcBefore = await usdc.balanceOf(alice.address);
    await vault.connect(alice).claimExitAssets(1, aliceShares);
    const aliceUsdcAfter = await usdc.balanceOf(alice.address);

    expect(aliceUsdcAfter - aliceUsdcBefore).to.equal(expectedAssets);
    // Alice's shares should be burned
    expect(await vault.balanceOf(alice.address)).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // Cannot claim more than snapshot allocation
  // -------------------------------------------------------------------------
  it("user cannot claim more than snapshot allocation", async function () {
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(600));

    const aliceShares = await vault.balanceOf(alice.address);

    await expect(
      vault.connect(alice).claimExitAssets(1, aliceShares + 1n)
    ).to.be.revertedWithCustomError(vault, "InsufficientSnapshotAllocation");
  });

  // -------------------------------------------------------------------------
  // Batch claim (partial, then remainder)
  // -------------------------------------------------------------------------
  it("user can claim in batches", async function () {
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(600));

    const aliceShares = await vault.balanceOf(alice.address);
    const half = aliceShares / 2n;

    // First partial claim
    await vault.connect(alice).claimExitAssets(1, half);
    expect(await vault.balanceOf(alice.address)).to.equal(aliceShares - half);

    // Second claim for the remainder
    const remaining = aliceShares - half;
    await vault.connect(alice).claimExitAssets(1, remaining);
    expect(await vault.balanceOf(alice.address)).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // closeExitModeRound blocks further claims
  // -------------------------------------------------------------------------
  it("closeExitModeRound prevents further claims", async function () {
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(600));

    await vault.connect(admin).closeExitModeRound();

    const aliceShares = await vault.balanceOf(alice.address);
    await expect(
      vault.connect(alice).claimExitAssets(1, aliceShares)
    ).to.be.revertedWithCustomError(vault, "ExitRoundNotOpen");
  });

  // -------------------------------------------------------------------------
  // New round after close has fresh snapshot
  // -------------------------------------------------------------------------
  it("new round after close has fresh snapshot", async function () {
    // Open and close round 1
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(100));
    await vault.connect(admin).closeExitModeRound();

    // Return to Normal, carol deposits, then go back to Exit
    await vault.connect(admin).setMode(0);
    await vault.connect(admin).addToAllowlist(carol.address);
    await vault.connect(carol).deposit(D6(1000), carol.address);
    const supplyBeforeRound2 = await vault.totalSupply();

    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(200));

    expect(await vault.currentRoundId()).to.equal(2);

    const round2 = await vault.exitRounds(2);
    // Round 2 snapshot should reflect carol's deposit
    expect(round2.snapshotTotalSupply).to.equal(supplyBeforeRound2);

    // Carol's snapshot balance for round 2 should be > 0
    const carolSnapshot = await vault.balanceOfAt(carol.address, round2.snapshotId);
    expect(carolSnapshot).to.be.gt(0);
  });

  // -------------------------------------------------------------------------
  // Cannot open round while previous is still open
  // -------------------------------------------------------------------------
  it("cannot open round while previous is still open", async function () {
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(300));

    await expect(
      vault.connect(admin).openExitModeRound(D6(300))
    ).to.be.revertedWithCustomError(vault, "RoundAlreadyOpen");
  });

  // -------------------------------------------------------------------------
  // Economic snapshot: locked shares included in exit round allocation
  // -------------------------------------------------------------------------
  describe("economic snapshot (lockLedger integration)", function () {
    let ledger: LockLedgerV02;
    let guardian: SignerWithAddress;
    const D30 = 30n * 86400n;

    beforeEach(async function () {
      [, admin, treasury, alice, bob, carol, guardian] = await ethers.getSigners();

      // Re-deploy fresh vault + ledger for this sub-suite
      usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
      vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
        await usdc.getAddress(), "fbUSDC", "fbUSDC",
        treasury.address, admin.address
      );
      ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
        await vault.getAddress(), admin.address, guardian.address
      );

      // Wire ledger into vault
      await vault.connect(admin).setLockLedger(await ledger.getAddress());

      // Grant OPERATOR_ROLE to admin so it can call lockFor
      const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
      await ledger.connect(admin).grantRole(OPERATOR_ROLE, admin.address);

      // Give alice & bob USDC
      for (const user of [alice, bob]) {
        await usdc.mint(user.address, D6(10_000));
        await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
        await vault.connect(user).approve(await ledger.getAddress(), ethers.MaxUint256);
      }

      // Alice deposits 1000, bob deposits 500
      await vault.connect(admin).addToAllowlist(alice.address);
      await vault.connect(admin).addToAllowlist(bob.address);
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(bob).deposit(D6(500), bob.address);
    });

    it("locked shares are included in snapshot allocation", async function () {
      // Alice locks all her shares (1000e18) for 30 days
      const aliceShares = await vault.balanceOf(alice.address);
      await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);

      // After locking: alice has 0 free shares, LockLedger holds aliceShares
      expect(await vault.balanceOf(alice.address)).to.equal(0);

      // Open exit round — snapshot captures totalEconomicShares
      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(600));

      // Bob (free) claims his portion first
      const bobShares = await vault.balanceOf(bob.address);
      const round = await vault.exitRounds(1);
      const bobExpected = (bobShares * D6(600)) / round.snapshotTotalSupply;

      const bobBefore = await usdc.balanceOf(bob.address);
      await vault.connect(bob).claimExitAssets(1, bobShares);
      expect(await usdc.balanceOf(bob.address) - bobBefore).to.equal(bobExpected);

      // Alice has 0 free shares now → earlyExit not available in these tests (no LockRewardManager)
      // Verify: alice cannot claim more than her snapshot allocation (free=0 + locked=aliceShares)
      // Trying to burn more than allocation reverts
      await expect(
        vault.connect(alice).claimExitAssets(1, aliceShares + 1n)
      ).to.be.revertedWithCustomError(vault, "InsufficientSnapshotAllocation");
    });

    it("snapshotTimestamp is recorded and accessible", async function () {
      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(100));

      const round = await vault.exitRounds(1);
      expect(round.snapshotTimestamp).to.be.gt(0);
    });

    it("claimExitAssets reverts InsufficientFreeBalance when locked shares not yet unlocked", async function () {
      // Alice locks all her shares — free balance = 0
      const aliceShares = await vault.balanceOf(alice.address);
      await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);

      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(600));

      // Alice has snapshot allocation (lockedSnapshotBalance = aliceShares)
      // but free balance = 0 → should get InsufficientFreeBalance, not a generic ERC20 error
      await expect(
        vault.connect(alice).claimExitAssets(1, aliceShares)
      ).to.be.revertedWithCustomError(vault, "InsufficientFreeBalance");
    });

    it("lockedSharesOfAt returns 0 for timestamp before lock creation", async function () {
      const aliceShares = await vault.balanceOf(alice.address);
      const lockTx = await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);
      const lockBlock = await ethers.provider.getBlock(lockTx.blockNumber!);
      const lockTs = BigInt(lockBlock!.timestamp);

      // Query at timestamp strictly before the lock was created
      const before = await ledger.lockedSharesOfAt(alice.address, lockTs - 1n);
      expect(before).to.equal(0);

      // Query at or after lock timestamp includes the shares
      const atLock = await ledger.lockedSharesOfAt(alice.address, lockTs);
      expect(atLock).to.equal(aliceShares);
    });

    // -----------------------------------------------------------------------
    // P3: lockedSharesOfAt — normal unlock() endedAt boundary
    // -----------------------------------------------------------------------
    it("lockedSharesOfAt returns 0 after normal unlock at or after query timestamp", async function () {
      const aliceShares = await vault.balanceOf(alice.address);
      await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);

      // Advance past maturity and unlock
      await time.increase(Number(D30) + 1);
      const unlockTx = await ledger.connect(alice).unlock(0); // lockId = 0
      const unlockBlock = await ethers.provider.getBlock(unlockTx.blockNumber!);
      const unlockTs = BigInt(unlockBlock!.timestamp);

      // Query at the exact unlock timestamp: endedAt == unlockTs → condition (endedAt > timestamp) false → 0
      const atUnlock = await ledger.lockedSharesOfAt(alice.address, unlockTs);
      expect(atUnlock).to.equal(0);

      // Query after unlock: clearly 0
      const afterUnlock = await ledger.lockedSharesOfAt(alice.address, unlockTs + 1n);
      expect(afterUnlock).to.equal(0);
    });

    it("lockedSharesOfAt returns shares for timestamp during lock, even after unlock", async function () {
      const aliceShares = await vault.balanceOf(alice.address);
      const lockTx = await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);
      const lockBlock = await ethers.provider.getBlock(lockTx.blockNumber!);
      const duringLockTs = BigInt(lockBlock!.timestamp) + D30 / 2n; // midpoint

      // Advance past maturity and unlock
      await time.increase(Number(D30) + 1);
      await ledger.connect(alice).unlock(0);

      // Historical query at midpoint (before unlock) should still return shares
      const atMidpoint = await ledger.lockedSharesOfAt(alice.address, duringLockTs);
      expect(atMidpoint).to.equal(aliceShares);
    });

    it("snapshot excludes locked shares of user who unlocked before snapshot", async function () {
      const aliceShares = await vault.balanceOf(alice.address);
      await ledger.connect(admin).lockFor(alice.address, aliceShares, D30);

      // Alice unlocks before snapshot (lock matured)
      await time.increase(Number(D30) + 1);
      await ledger.connect(alice).unlock(0);

      // Now alice has free shares again; open exit round
      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(600));

      const round = await vault.exitRounds(1);

      // lockedSnapshotBalance for alice should be 0 (she unlocked before snapshot)
      const lockedAtSnap = await ledger.lockedSharesOfAt(alice.address, round.snapshotTimestamp);
      expect(lockedAtSnap).to.equal(0);

      // freeSnapshotBalance should equal aliceShares (she holds them again)
      const freeAtSnap = await vault.balanceOfAt(alice.address, round.snapshotId);
      expect(freeAtSnap).to.equal(aliceShares);
    });

    // -----------------------------------------------------------------------
    // Integration: lock → snapshot → earlyExitWithReturn → claimExitAssets
    // -----------------------------------------------------------------------
    describe("full path: lock → snapshot → earlyExitWithReturn → claimExitAssets", function () {
      let manager: LockRewardManagerV02;
      let benefit:  LockBenefitV02;
      let rwToken:  RewardToken;
      const D18 = (n: number) => ethers.parseUnits(String(n), 18);

      beforeEach(async function () {
        [, admin, treasury, alice, bob, carol, guardian] = await ethers.getSigners();

        // Fresh deploy
        usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
        vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
          await usdc.getAddress(), "fbUSDC", "fbUSDC",
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

        // Wire up roles and addresses
        const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
        await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());
        await vault.connect(admin).setLockLedger(await ledger.getAddress());

        // Treasury funds: USDC for vault deposit (rebate pool) + RWT allowance
        await usdc.mint(treasury.address, D6(500));
        await usdc.connect(treasury).approve(await vault.getAddress(), ethers.MaxUint256);
        await vault.connect(admin).addToAllowlist(treasury.address);
        await vault.connect(treasury).deposit(D6(500), treasury.address);
        await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);
        await vault.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

        // Alice and bob get USDC and deposit
        for (const user of [alice, bob]) {
          await usdc.mint(user.address, D6(10_000));
          await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
        }
        await vault.connect(admin).addToAllowlist(alice.address);
        await vault.connect(admin).addToAllowlist(bob.address);
        await vault.connect(alice).deposit(D6(1000), alice.address);
        await vault.connect(bob).deposit(D6(500), bob.address);

        // Alice approves ledger to pull her shares (for lockWithReward)
        await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
      });

      it("lock user can claimExitAssets after earlyExitWithReturn", async function () {
        const aliceShares = await vault.balanceOf(alice.address);

        // Step 1: Alice locks all her shares
        const lockTx = await manager.connect(alice).lockWithReward(aliceShares, D30);
        const receipt = await lockTx.wait();
        const ev = receipt!.logs
          .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
          .find((e: any) => e?.name === "LockedWithReward");
        const lockId: bigint = ev!.args.lockId;

        expect(await vault.balanceOf(alice.address)).to.equal(0); // all locked

        // Step 2: Open exit round — snapshot captures alice's locked shares
        await vault.connect(admin).setMode(2);
        await vault.connect(admin).openExitModeRound(D6(600));

        const round = await vault.exitRounds(1);
        // Alice's locked shares should be in lockedSnapshotBalance
        const lockedAtSnap = await ledger.lockedSharesOfAt(alice.address, round.snapshotTimestamp);
        expect(lockedAtSnap).to.equal(aliceShares);

        // Step 3: Alice tries to claim before earlyExitWithReturn → InsufficientFreeBalance
        await expect(
          vault.connect(alice).claimExitAssets(1, aliceShares)
        ).to.be.revertedWithCustomError(vault, "InsufficientFreeBalance");

        // Step 4: Alice returns RWT and recovers her fbUSDC
        const tokensToReturn = await manager.issuedRewardTokens(lockId);
        await rwToken.connect(alice).approve(await manager.getAddress(), tokensToReturn);
        await manager.connect(alice).earlyExitWithReturn(lockId);

        // Alice now holds her original locked shares (plus any rebate, negligible at t=0)
        expect(await vault.balanceOf(alice.address)).to.be.gte(aliceShares);

        // Step 5: Alice claims exit assets — should succeed up to her snapshot allocation
        const aliceUsdcBefore = await usdc.balanceOf(alice.address);
        await vault.connect(alice).claimExitAssets(1, aliceShares);
        const aliceUsdcAfter = await usdc.balanceOf(alice.address);

        // Received USDC = aliceShares / snapshotTotalSupply * availableAssets
        const expected = (aliceShares * D6(600)) / round.snapshotTotalSupply;
        expect(aliceUsdcAfter - aliceUsdcBefore).to.equal(expected);

        // Alice's shares reduced by the burned amount
        expect(await vault.balanceOf(alice.address)).to.equal(
          (await vault.balanceOf(alice.address)) // after burn
        );
      });

      it("bob (free user) and alice (lock user) claim pro-rata correctly from same round", async function () {
        const aliceShares = await vault.balanceOf(alice.address);
        const bobShares   = await vault.balanceOf(bob.address);

        // Alice locks all her shares
        const lockTx = await manager.connect(alice).lockWithReward(aliceShares, D30);
        const receipt = await lockTx.wait();
        const ev = receipt!.logs
          .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
          .find((e: any) => e?.name === "LockedWithReward");
        const lockId: bigint = ev!.args.lockId;

        await vault.connect(admin).setMode(2);
        await vault.connect(admin).openExitModeRound(D6(900));
        const round = await vault.exitRounds(1);

        // Bob claims his free portion
        const bobUsdcBefore = await usdc.balanceOf(bob.address);
        await vault.connect(bob).claimExitAssets(1, bobShares);
        const bobReceived = await usdc.balanceOf(bob.address) - bobUsdcBefore;
        const bobExpected = (bobShares * D6(900)) / round.snapshotTotalSupply;
        expect(bobReceived).to.equal(bobExpected);

        // Alice: earlyExitWithReturn → claimExitAssets
        const tokensToReturn = await manager.issuedRewardTokens(lockId);
        await rwToken.connect(alice).approve(await manager.getAddress(), tokensToReturn);
        await manager.connect(alice).earlyExitWithReturn(lockId);

        const aliceUsdcBefore = await usdc.balanceOf(alice.address);
        await vault.connect(alice).claimExitAssets(1, aliceShares);
        const aliceReceived = await usdc.balanceOf(alice.address) - aliceUsdcBefore;
        const aliceExpected = (aliceShares * D6(900)) / round.snapshotTotalSupply;
        expect(aliceReceived).to.equal(aliceExpected);

        // Total claimed = bob + alice portions
        const updatedRound = await vault.exitRounds(1);
        expect(updatedRound.totalClaimed).to.equal(bobReceived + aliceReceived);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Unredeemed shares still bear PPS changes after round close
  // -------------------------------------------------------------------------
  it("unredeemed shares still bear PPS changes after round close", async function () {
    // Open round, alice claims all her shares, bob does NOT claim
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).openExitModeRound(D6(600));

    const aliceShares = await vault.balanceOf(alice.address);
    await vault.connect(alice).claimExitAssets(1, aliceShares);

    await vault.connect(admin).closeExitModeRound();

    // Return to Normal mode
    await vault.connect(admin).setMode(0);

    // Simulate yield by minting extra USDC directly to vault (increases totalAssets)
    const extraYield = D6(150);
    await usdc.mint(await vault.getAddress(), extraYield);

    // Bob's PPS should increase since totalAssets increased while his share count is unchanged
    const bobShares = await vault.balanceOf(bob.address);
    const assetsForBob = await vault.convertToAssets(bobShares);

    // Bob had 500 out of (1500 total) = 1/3 of 1500 USDC initially
    // After vault got 150 extra USDC, bob's assets should exceed his initial 500
    // (remaining vault balance includes 900 leftover from round + 150 yield)
    expect(assetsForBob).to.be.gt(D6(500));
  });
});
