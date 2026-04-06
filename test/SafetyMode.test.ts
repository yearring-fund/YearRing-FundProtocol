import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SafetyMode", function () {
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let manager: StrategyManagerV01;
  let strategy: DummyStrategy;
  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let other: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);
  const DEPOSIT = D6(1000);

  beforeEach(async function () {
    [, admin, treasury, alice, other] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(),
      "fbUSDC", "fbUSDC",
      treasury.address, admin.address
    );
    manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(),
      await vault.getAddress(),
      admin.address
    );
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );

    // Wire strategy into manager (must pause first)
    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();

    // Wire manager into vault
    await vault.connect(admin).setModules(await manager.getAddress());

    // Mint USDC for alice
    await usdc.mint(alice.address, DEPOSIT * 10n);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).addToAllowlist(alice.address);
  });

  // -------------------------------------------------------------------------
  // Mode state
  // -------------------------------------------------------------------------
  it("default mode is Normal", async function () {
    expect(await vault.systemMode()).to.equal(0);
  });

  it("admin can set mode to Paused", async function () {
    await expect(vault.connect(admin).setMode(1))
      .to.emit(vault, "ModeChanged")
      .withArgs(1);
    expect(await vault.systemMode()).to.equal(1);
  });

  it("admin can set mode to EmergencyExit", async function () {
    await vault.connect(admin).setMode(2);
    expect(await vault.systemMode()).to.equal(2);
  });

  it("admin can set mode back to Normal", async function () {
    await vault.connect(admin).setMode(2);
    await vault.connect(admin).setMode(0);
    expect(await vault.systemMode()).to.equal(0);
  });

  it("non-admin cannot set mode", async function () {
    await expect(vault.connect(other).setMode(1)).to.be.reverted;
  });

  // -------------------------------------------------------------------------
  // Deposits in all modes
  // -------------------------------------------------------------------------
  it("deposit allowed in Normal mode", async function () {
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
    expect(await vault.balanceOf(alice.address)).to.be.gt(0);
  });

  it("deposit blocked in Paused mode (V3: Paused gates new deposits)", async function () {
    await vault.connect(admin).setMode(1);
    await expect(
      vault.connect(alice).deposit(DEPOSIT, alice.address)
    ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
  });

  it("deposit blocked in EmergencyExit mode", async function () {
    await vault.connect(admin).setMode(2);
    await expect(
      vault.connect(alice).deposit(DEPOSIT, alice.address)
    ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
  });

  // -------------------------------------------------------------------------
  // transferToStrategyManager mode guards
  // -------------------------------------------------------------------------
  it("transferToStrategyManager blocked in Paused mode", async function () {
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(0);
    await vault.connect(admin).setMode(1);
    await expect(
      vault.connect(admin).transferToStrategyManager(DEPOSIT)
    ).to.be.revertedWithCustomError(vault, "NotInNormalMode");
  });

  it("transferToStrategyManager blocked in EmergencyExit mode", async function () {
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(0);
    await vault.connect(admin).setMode(2);
    await expect(
      vault.connect(admin).transferToStrategyManager(DEPOSIT)
    ).to.be.revertedWithCustomError(vault, "NotInNormalMode");
  });

  it("transferToStrategyManager allowed in Normal mode", async function () {
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000);
    const toTransfer = ethers.parseUnits("700", 6); // max 70% of 1000
    const before = await usdc.balanceOf(await manager.getAddress());
    await vault.connect(admin).transferToStrategyManager(toTransfer);
    expect(await usdc.balanceOf(await manager.getAddress())).to.equal(before + toTransfer);
  });

  // -------------------------------------------------------------------------
  // invest blocked in non-Normal vault modes
  // -------------------------------------------------------------------------
  it("invest blocked in Paused mode via vault mode check", async function () {
    // Fund the manager with USDC directly so it has idle funds
    await usdc.mint(await manager.getAddress(), DEPOSIT);
    await vault.connect(admin).setMode(1);
    await expect(
      manager.connect(admin).invest(DEPOSIT)
    ).to.be.revertedWithCustomError(manager, "NotInNormalMode");
  });

  // -------------------------------------------------------------------------
  // Deposit pause controls
  // -------------------------------------------------------------------------
  it("pauseDeposit blocks deposit", async function () {
    await vault.connect(admin).pauseDeposits();
    await expect(
      vault.connect(alice).deposit(DEPOSIT, alice.address)
    ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
  });

  it("unpauseDeposit restores deposit", async function () {
    await vault.connect(admin).pauseDeposits();
    await vault.connect(admin).unpauseDeposits();
    await vault.connect(alice).deposit(DEPOSIT, alice.address);
    expect(await vault.balanceOf(alice.address)).to.be.gt(0);
  });

  // -------------------------------------------------------------------------
  // ModeChanged event args
  // -------------------------------------------------------------------------
  it("setMode emits ModeChanged event with correct args", async function () {
    await expect(vault.connect(admin).setMode(1))
      .to.emit(vault, "ModeChanged")
      .withArgs(1);
    await expect(vault.connect(admin).setMode(2))
      .to.emit(vault, "ModeChanged")
      .withArgs(2);
    await expect(vault.connect(admin).setMode(0))
      .to.emit(vault, "ModeChanged")
      .withArgs(0);
  });
});
