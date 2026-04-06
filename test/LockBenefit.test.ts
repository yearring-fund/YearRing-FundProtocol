import { expect } from "chai";
import { ethers } from "hardhat";
import { LockLedgerV02, LockBenefitV02, FundVaultV01, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LockBenefitV02", function () {
  let ledger: LockLedgerV02;
  let benefit: LockBenefitV02;
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let admin: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;

  const D6   = (n: number) => ethers.parseUnits(String(n), 6);
  const DAY  = 86400n;
  const D30  = 30n * DAY;
  const D90  = 90n * DAY;
  const D180 = 180n * DAY;
  const D365 = 365n * DAY;

  const BRONZE_BPS = 10_000n;
  const SILVER_BPS = 13_000n;
  const GOLD_BPS   = 18_000n;

  // Tier enum values as numbers (matches Solidity: None=0, Bronze=1, Silver=2, Gold=3)
  const TIER_NONE   = 0n;
  const TIER_BRONZE = 1n;
  const TIER_SILVER = 2n;
  const TIER_GOLD   = 3n;

  let aliceShares: bigint;

  beforeEach(async function () {
    [, admin, guardian, treasury, alice] = await ethers.getSigners();

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
    benefit = await (await ethers.getContractFactory("LockBenefitV02")).deploy(
      await ledger.getAddress()
    );

    const OPERATOR_ROLE = await ledger.OPERATOR_ROLE();
    await ledger.connect(admin).grantRole(OPERATOR_ROLE, alice.address);

    // Alice deposits 100 USDC → gets shares
    await usdc.mint(alice.address, D6(100));
    await usdc.connect(alice).approve(await vault.getAddress(), D6(100));
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(D6(100), alice.address);
    aliceShares = await vault.balanceOf(alice.address);
  });

  // helper: alice locks `shares` for `duration`, returns lockId
  async function lockAs(shares: bigint, duration: bigint): Promise<bigint> {
    await vault.connect(alice).approve(await ledger.getAddress(), shares);
    const tx = await ledger.connect(alice).lockFor(alice.address, shares, duration);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((l: any) => { try { return ledger.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "Locked");
    return event!.args.lockId;
  }

  // -------------------------------------------------------------------------
  // tierOf — range boundaries
  // -------------------------------------------------------------------------

  describe("tierOf — range mapping", function () {
    it("returns Bronze for exactly 30 days", async function () {
      const id = await lockAs(aliceShares / 5n, D30);
      expect(await benefit.tierOf(id)).to.equal(TIER_BRONZE);
    });

    it("returns Bronze for 45 days (mid-range)", async function () {
      const id = await lockAs(aliceShares / 5n, 45n * DAY);
      expect(await benefit.tierOf(id)).to.equal(TIER_BRONZE);
    });

    it("returns Bronze for 89 days (upper boundary of Bronze)", async function () {
      const id = await lockAs(aliceShares / 5n, 89n * DAY);
      expect(await benefit.tierOf(id)).to.equal(TIER_BRONZE);
    });

    it("returns Silver for exactly 90 days", async function () {
      const id = await lockAs(aliceShares / 5n, D90);
      expect(await benefit.tierOf(id)).to.equal(TIER_SILVER);
    });

    it("returns Silver for 120 days (mid-range)", async function () {
      const id = await lockAs(aliceShares / 5n, 120n * DAY);
      expect(await benefit.tierOf(id)).to.equal(TIER_SILVER);
    });

    it("returns Silver for 179 days (upper boundary of Silver)", async function () {
      const id = await lockAs(aliceShares / 5n, 179n * DAY);
      expect(await benefit.tierOf(id)).to.equal(TIER_SILVER);
    });

    it("returns Gold for exactly 180 days", async function () {
      const id = await lockAs(aliceShares / 5n, D180);
      expect(await benefit.tierOf(id)).to.equal(TIER_GOLD);
    });

    it("returns Gold for 270 days (mid-range)", async function () {
      const id = await lockAs(aliceShares / 5n, 270n * DAY);
      expect(await benefit.tierOf(id)).to.equal(TIER_GOLD);
    });

    it("returns Gold for exactly 365 days", async function () {
      const id = await lockAs(aliceShares / 5n, D365);
      expect(await benefit.tierOf(id)).to.equal(TIER_GOLD);
    });
  });

  // -------------------------------------------------------------------------
  // tierOf — edge cases
  // -------------------------------------------------------------------------

  describe("tierOf — edge cases", function () {
    it("returns None for non-existent lockId", async function () {
      expect(await benefit.tierOf(999n)).to.equal(TIER_NONE);
    });

    it("returns None for an unlocked position", async function () {
      const id = await lockAs(aliceShares / 2n, D30);

      // advance time past unlock
      await ethers.provider.send("evm_increaseTime", [Number(D30)]);
      await ethers.provider.send("evm_mine", []);

      await ledger.connect(alice).unlock(id);
      expect(await benefit.tierOf(id)).to.equal(TIER_NONE);
    });
  });

  // -------------------------------------------------------------------------
  // multiplierOf
  // -------------------------------------------------------------------------

  describe("multiplierOf", function () {
    it("returns 10000 bps for Bronze lock", async function () {
      const id = await lockAs(aliceShares / 5n, D30);
      expect(await benefit.multiplierOf(id)).to.equal(BRONZE_BPS);
    });

    it("returns 13000 bps for Silver lock", async function () {
      const id = await lockAs(aliceShares / 5n, D90);
      expect(await benefit.multiplierOf(id)).to.equal(SILVER_BPS);
    });

    it("returns 18000 bps for Gold lock", async function () {
      const id = await lockAs(aliceShares / 5n, D180);
      expect(await benefit.multiplierOf(id)).to.equal(GOLD_BPS);
    });

    it("returns 0 for non-existent lockId", async function () {
      expect(await benefit.multiplierOf(999n)).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------------
  // multiplierForTier (pure)
  // -------------------------------------------------------------------------

  describe("multiplierForTier", function () {
    it("None → 0", async function () {
      expect(await benefit.multiplierForTier(TIER_NONE)).to.equal(0n);
    });

    it("Bronze → 10000", async function () {
      expect(await benefit.multiplierForTier(TIER_BRONZE)).to.equal(BRONZE_BPS);
    });

    it("Silver → 13000", async function () {
      expect(await benefit.multiplierForTier(TIER_SILVER)).to.equal(SILVER_BPS);
    });

    it("Gold → 18000", async function () {
      expect(await benefit.multiplierForTier(TIER_GOLD)).to.equal(GOLD_BPS);
    });
  });

  // -------------------------------------------------------------------------
  // tier is stable — same lockId always returns same tier
  // -------------------------------------------------------------------------

  describe("tier stability", function () {
    it("same lockId returns same tier regardless of when queried", async function () {
      const id = await lockAs(aliceShares / 2n, D90);
      const t1 = await benefit.tierOf(id);

      await ethers.provider.send("evm_increaseTime", [Number(30n * DAY)]);
      await ethers.provider.send("evm_mine", []);

      const t2 = await benefit.tierOf(id);
      expect(t1).to.equal(t2);
      expect(t1).to.equal(TIER_SILVER);
    });
  });
});
