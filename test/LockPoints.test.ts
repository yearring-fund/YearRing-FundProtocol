import { expect } from "chai";
import { ethers } from "hardhat";
import { LockLedgerV02, LockBenefitV02, LockPointsV02, FundVaultV01, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LockPointsV02", function () {
  let ledger:  LockLedgerV02;
  let benefit: LockBenefitV02;
  let points:  LockPointsV02;
  let vault:   FundVaultV01;
  let usdc:    MockUSDC;
  let admin:    SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice:    SignerWithAddress;
  let bob:      SignerWithAddress;

  const D6  = (n: number) => ethers.parseUnits(String(n), 6);
  const DAY = 86400n;
  const D30  = 30n  * DAY;
  const D90  = 90n  * DAY;
  const D180 = 180n * DAY;

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
    benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
      await ledger.getAddress()
    );
    points = await (await ethers.getContractFactory("LockPointsV02")).deploy(
      await ledger.getAddress(),
      await benefit.getAddress(),
      await vault.getAddress()
    );

    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, alice.address);
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, bob.address);

    // Alice deposits 100 USDC
    await usdc.mint(alice.address, D6(100));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(100));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(100), alice.address);
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
  // pointsOf — basic accumulation
  // -------------------------------------------------------------------------

  describe("pointsOf — basic accumulation", function () {
    it("returns 0 before any time elapses (same block)", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      expect(await points.pointsOf(id)).to.equal(0n);
    });

    it("returns 0 for non-existent lockId", async function () {
      expect(await points.pointsOf(999n)).to.equal(0n);
    });

    it("accumulates after 1 day", async function () {
      const id = await lockAs(alice, aliceShares, D90);
      await advance(DAY);
      expect(await points.pointsOf(id)).to.be.gt(0n);
    });

    it("grows with more elapsed days", async function () {
      const id = await lockAs(alice, aliceShares, D90);
      await advance(DAY);
      const p1 = await points.pointsOf(id);
      await advance(DAY);
      const p2 = await points.pointsOf(id);
      expect(p2).to.be.gt(p1);
    });
  });

  // -------------------------------------------------------------------------
  // same principal, different tier → different points
  // -------------------------------------------------------------------------

  describe("same principal, different tier → different points", function () {
    it("Silver lock earns more points than Bronze after same elapsed time", async function () {
      const half = aliceShares / 2n;
      const idBronze = await lockAs(alice, half, D30);
      const idSilver = await lockAs(alice, half, D90);

      await advance(DAY * 30n);

      const pBronze = await points.pointsOf(idBronze);
      const pSilver = await points.pointsOf(idSilver);
      expect(pSilver).to.be.gt(pBronze);
    });

    it("Gold lock earns more points than Silver after same elapsed time", async function () {
      // Bob deposits same amount
      await usdc.mint(bob.address, D6(100));
      await usdc.connect(bob).approve(await vault.getAddress(), D6(100));
      await vault.connect(admin).addToAllowlist(bob.address);
      await vault.connect(bob).deposit(D6(100), bob.address);
      const bobShares = await vault.balanceOf(bob.address);

      const half = aliceShares / 2n;
      const idSilver = await lockAs(alice, half, D90);
      const idGold   = await lockAs(bob,   bobShares / 2n, D180);

      await advance(DAY * 30n);

      const pSilver = await points.pointsOf(idSilver);
      const pGold   = await points.pointsOf(idGold);
      expect(pGold).to.be.gt(pSilver);
    });

    it("multiplier ratio is correct: Silver/Bronze ≈ 1.3", async function () {
      const half = aliceShares / 2n;
      const idBronze = await lockAs(alice, half, D30);
      const idSilver = await lockAs(alice, half, D90);

      await advance(DAY * 30n);

      const pBronze = await points.pointsOf(idBronze);
      const pSilver = await points.pointsOf(idSilver);

      // ratio should be 13000/10000 = 1.3 — allow ±1% tolerance for integer division
      const ratio = pSilver * 10000n / pBronze;
      expect(ratio).to.be.gte(12900n);
      expect(ratio).to.be.lte(13100n);
    });
  });

  // -------------------------------------------------------------------------
  // unlocked user points freeze
  // -------------------------------------------------------------------------

  describe("unlock after maturity — points freeze", function () {
    it("points stop growing after unlock", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30);

      await ledger.connect(alice).unlock(id);
      const pAtUnlock = await points.pointsOf(id);

      // advance more time — points should not grow
      await advance(DAY * 10n);
      const pLater = await points.pointsOf(id);

      expect(pLater).to.equal(pAtUnlock);
    });

    it("unlocked points are non-zero (accumulated during lock period)", async function () {
      const id = await lockAs(alice, aliceShares, D30);
      await advance(D30);
      await ledger.connect(alice).unlock(id);
      expect(await points.pointsOf(id)).to.be.gt(0n);
    });
  });

  // -------------------------------------------------------------------------
  // user with no locks
  // -------------------------------------------------------------------------

  describe("user with no locks", function () {
    it("totalPointsOf returns 0 for user who never locked", async function () {
      expect(await points.totalPointsOf(bob.address)).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // totalPointsOf
  // -------------------------------------------------------------------------

  describe("totalPointsOf", function () {
    it("sums points across multiple active locks", async function () {
      const third = aliceShares / 3n;
      const id1 = await lockAs(alice, third, D30);
      const id2 = await lockAs(alice, third, D90);

      await advance(DAY * 10n);

      const p1 = await points.pointsOf(id1);
      const p2 = await points.pointsOf(id2);
      const total = await points.totalPointsOf(alice.address);

      expect(total).to.equal(p1 + p2);
    });

    it("includes frozen points from unlocked positions", async function () {
      const half = aliceShares / 2n;
      const id1 = await lockAs(alice, half, D30);
      const id2 = await lockAs(alice, half, D90);

      await advance(D30);
      await ledger.connect(alice).unlock(id1);

      await advance(DAY * 5n);

      const p1 = await points.pointsOf(id1); // frozen
      const p2 = await points.pointsOf(id2); // still growing
      const total = await points.totalPointsOf(alice.address);

      expect(total).to.equal(p1 + p2);
    });
  });
});
