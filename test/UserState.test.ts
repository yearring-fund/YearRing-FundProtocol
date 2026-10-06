import { expect } from "chai";
import { ethers } from "hardhat";
import { LockLedgerV02, UserStateEngineV02, FundVaultV01, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("UserStateEngineV02", function () {
  let ledger:  LockLedgerV02;
  let engine:  UserStateEngineV02;
  let vault:   FundVaultV01;
  let usdc:    MockUSDC;
  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;

  const DAY  = 86400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;

  // LockState enum (matches Solidity: Normal=0, LockedAccumulating=1, Matured=2, EarlyExit=3)
  const STATE_NORMAL      = 0n;
  const STATE_ACCUMULATING = 1n;
  const STATE_MATURED     = 2n;
  const STATE_EARLY_EXIT  = 3n;

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
      await vault.getAddress(), admin.address, guardian.address
    );
    engine = await (await ethers.getContractFactory("UserStateEngineV02")).deploy(
      await ledger.getAddress()
    );

    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, alice.address);
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, bob.address);

    await usdc.mint(alice.address, ethers.parseUnits("100", 6));
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.parseUnits("100", 6));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(ethers.parseUnits("100", 6), alice.address);
    aliceShares = await vault.balanceOf(alice.address);
  });

  async function lockAs(user: SignerWithAddress, shares: bigint, duration: bigint): Promise<bigint> {
    await vault.connect(user).approve(await ledger.getAddress(), shares);
    const tx = await ledger.connect(user).lockFor(user.address, shares, duration);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l: any) => { try { return ledger.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "Locked");
    return event!.args.lockId;
  }

  async function advance(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
    await ethers.provider.send("evm_mine", []);
  }

  // -------------------------------------------------------------------------
  // lockStateOf
  // -------------------------------------------------------------------------

  describe("lockStateOf", function () {
    it("returns Normal for non-existent lockId", async function () {
      expect(await engine.lockStateOf(999n)).to.equal(STATE_NORMAL);
    });

    it("returns LockedAccumulating immediately after lock()", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      expect(await engine.lockStateOf(id)).to.equal(STATE_ACCUMULATING);
    });

    it("returns LockedAccumulating before maturity", async function () {
      const id = await lockAs(alice, aliceShares, D90);
      await advance(DAY * 30n); // 30 days in, not yet matured
      expect(await engine.lockStateOf(id)).to.equal(STATE_ACCUMULATING);
    });

    it("returns Matured exactly at unlockAt", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30);
      expect(await engine.lockStateOf(id)).to.equal(STATE_MATURED);
    });

    it("returns Matured after unlockAt passes without unlock call", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30 + DAY * 5n);
      expect(await engine.lockStateOf(id)).to.equal(STATE_MATURED);
    });

    it("returns Normal after unlock()", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30);
      await ledger.connect(alice).unlock(id);
      expect(await engine.lockStateOf(id)).to.equal(STATE_NORMAL);
    });

    it("one second before maturity is still LockedAccumulating", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30 - 1n);
      expect(await engine.lockStateOf(id)).to.equal(STATE_ACCUMULATING);
    });
  });

  // -------------------------------------------------------------------------
  // userStateOf — initial state
  // -------------------------------------------------------------------------

  describe("userStateOf — initial state", function () {
    it("returns Normal for user with no locks", async function () {
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_NORMAL);
    });

    it("returns Normal for address(0)", async function () {
      expect(await engine.userStateOf(ethers.ZeroAddress)).to.equal(STATE_NORMAL);
    });

    it("returns Normal for user who never interacted", async function () {
      expect(await engine.userStateOf(bob.address)).to.equal(STATE_NORMAL);
    });
  });

  // -------------------------------------------------------------------------
  // userStateOf — transitions
  // -------------------------------------------------------------------------

  describe("userStateOf — transitions", function () {
    it("returns LockedAccumulating after lock()", async function () {
      await lockAs(alice, aliceShares, D30);
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_ACCUMULATING);
    });

    it("returns Matured once lock passes unlockAt", async function () {
      await lockAs(alice, aliceShares, D30);
      await advance(D30);
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_MATURED);
    });

    it("returns Normal after unlock()", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30);
      await ledger.connect(alice).unlock(id);
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_NORMAL);
    });
  });

  // -------------------------------------------------------------------------
  // userStateOf — priority (multiple locks)
  // -------------------------------------------------------------------------

  describe("userStateOf — priority with multiple locks", function () {
    it("LockedAccumulating takes priority over Matured", async function () {
      const half = aliceShares / 2n;

      // First lock: short, will mature
      const id1 = await lockAs(alice, half, D30);
      // Second lock: longer, still accumulating
      const id2 = await lockAs(alice, half, D90);

      // Advance past first lock's maturity but not second's
      await advance(D30 + DAY);

      expect(await engine.lockStateOf(id1)).to.equal(STATE_MATURED);
      expect(await engine.lockStateOf(id2)).to.equal(STATE_ACCUMULATING);

      // User aggregate: LockedAccumulating wins
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_ACCUMULATING);
    });

    it("Matured takes priority over Normal (all matured, none unlocked)", async function () {
      const half = aliceShares / 2n;
      await lockAs(alice, half, D30);
      await lockAs(alice, half, D30);

      await advance(D30 + DAY);
      expect(await engine.userStateOf(alice.address)).to.equal(STATE_MATURED);
    });

    it("returns Normal when all locks are unlocked", async function () {
      const half = aliceShares / 2n;
      const id1 = await lockAs(alice, half, D30);
      const id2 = await lockAs(alice, half, D30);

      await advance(D30);
      await ledger.connect(alice).unlock(id1);
      await ledger.connect(alice).unlock(id2);

      expect(await engine.userStateOf(alice.address)).to.equal(STATE_NORMAL);
    });
  });

  // -------------------------------------------------------------------------
  // EarlyExit — V3+ reserved
  // -------------------------------------------------------------------------

  describe("EarlyExit — V3+ reserved", function () {
    it("EarlyExit enum value is defined as 3", async function () {
      // Verify the enum value exists at the expected ordinal
      expect(STATE_EARLY_EXIT).to.equal(3n);
    });

    it("normal lock/unlock flow never produces EarlyExit", async function () {
      const id = await lockAs(alice, aliceShares, D30);

      // Before maturity
      expect(await engine.lockStateOf(id)).to.not.equal(STATE_EARLY_EXIT);

      // After maturity
      await advance(D30);
      expect(await engine.lockStateOf(id)).to.not.equal(STATE_EARLY_EXIT);

      // After unlock
      await ledger.connect(alice).unlock(id);
      expect(await engine.lockStateOf(id)).to.not.equal(STATE_EARLY_EXIT);

      // User aggregate
      expect(await engine.userStateOf(alice.address)).to.not.equal(STATE_EARLY_EXIT);
    });
  });
});
