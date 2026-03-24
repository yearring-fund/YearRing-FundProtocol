import { expect } from "chai";
import { ethers } from "hardhat";
import { DummyStrategy, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DummyStrategy", function () {
  let strategy: DummyStrategy;
  let usdc: MockUSDC;
  let manager: SignerWithAddress;
  let other: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);
  const AMOUNT = D6(1000);

  beforeEach(async function () {
    [, manager, other] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );
  });

  // ---------------------------------------------------------------------------
  // underlying
  // ---------------------------------------------------------------------------
  it("underlying() returns USDC address", async function () {
    expect(await strategy.underlying()).to.equal(await usdc.getAddress());
  });

  // ---------------------------------------------------------------------------
  // invest
  // ---------------------------------------------------------------------------
  describe("invest", function () {
    it("accepts pushed USDC without moving it", async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
      await strategy.connect(manager).invest(AMOUNT);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(AMOUNT);
    });
  });

  // ---------------------------------------------------------------------------
  // totalUnderlying
  // ---------------------------------------------------------------------------
  describe("totalUnderlying", function () {
    it("returns USDC balance", async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
      expect(await strategy.totalUnderlying()).to.equal(AMOUNT);
    });
    it("increases after simulateYield", async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
      await strategy.simulateYield(D6(100));
      expect(await strategy.totalUnderlying()).to.equal(AMOUNT + D6(100));
    });
    it("decreases after simulateLoss", async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
      await strategy.simulateLoss(D6(200));
      expect(await strategy.totalUnderlying()).to.equal(AMOUNT - D6(200));
    });
    it("returns 0 when loss exceeds balance", async function () {
      await strategy.simulateLoss(D6(9999));
      expect(await strategy.totalUnderlying()).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // divest
  // ---------------------------------------------------------------------------
  describe("divest", function () {
    beforeEach(async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
    });

    it("transfers USDC to manager and returns withdrawn", async function () {
      const before = await usdc.balanceOf(manager.address);
      const withdrawn = await strategy.connect(manager).divest.staticCall(AMOUNT);
      await strategy.connect(manager).divest(AMOUNT);
      expect(await usdc.balanceOf(manager.address)).to.equal(before + AMOUNT);
      expect(withdrawn).to.equal(AMOUNT);
    });
    it("caps at balance if amount > balance", async function () {
      const withdrawn = await strategy.connect(manager).divest.staticCall(AMOUNT * 2n);
      await strategy.connect(manager).divest(AMOUNT * 2n);
      expect(withdrawn).to.equal(AMOUNT);
    });
  });

  // ---------------------------------------------------------------------------
  // emergencyExit
  // ---------------------------------------------------------------------------
  describe("emergencyExit", function () {
    it("transfers all USDC to manager", async function () {
      await usdc.mint(await strategy.getAddress(), AMOUNT);
      const before = await usdc.balanceOf(manager.address);
      await strategy.connect(manager).emergencyExit();
      expect(await usdc.balanceOf(manager.address)).to.equal(before + AMOUNT);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(0);
    });
    it("no-op when balance is 0", async function () {
      await expect(strategy.connect(manager).emergencyExit()).to.not.be.reverted;
    });
  });
});
