import { expect } from "chai";
import { ethers } from "hardhat";
import {
  LockLedgerV02, LockBenefitV02, LockPointsV02,
  UserStateEngineV02, LockRewardManagerV02,
  FundVaultV01, MockUSDC, RewardToken
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("EarlyExit (via LockRewardManagerV02)", function () {
  let ledger:   LockLedgerV02;
  let benefit:  LockBenefitV02;
  let points:   LockPointsV02;
  let engine:   UserStateEngineV02;
  let manager:  LockRewardManagerV02;
  let vault:    FundVaultV01;
  let usdc:     MockUSDC;
  let rwToken:  RewardToken;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;

  const D6   = (n: number) => ethers.parseUnits(String(n), 6);
  const D18  = (n: number) => ethers.parseUnits(String(n), 18);
  const DAY  = 86400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;

  const STATE_NORMAL       = 0n;
  const STATE_ACCUMULATING = 1n;
  const STATE_EARLY_EXIT   = 3n;

  let aliceShares: bigint;

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

    // Core contracts
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
    points = await (await ethers.getContractFactory("LockPointsV02")).deploy(
      await ledger.getAddress(), await benefit.getAddress(), await vault.getAddress()
    );
    engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
      await ledger.getAddress()
    );

    // Reward token — pre-minted to treasury
    rwToken = await (await ethers.getContractFactory("RewardToken")).deploy(
      "Reward Token", "RWT", D18(1_000_000), treasury.address
    );

    // Reward manager
    manager = await (await ethers.getContractFactory("LockRewardManagerV02")).deploy(
      await ledger.getAddress(),
      await benefit.getAddress(),
      await rwToken.getAddress(),
      await vault.getAddress(),   // vaultShares = vault address (ERC20 shares)
      await vault.getAddress(),   // vault address for mgmtFeeBps / convertToAssets
      treasury.address,
      admin.address,
      guardian.address
    );

    // Grant OPERATOR_ROLE on LockLedger to manager
    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, await manager.getAddress());

    // Treasury pre-approves reward tokens to manager (upfront issuance)
    await rwToken.connect(treasury).approve(await manager.getAddress(), ethers.MaxUint256);

    // Alice deposits 100 USDC → gets fbUSDC shares
    await usdc.mint(alice.address, D6(100));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(100));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(100), alice.address);
    aliceShares = await vault.balanceOf(alice.address);

    // Alice approves shares to LockLedger (lockFor pulls from alice)
    await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
  });

  // helper: alice locks via manager, returns lockId
  async function lockWithReward(shares: bigint, duration: bigint): Promise<bigint> {
    const tx = await manager.connect(alice).lockWithReward(shares, duration);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l: any) => { try { return manager.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "LockedWithReward");
    return event!.args.lockId;
  }

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  // -------------------------------------------------------------------------
  // lockWithReward — reward tokens issued upfront
  // -------------------------------------------------------------------------

  describe("lockWithReward — upfront reward token issuance", function () {
    it("transfers shares to ledger", async function () {
      const half = aliceShares / 2n;
      await lockWithReward(half, D90);
      expect(await vault.balanceOf(await ledger.getAddress())).to.equal(half);
    });

    it("issues reward tokens to alice immediately", async function () {
      const balBefore = await rwToken.balanceOf(alice.address);
      await lockWithReward(aliceShares, D90);
      const balAfter = await rwToken.balanceOf(alice.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("records issuedRewardTokens[lockId]", async function () {
      const id = await lockWithReward(aliceShares, D90);
      expect(await manager.issuedRewardTokens(id)).to.be.gt(0n);
    });

    it("emits LockedWithReward event", async function () {
      const half = aliceShares / 2n;
      await expect(manager.connect(alice).lockWithReward(half, D90))
        .to.emit(manager, "LockedWithReward");
    });

    it("direct LockLedger.lockFor() is blocked for non-operator users", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D30))
        .to.be.reverted; // AccessControl: missing OPERATOR_ROLE
    });
  });

  // -------------------------------------------------------------------------
  // earlyExitWithReturn — basic behaviour
  // -------------------------------------------------------------------------

  describe("earlyExitWithReturn — basic behaviour", function () {
    it("returns shares to alice after early exit", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY * 10n);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);

      const sharesBefore = await vault.balanceOf(alice.address);
      await manager.connect(alice).earlyExitWithReturn(id);
      expect(await vault.balanceOf(alice.address)).to.equal(sharesBefore + aliceShares);
    });

    it("returns reward tokens to treasury", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY * 10n);

      const issued = await manager.issuedRewardTokens(id);
      const treasuryBefore = await rwToken.balanceOf(treasury.address);

      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      expect(await rwToken.balanceOf(treasury.address)).to.equal(treasuryBefore + issued);
    });

    it("emits EarlyExitExecuted event", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);

      await expect(manager.connect(alice).earlyExitWithReturn(id))
        .to.emit(manager, "EarlyExitExecuted")
        .withArgs(id, alice.address, issued);
    });

    it("marks position as earlyExited in ledger", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      const pos = await ledger.getLock(id);
      expect(pos.earlyExited).to.be.true;
      expect(pos.unlocked).to.be.true;
    });

    it("clears issuedRewardTokens[lockId] to zero after earlyExitWithReturn", async function () {
      const id = await lockWithReward(aliceShares, D90);
      expect(await manager.issuedRewardTokens(id)).to.be.gt(0n);

      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      // State must be cleared: frontend / aggregators must read 0, not the stale issued amount
      expect(await manager.issuedRewardTokens(id)).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // earlyExitWithReturn — revert cases
  // -------------------------------------------------------------------------

  describe("earlyExitWithReturn — revert cases", function () {
    it("reverts when insufficient reward token allowance", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);
      // No approval — should revert
      await expect(manager.connect(alice).earlyExitWithReturn(id))
        .to.be.revertedWithCustomError(manager, "InsufficientRewardTokenAllowance");
    });

    it("reverts when called by non-owner", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);
      await expect(manager.connect(bob).earlyExitWithReturn(id))
        .to.be.revertedWithCustomError(manager, "NotLockOwner");
    });

    it("reverts when lock has already matured", async function () {
      const id = await lockWithReward(aliceShares, D30);
      await advance(D30);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);

      await expect(manager.connect(alice).earlyExitWithReturn(id))
        .to.be.revertedWithCustomError(manager, "LockAlreadyMature");
    });

    it("reverts on non-existent lockId", async function () {
      await expect(manager.connect(alice).earlyExitWithReturn(999n))
        .to.be.revertedWithCustomError(manager, "LockNotActive");
    });

    it("reverts when alice has insufficient reward token balance (allowance set but tokens spent)", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      // Allowance is set correctly, but alice transfers her tokens away first
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await rwToken.connect(alice).transfer(bob.address, issued);

      // safeTransferFrom fails at ERC20 level — not a custom error from manager
      await expect(manager.connect(alice).earlyExitWithReturn(id))
        .to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("reverts when attempting to earlyExit the same position twice", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      // Second attempt: pos.earlyExited == true → LockNotActive
      await expect(manager.connect(alice).earlyExitWithReturn(id))
        .to.be.revertedWithCustomError(manager, "LockNotActive");
    });

    it("reverts claimRebate after earlyExitWithReturn", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY * 10n);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      // pos.earlyExited == true → LockNotActive (same guard as earlyExit)
      await expect(manager.connect(alice).claimRebate(id))
        .to.be.revertedWithCustomError(manager, "LockNotActive");
    });
  });

  // -------------------------------------------------------------------------
  // points forfeited after earlyExit
  // -------------------------------------------------------------------------

  describe("points — forfeited after earlyExit", function () {
    it("pointsOf returns 0 after earlyExitWithReturn", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY * 10n);

      expect(await points.pointsOf(id)).to.be.gt(0n);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      expect(await points.pointsOf(id)).to.equal(0n);
    });

    it("totalPointsOf excludes early-exited positions", async function () {
      const half = aliceShares / 2n;
      const id1 = await lockWithReward(half, D90);
      const id2 = await lockWithReward(half, D90);

      await advance(DAY * 10n);

      const issued1 = await manager.issuedRewardTokens(id1);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued1);
      await manager.connect(alice).earlyExitWithReturn(id1);

      const p2 = await points.pointsOf(id2);
      expect(await points.totalPointsOf(alice.address)).to.equal(p2);
    });
  });

  // -------------------------------------------------------------------------
  // state transitions
  // -------------------------------------------------------------------------

  describe("state — transitions", function () {
    it("lockStateOf returns LockedAccumulating after lockWithReward", async function () {
      const id = await lockWithReward(aliceShares, D90);
      expect(await engine.lockStateOf(id)).to.equal(STATE_ACCUMULATING);
    });

    it("lockStateOf returns EarlyExit after earlyExitWithReturn", async function () {
      const id = await lockWithReward(aliceShares, D90);
      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id);

      expect(await engine.lockStateOf(id)).to.equal(STATE_EARLY_EXIT);
    });

    it("userStateOf returns EarlyExit when any position is early exited", async function () {
      const half = aliceShares / 2n;
      const id1 = await lockWithReward(half, D90);
      await lockWithReward(half, D90);

      await advance(DAY);

      const issued = await manager.issuedRewardTokens(id1);
      await rwToken.connect(alice).approve(await manager.getAddress(), issued);
      await manager.connect(alice).earlyExitWithReturn(id1);

      expect(await engine.userStateOf(alice.address)).to.equal(STATE_EARLY_EXIT);
    });

    it("normal unlock does NOT produce EarlyExit state", async function () {
      const id = await lockWithReward(aliceShares, D30);
      await advance(D30);
      await ledger.connect(alice).unlock(id);
      expect(await engine.lockStateOf(id)).to.equal(STATE_NORMAL);
    });
  });
});
