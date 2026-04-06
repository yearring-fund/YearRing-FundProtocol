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
      await module.connect(alice).setBeneficiary(bob.address);
      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "UserNotInactive");
    });

    it("reverts when caller is not the beneficiary", async function () {
      await setupAndMark();
      await expect(module.connect(carol).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "NotBeneficiary");
    });

    it("reverts when no beneficiary set (default = self)", async function () {
      await module.connect(admin).adminMarkInactive(alice.address);
      await expect(module.connect(alice).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "NotBeneficiary");
    });

    it("reverts on double claim", async function () {
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, []);
      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "AlreadyClaimed");
    });
  });

  // -------------------------------------------------------------------------
  // D9 scenario 1: only free assets (no locks)
  // -------------------------------------------------------------------------

  describe("claim — only free assets", function () {
    it("records claim event when alice has no locks", async function () {
      // alice holds only free fbUSDC, no locks
      await setupAndMark();

      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.emit(module, "BeneficiaryClaimed");

      expect(await module.claimed(alice.address)).to.be.true;
    });

    it("free shares stay in alice's wallet (V2: no on-chain transfer)", async function () {
      const sharesBefore = await vault.balanceOf(alice.address);
      await setupAndMark();
      await module.connect(bob).executeClaim(alice.address, []);
      // free shares are NOT moved in V2
      expect(await vault.balanceOf(alice.address)).to.equal(sharesBefore);
      expect(await vault.balanceOf(bob.address)).to.equal(0n);
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

    it("emits LockInherited event for each transferred lock", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();

      await expect(module.connect(bob).executeClaim(alice.address, [lockId]))
        .to.emit(module, "LockInherited")
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

    it("activeLockCount: transferLockOwnership intentionally does NOT update counters", async function () {
      // Design decision: _activeLockCount and _userLockIds are not modified by transferLockOwnership.
      // Points remain with the original owner; inherited lock does not consume new owner's slot capacity.
      // The new owner discovers the lockId via the LockOwnershipTransferred event.
      const lockId = await aliceLock(aliceShares, D90);
      await setupAndMark();

      const aliceActiveBefore = await ledger.activeLockCount(alice.address);
      const bobActiveBefore   = await ledger.activeLockCount(bob.address);

      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // Both counters remain unchanged — this is intentional per contract NatSpec
      expect(await ledger.activeLockCount(alice.address)).to.equal(aliceActiveBefore);
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

    it("bob gains no points from inherited lock", async function () {
      const lockId = await aliceLock(aliceShares, D90);
      await advance(DAY * 10n);

      await module.connect(alice).setBeneficiary(bob.address);
      await module.connect(admin).adminMarkInactive(alice.address);
      await module.connect(bob).executeClaim(alice.address, [lockId]);

      // bob's totalPointsOf = 0 (lockId not in bob's userLockIds)
      expect(await points.totalPointsOf(bob.address)).to.equal(0n);
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
      await module.connect(alice).setBeneficiary(bob.address);
      await advance(YEAR);

      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.emit(module, "BeneficiaryClaimed");
    });

    it("cannot claim two seconds before threshold", async function () {
      await module.connect(alice).setBeneficiary(bob.address);
      await advance(YEAR - 2n);

      await expect(module.connect(bob).executeClaim(alice.address, []))
        .to.be.revertedWithCustomError(module, "UserNotInactive");
    });
  });
});
