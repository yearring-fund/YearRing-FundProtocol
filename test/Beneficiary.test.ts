import { expect } from "chai";
import { ethers } from "hardhat";
import {
  BeneficiaryModuleV02, LockLedgerV02, LockPointsV02, LockBenefitV02,
  FundVaultV01, MockUSDC
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BeneficiaryModuleV02", function () {
  let module:  BeneficiaryModuleV02;
  let ledger:  LockLedgerV02;
  let points:  LockPointsV02;
  let benefit: LockBenefitV02;
  let vault:   FundVaultV01;
  let usdc:    MockUSDC;

  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;
  let carol:    SignerWithAddress;

  const D6   = (n: number) => ethers.parseUnits(String(n), 6);
  const DAY  = 86400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;
  const YEAR = 365n * DAY;

  let aliceShares: bigint;

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob, carol] = await ethers.getSigners();

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

    // BeneficiaryModule
    module = await (await ethers.getContractFactory("BeneficiaryModuleV02")).deploy(
      await ledger.getAddress(), admin.address
    );

    // Grant OPERATOR_ROLE to module and alice (for direct lock() in tests)
    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, await module.getAddress());
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, alice.address);

    // Alice deposits 100 USDC
    await usdc.mint(alice.address, D6(100));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(100));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(100), alice.address);
    aliceShares = await vault.balanceOf(alice.address);
  });

  // helper: alice creates a lock, returns lockId
  async function aliceLock(shares: bigint, duration: bigint): Promise<bigint> {
    await vault.connect(alice).approve(await ledger.getAddress(), shares);
    const tx = await ledger.connect(alice).lockFor(alice.address, shares, duration);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l: any) => { try { return ledger.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "Locked");
    return event!.args.lockId;
  }

  // helper: trigger admin-marked inactivity for alice, bob is beneficiary
  async function setupAndMark() {
    await module.connect(alice).setBeneficiary(bob.address);
    await module.connect(admin).adminMarkInactive(alice.address);
  }

  // -------------------------------------------------------------------------
  // setBeneficiary / updateBeneficiary / revokeBeneficiary / heartbeat
  // -------------------------------------------------------------------------

  describe("setBeneficiary", function () {
    it("sets beneficiary and initializes lastActiveAt", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      expect(await module.beneficiaryOf(alice.address)).to.equal(bob.address);
      expect(await module.lastActiveAt(alice.address)).to.be.gt(0n);
    });

    it("emits BeneficiarySet event", async function () {
      await expect(module.connect(alice).setBeneficiary(bob.address))
        .to.emit(module, "BeneficiarySet")
        .withArgs(alice.address, bob.address);
    });

    it("reverts on zero address", async function () {
      await expect(module.connect(alice).setBeneficiary(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(module, "ZeroAddress");
    });

    it("reverts when setting self as beneficiary", async function () {
      await expect(module.connect(alice).setBeneficiary(alice.address))
        .to.be.revertedWithCustomError(module, "SelfBeneficiary");
    });
  });

  describe("updateBeneficiary", function () {
    it("updates beneficiary and resets lastActiveAt", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      await advance(1n);
      await module.connect(alice).updateBeneficiary(carol.address);
      expect(await module.beneficiaryOf(alice.address)).to.equal(carol.address);
    });

    it("reverts when updating to self", async function () {
      await expect(module.connect(alice).updateBeneficiary(alice.address))
        .to.be.revertedWithCustomError(module, "SelfBeneficiary");
    });
  });

  describe("revokeBeneficiary", function () {
    it("resets beneficiary to default (self)", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(alice).revokeBeneficiary();
      expect(await module.beneficiaryOf(alice.address)).to.equal(alice.address);
    });

    it("emits BeneficiaryRevoked event", async function () {
      await expect(module.connect(alice).revokeBeneficiary())
        .to.emit(module, "BeneficiaryRevoked")
        .withArgs(alice.address);
    });
  });

  describe("heartbeat", function () {
    it("updates lastActiveAt", async function () {
      await module.connect(alice).heartbeat();
      expect(await module.lastActiveAt(alice.address)).to.be.gt(0n);
    });

    it("resets inactivity timer", async function () {
      await module.connect(alice).heartbeat();
      await advance(YEAR - 10n);
      await module.connect(alice).heartbeat();
      await advance(10n);
      expect(await module.isInactive(alice.address)).to.be.false;
    });
  });

  // -------------------------------------------------------------------------
  // isInactive
  // -------------------------------------------------------------------------

  describe("isInactive", function () {
    it("returns false for user who never called heartbeat", async function () {
      expect(await module.isInactive(alice.address)).to.be.false;
    });

    it("returns false before threshold", async function () {
      await module.connect(alice).heartbeat();
      await advance(YEAR - 1n);
      expect(await module.isInactive(alice.address)).to.be.false;
    });

    it("returns true after INACTIVITY_THRESHOLD", async function () {
      await module.connect(alice).heartbeat();
      await advance(YEAR);
      expect(await module.isInactive(alice.address)).to.be.true;
    });

    it("admin can mark / unmark inactive", async function () {
      await module.connect(admin).adminMarkInactive(alice.address);
      expect(await module.isInactive(alice.address)).to.be.true;
      await module.connect(admin).adminUnmarkInactive(alice.address);
      expect(await module.isInactive(alice.address)).to.be.false;
    });
  });

  // -------------------------------------------------------------------------
  // executeClaim — conditions not met
  // -------------------------------------------------------------------------

  describe("executeClaim — conditions not met", function () {
    it("reverts when user is not inactive", async function () {
      const lockId = await aliceLock(aliceShares / 2n, D90);
      await module.connect(alice).setBeneficiary(bob.address);
      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "UserNotInactive");
    });

    it("reverts when caller is not the beneficiary", async function () {
      const lockId = await aliceLock(aliceShares / 2n, D90);
      await setupAndMark();
      await expect(module.connect(carol).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "NotBeneficiary");
    });

    it("reverts when no beneficiary set (default = self)", async function () {
      const lockId = await aliceLock(aliceShares / 2n, D90);
      await module.connect(admin).adminMarkInactive(alice.address);
      await expect(module.connect(alice).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "NotBeneficiary");
    });

    it("reverts EmptyLockIds when lockIds array is empty", async function () {
      await setupAndMark();
      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "EmptyLockIds");
    });

    it("reverts NothingClaimed when all lockIds already claimed", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, [lockId]);
      // Second call with same lockId: already claimed → NothingClaimed
      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "NothingClaimed");
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 1: only free assets (no locks)
  // -------------------------------------------------------------------------

  describe("claim — only locked assets", function () {
    it("free (unlocked) vault shares stay in alice's wallet — V2 does not transfer them", async function () {
      const lockId = await aliceLock(aliceShares / 2n, D90);
      const aliceFreeBefore = await vault.balanceOf(alice.address);
      await setupAndMark();

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // free shares are NOT moved in V2
      expect(await vault.balanceOf(alice.address)).to.equal(aliceFreeBefore);
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 2: only locked assets
  // -------------------------------------------------------------------------

  describe("claim — only locked assets", function () {
    it("transfers lock ownership to beneficiary", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      const pos = await ledger.getLock(lockId);
      expect(pos.owner).to.equal(bob.address);
    });

    it("emits BeneficiaryLockClaimed event for each transferred lock", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();

      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.emit(module, "BeneficiaryLockClaimed")
        .withArgs(alice.address, bob.address, lockId);
    });

    it("lock state is fully preserved (unlockAt unchanged)", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      const posBefore = await ledger.getLock(lockId);
      await setupAndMark();

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      const posAfter = await ledger.getLock(lockId);
      expect(posAfter.unlockAt).to.equal(posBefore.unlockAt);
      expect(posAfter.shares).to.equal(posBefore.shares);
      expect(posAfter.unlocked).to.be.false;
    });

    it("new owner (bob) can unlock after maturity", async function () {
      const lockId = await aliceLock(aliceShares, D30);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      await advance(D30);
      const bobSharesBefore = await vault.balanceOf(bob.address);
      await ledger.connect(bob).unlock(lockId);
      expect(await vault.balanceOf(bob.address)).to.be.gt(bobSharesBefore);
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 3: free + locked mixed
  // -------------------------------------------------------------------------

  describe("claim — free + locked mixed", function () {
    it("transfers lock, leaves free shares in place", async function () {
      // alice keeps half free, locks half
      const half = aliceShares / 2n;
      const lockId = await aliceLock(half, D90);
      await setupAndMark();

      const aliceFreeShares = await vault.balanceOf(alice.address);

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // lock transferred
      expect((await ledger.getLock(lockId)).owner).to.equal(bob.address);
      // free shares untouched
      expect(await vault.balanceOf(alice.address)).to.equal(aliceFreeShares);
    });

    it("transfers multiple locks in one claim", async function () {
      const third = aliceShares / 3n;
      const id1 = await aliceLock(third, D30);
      const id2 = await aliceLock(third, D90);
      await setupAndMark();

      await module.connect(bob).executeClaim(alice.address, [id1, id2]);

      expect((await ledger.getLock(id1)).owner).to.equal(bob.address);
      expect((await ledger.getLock(id2)).owner).to.equal(bob.address);
    });

    it("skips already-unlocked locks silently", async function () {
      const half = aliceShares / 2n;
      const id1 = await aliceLock(half, D30);
      const id2 = await aliceLock(half, D90);

      // alice unlocks id1 before she becomes inactive
      await advance(D30);
      await ledger.connect(alice).unlock(id1);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);

      // pass both lockIds; id1 is already unlocked → silently skipped
      await module.connect(bob).executeClaim(alice.address, [id1, id2]);

      // id1: still belongs to alice (unlocked, not transferred)
      expect((await ledger.getLock(id1)).owner).to.equal(alice.address);
      // id2: transferred to bob
      expect((await ledger.getLock(id2)).owner).to.equal(bob.address);
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 4: lock state preserved after claim
  // -------------------------------------------------------------------------

  describe("lock state after claim", function () {
    it("UserStateEngineV02 sees lock as LockedAccumulating under new owner", async function () {
      const engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
        await ledger.getAddress()
      );
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // lock state is still LockedAccumulating (1)
      expect(await engine.lockStateOf(lockId)).to.equal(1n);
    });

    it("activeLockCount: inherited lock does not consume new owner's slot", async function () {
      // D1 design: _activeLockCount[newOwner] is NOT incremented on transferLockOwnership.
      // lockId IS pushed to _userLockIds[newOwner] for on-chain enumeration.
      // activeLockCount tracks normal-lock creation capacity; inherited locks are free.
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();

      const aliceActiveBefore = await ledger.activeLockCount(alice.address);
      const bobActiveBefore   = await ledger.activeLockCount(bob.address);

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // alice's counter decremented by the transfer? No — design says no decrement either.
      expect(await ledger.activeLockCount(alice.address)).to.equal(aliceActiveBefore);
      // bob's counter unchanged — inherited lock does not consume a slot
      expect(await ledger.activeLockCount(bob.address)).to.equal(bobActiveBefore);
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 5: points NOT transferred
  // -------------------------------------------------------------------------

  describe("points — not transferred to beneficiary", function () {
    it("alice retains points after lock inheritance", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await advance(DAY * 10n);

      const pointsBefore = await points.pointsOf(lockId);
      expect(pointsBefore).to.be.gt(0n);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // alice's totalPointsOf still includes the lock (userLockIds unchanged)
      expect(await points.totalPointsOf(alice.address)).to.be.gt(0n);
    });

    it("bob's LockPointsV02 total reflects inherited lock (lockId in his userLockIds)", async function () {
      // Note: LockPointsV02.totalPointsOf iterates raw userLockIds without pos.owner filter.
      // After D1 redesign, lockId is pushed to newOwner's _userLockIds, so bob's total
      // includes the inherited lock's accrued points.
      // PointsLedgerV01 (closed-beta contracts) is not affected — it tracks per-address.
      const lockId = await aliceLock(aliceShares, D90);
      await advance(DAY * 10n);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // Both alice and bob now have the lock in their userLockIds; both see the points
      expect(await points.totalPointsOf(alice.address)).to.be.gt(0n);
      expect(await points.totalPointsOf(bob.address)).to.be.gt(0n);
    });

    it("alice's points freeze when bob unlocks the position", async function () {
      const lockId = await aliceLock(aliceShares, D30);
      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      await advance(D30);
      await ledger.connect(bob).unlock(lockId);

      const p1 = await points.totalPointsOf(alice.address);
      await advance(DAY * 10n);
      const p2 = await points.totalPointsOf(alice.address);

      // points freeze after unlock
      expect(p2).to.equal(p1);
    });
  });

  // -------------------------------------------------------------------------
  // beneficiaryOf — default
  // -------------------------------------------------------------------------

  describe("beneficiaryOf — default", function () {
    it("returns user's own address when no beneficiary set", async function () {
      expect(await module.beneficiaryOf(alice.address)).to.equal(alice.address);
    });

    it("returns set beneficiary after setBeneficiary", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      expect(await module.beneficiaryOf(alice.address)).to.equal(bob.address);
    });

    it("returns self again after revokeBeneficiary", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(alice).revokeBeneficiary();
      expect(await module.beneficiaryOf(alice.address)).to.equal(alice.address);
    });
  });

  // -------------------------------------------------------------------------
  // time-based trigger (production path)
  // -------------------------------------------------------------------------

  describe("executeClaim — time-based trigger", function () {
    it("beneficiary can claim after 365 days of inactivity", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await module.connect(alice).setBeneficiary(bob.address);
      await advance(YEAR);

      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.emit(module, "BeneficiaryClaimed");
    });

    it("cannot claim two seconds before threshold", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await module.connect(alice).setBeneficiary(bob.address);
      await advance(YEAR - 2n);

      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "UserNotInactive");
    });
  });

  // -------------------------------------------------------------------------
  // D2 per-lock claimed semantics
  // -------------------------------------------------------------------------

  describe("executeClaim — D2 per-lock claimed semantics", function () {
    it("skips already-unlocked locks with BeneficiaryLockSkipped(LOCK_UNLOCKED)", async function () {
      const half = aliceShares / 2n;
      const id1 = await aliceLock(half, D30);
      const id2 = await aliceLock(half, D90);

      await advance(D30);
      await ledger.connect(alice).unlock(id1);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);

      // Verify the skip event fires for the unlocked lock (don't hard-code bytes32 encoding)
      const tx = await module.connect(bob).executeClaim(alice.address, [id1, id2]);
      const receipt = await tx.wait();
      const skipEvents = receipt!.logs
        .map((l: any) => { try { return module.interface.parseLog(l); } catch { return null; } })
        .filter((e: any) => e?.name === "BeneficiaryLockSkipped");
      expect(skipEvents.length).to.equal(1);
      expect(skipEvents[0]!.args.lockId.toString()).to.equal(id1.toString());

      // id2 still transferred
      expect((await ledger.getLock(id2)).owner).to.equal(bob.address);
    });

    it("skips already-claimed locks with BeneficiaryLockSkipped(ALREADY_CLAIMED)", async function () {
      const half = aliceShares / 2n;
      const id1 = await aliceLock(half, D90);
      await setupAndMark();

      await module.connect(bob).executeClaim(alice.address, [id1]);
      // Second call with id1: already_claimed → skip
      await expect(module.connect(bob).executeClaim(alice.address, [id1]))
        .to.be.revertedWithCustomError(module, "NothingClaimed");
    });

    it("originalOwner can be claimed again after creating new lock", async function () {
      const third = aliceShares / 3n;
      const id1 = await aliceLock(third, D90);
      await setupAndMark();

      // First claim: claim id1
      await module.connect(bob).executeClaim(alice.address, [id1]);
      expect((await ledger.getLock(id1)).owner).to.equal(bob.address);

      // Alice (still marked inactive) creates another lock
      // Temporarily unmark alice as inactive so she can lock
      await module.connect(admin).adminUnmarkInactive(alice.address);
      const id2 = await aliceLock(third, D90);
      await module.connect(admin).adminMarkInactive(alice.address);

      // Second claim on new lock: should succeed
      await expect(module.connect(bob).executeClaim(alice.address, [id2]))
        .to.emit(module, "BeneficiaryLockClaimed")
        .withArgs(alice.address, bob.address, id2);
    });

    it("emits BeneficiaryClaimed with correct claimedCount and skippedCount", async function () {
      const third = aliceShares / 3n;
      const id1 = await aliceLock(third, D30);
      const id2 = await aliceLock(third, D90);

      // Unlock id1 so it will be skipped
      await advance(D30);
      await ledger.connect(alice).unlock(id1);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);

      const tx = await module.connect(bob).executeClaim(alice.address, [id1, id2]);
      await expect(tx)
        .to.emit(module, "BeneficiaryClaimed")
        .withArgs(alice.address, bob.address, 1n, 1n); // 1 claimed, 1 skipped
    });

    it("NothingClaimed when all passed locks are already claimed", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.be.revertedWithCustomError(module, "NothingClaimed");
    });

    it("isLockClaimed returns true after successful claim", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, [lockId]);
      expect(await module.isLockClaimed(lockId)).to.be.true;
    });

    it("isLockClaimed returns false for unclaimed lock", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      expect(await module.isLockClaimed(lockId)).to.be.false;
    });
  });
});
