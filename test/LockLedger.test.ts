import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { LockLedgerV02, FundVaultV01, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LockLedgerV02", function () {
  let ledger: LockLedgerV02;
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let admin: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const D6   = (n: number) => ethers.parseUnits(String(n), 6);
  const DAY  = 86400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;
  const D180 = 180n * DAY;
  const D365 = 365n * DAY;

  // shares minted after depositing DEPOSIT_USDC (1:1 at genesis, offset=12 so shares have 18 decimals)
  let aliceShares: bigint;

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(),
      "Fund Vault Shares", "fbUSDC",
      treasury.address, admin.address
    );

    ledger = await (await ethers.getContractFactory("LockLedgerV02")).deploy(
      await vault.getAddress(),
      admin.address,
      guardian.address
    );

    // Grant OPERATOR_ROLE to alice and bob so they can call lockFor() directly in tests
    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, alice.address);
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, bob.address);

    // Give alice and bob USDC, deposit into vault to get fbUSDC shares
    await usdc.mint(alice.address, D6(10_000));
    await usdc.mint(bob.address,   D6(10_000));

    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);

    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(admin).addToAllowlist(bob.address);
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(bob).deposit(D6(1_000), bob.address);

    aliceShares = await vault.balanceOf(alice.address);

    // Alice approves ledger to pull shares
    await vault.connect(alice).approve(await ledger.getAddress(), ethers.MaxUint256);
    await vault.connect(bob).approve(await ledger.getAddress(), ethers.MaxUint256);
  });

  // ---------------------------------------------------------------------------
  // lock()
  // ---------------------------------------------------------------------------
  describe("lock()", function () {

    it("locks shares and transfers them to ledger", async function () {
      const sharesToLock = aliceShares / 2n;
      await ledger.connect(alice).lockFor(alice.address, sharesToLock, D30);

      expect(await vault.balanceOf(alice.address)).to.equal(aliceShares - sharesToLock);
      expect(await vault.balanceOf(await ledger.getAddress())).to.equal(sharesToLock);
      expect(await ledger.totalLockedShares()).to.equal(sharesToLock);
    });

    it("returns correct lockId starting from 0", async function () {
      const tx = await ledger.connect(alice).lockFor(alice.address, aliceShares / 4n, D30);
      const receipt = await tx.wait();
      // lockId = 0 for first lock
      const pos = await ledger.getLock(0n);
      expect(pos.owner).to.equal(alice.address);
    });

    it("increments activeLockCount", async function () {
      await ledger.connect(alice).lockFor(alice.address, aliceShares / 5n, D30);
      expect(await ledger.activeLockCount(alice.address)).to.equal(1n);

      await ledger.connect(alice).lockFor(alice.address, aliceShares / 5n, D90);
      expect(await ledger.activeLockCount(alice.address)).to.equal(2n);
    });

    it("emits Locked event with correct fields", async function () {
      const sharesToLock = aliceShares / 2n;
      const tx = ledger.connect(alice).lockFor(alice.address, sharesToLock, D30);
      await expect(tx).to.emit(ledger, "Locked")
        .withArgs(0n, alice.address, sharesToLock, anyValue, anyValue);
    });

    it("stores correct unlockAt = lockedAt + duration", async function () {
      const before = BigInt(await time.latest());
      await ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D180);
      const pos = await ledger.getLock(0n);

      expect(pos.unlockAt - pos.lockedAt).to.equal(D180);
      expect(pos.lockedAt).to.be.gte(before);
    });

    // --- revert cases ---

    it("reverts on zero shares", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, 0n, D30))
        .to.be.revertedWithCustomError(ledger, "ZeroShares");
    });

    it("reverts when duration < MIN (30 days)", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D30 - 1n))
        .to.be.revertedWithCustomError(ledger, "DurationTooShort");
    });

    it("reverts when duration > MAX (365 days)", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D365 + 1n))
        .to.be.revertedWithCustomError(ledger, "DurationTooLong");
    });

    it("reverts when active lock count reaches 5", async function () {
      const chunk = aliceShares / 6n;
      for (let i = 0; i < 5; i++) {
        await ledger.connect(alice).lockFor(alice.address, chunk, D30);
      }
      expect(await ledger.activeLockCount(alice.address)).to.equal(5n);

      await expect(ledger.connect(alice).lockFor(alice.address, chunk, D30))
        .to.be.revertedWithCustomError(ledger, "TooManyActiveLocks");
    });

    it("allows 6th lock after one is unlocked", async function () {
      const chunk = aliceShares / 7n;
      for (let i = 0; i < 5; i++) {
        await ledger.connect(alice).lockFor(alice.address, chunk, D30);
      }
      // unlock first position
      await time.increase(D30 + 1n);
      await ledger.connect(alice).unlock(0n);

      // now can create a new lock
      await expect(ledger.connect(alice).lockFor(alice.address, chunk, D30)).to.not.be.reverted;
      expect(await ledger.activeLockCount(alice.address)).to.equal(5n);
    });

    it("reverts when paused", async function () {
      await ledger.connect(guardian).pause();
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D30))
        .to.be.revertedWith("Pausable: paused");
    });
  });

  // ---------------------------------------------------------------------------
  // unlock()
  // ---------------------------------------------------------------------------
  describe("unlock()", function () {

    let lockId: bigint;

    beforeEach(async function () {
      const tx = await ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D30);
      lockId = 0n;
    });

    it("returns shares to owner after maturity", async function () {
      const sharesBefore = await vault.balanceOf(alice.address);
      const locked = (await ledger.getLock(lockId)).shares;

      await time.increase(D30);
      await ledger.connect(alice).unlock(lockId);

      expect(await vault.balanceOf(alice.address)).to.equal(sharesBefore + locked);
      expect(await ledger.totalLockedShares()).to.equal(0n);
    });

    it("decrements activeLockCount", async function () {
      await time.increase(D30);
      await ledger.connect(alice).unlock(lockId);
      expect(await ledger.activeLockCount(alice.address)).to.equal(0n);
    });

    it("marks position as unlocked", async function () {
      await time.increase(D30);
      await ledger.connect(alice).unlock(lockId);
      expect((await ledger.getLock(lockId)).unlocked).to.be.true;
    });

    it("emits Unlocked event", async function () {
      await time.increase(D30);
      await expect(ledger.connect(alice).unlock(lockId))
        .to.emit(ledger, "Unlocked")
        .withArgs(lockId, alice.address, anyValue);
    });

    // --- revert cases ---

    it("reverts before maturity", async function () {
      await time.increase(D30 - 2n);
      await expect(ledger.connect(alice).unlock(lockId))
        .to.be.revertedWithCustomError(ledger, "LockNotMature");
    });

    it("reverts exactly at unlock boundary (one second before)", async function () {
      const pos = await ledger.getLock(lockId);
      await time.setNextBlockTimestamp(Number(pos.unlockAt) - 1);
      await expect(ledger.connect(alice).unlock(lockId))
        .to.be.revertedWithCustomError(ledger, "LockNotMature");
    });

    it("succeeds exactly at unlockAt", async function () {
      const pos = await ledger.getLock(lockId);
      await time.setNextBlockTimestamp(Number(pos.unlockAt));
      await expect(ledger.connect(alice).unlock(lockId)).to.not.be.reverted;
    });

    it("reverts on non-existent lockId", async function () {
      await expect(ledger.connect(alice).unlock(999n))
        .to.be.revertedWithCustomError(ledger, "LockNotFound");
    });

    it("reverts when caller is not owner", async function () {
      await time.increase(D30);
      await expect(ledger.connect(bob).unlock(lockId))
        .to.be.revertedWithCustomError(ledger, "NotOwner");
    });

    it("reverts on double unlock", async function () {
      await time.increase(D30);
      await ledger.connect(alice).unlock(lockId);
      await expect(ledger.connect(alice).unlock(lockId))
        .to.be.revertedWithCustomError(ledger, "AlreadyUnlocked");
    });

    it("reverts when paused", async function () {
      await time.increase(D30);
      await ledger.connect(guardian).pause();
      await expect(ledger.connect(alice).unlock(lockId))
        .to.be.revertedWith("Pausable: paused");
    });
  });

  // ---------------------------------------------------------------------------
  // Duration boundary cases
  // ---------------------------------------------------------------------------
  describe("duration boundary", function () {
    it("accepts exactly 30 days", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D30)).to.not.be.reverted;
    });

    it("accepts exactly 365 days", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D365)).to.not.be.reverted;
    });

    it("accepts 90 days", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D90)).to.not.be.reverted;
    });

    it("accepts 180 days", async function () {
      await expect(ledger.connect(alice).lockFor(alice.address, aliceShares / 2n, D180)).to.not.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------
  describe("views", function () {
    it("userLockIds includes all lockIds (including unlocked)", async function () {
      const chunk = aliceShares / 4n;
      await ledger.connect(alice).lockFor(alice.address, chunk, D30);
      await ledger.connect(alice).lockFor(alice.address, chunk, D90);

      await time.increase(D30);
      await ledger.connect(alice).unlock(0n);

      const ids = await ledger.userLockIds(alice.address);
      expect(ids.length).to.equal(2);
    });

    it("userLockCount matches total positions created", async function () {
      await ledger.connect(alice).lockFor(alice.address, aliceShares / 4n, D30);
      await ledger.connect(alice).lockFor(alice.address, aliceShares / 4n, D90);
      expect(await ledger.userLockCount(alice.address)).to.equal(2n);
    });

    it("activeLockCount tracks only active positions", async function () {
      const chunk = aliceShares / 4n;
      await ledger.connect(alice).lockFor(alice.address, chunk, D30);
      await ledger.connect(alice).lockFor(alice.address, chunk, D90);
      expect(await ledger.activeLockCount(alice.address)).to.equal(2n);

      await time.increase(D30);
      await ledger.connect(alice).unlock(0n);
      expect(await ledger.activeLockCount(alice.address)).to.equal(1n);
    });

    it("totalLockedShares tracks global locked amount", async function () {
      const chunkA = aliceShares / 3n;
      const bobShares = await vault.balanceOf(bob.address);
      const chunkB = bobShares / 3n;

      await ledger.connect(alice).lockFor(alice.address, chunkA, D30);
      await ledger.connect(bob).lockFor(bob.address, chunkB, D90);

      expect(await ledger.totalLockedShares()).to.equal(chunkA + chunkB);

      await time.increase(D90);
      await ledger.connect(alice).unlock(0n);
      expect(await ledger.totalLockedShares()).to.equal(chunkB);
    });
  });

  // ---------------------------------------------------------------------------
  // Accounting invariant
  // ---------------------------------------------------------------------------
  describe("accounting invariant", function () {
    it("ledger.totalLockedShares == vault.balanceOf(ledger)", async function () {
      const chunk = aliceShares / 4n;
      await ledger.connect(alice).lockFor(alice.address, chunk, D30);
      await ledger.connect(alice).lockFor(alice.address, chunk, D90);

      const ledgerAddr = await ledger.getAddress();
      expect(await ledger.totalLockedShares())
        .to.equal(await vault.balanceOf(ledgerAddr));
    });
  });

  // ---------------------------------------------------------------------------
  // Pause / unpause
  // ---------------------------------------------------------------------------
  describe("pause / unpause", function () {
    it("emergency role can pause", async function () {
      await expect(ledger.connect(guardian).pause()).to.not.be.reverted;
    });

    it("non-emergency role cannot pause", async function () {
      await expect(ledger.connect(alice).pause()).to.be.reverted;
    });

    it("admin can unpause", async function () {
      await ledger.connect(guardian).pause();
      await expect(ledger.connect(admin).unpause()).to.not.be.reverted;
    });

    it("emergency role cannot unpause", async function () {
      await ledger.connect(guardian).pause();
      await expect(ledger.connect(guardian).unpause()).to.be.reverted;
    });
  });
});

// helper — chai doesn't import anyValue automatically in all setups
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
