import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("EmergencyExit", function () {
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

    // Wire strategy and vault
    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();
    await vault.connect(admin).setModules(await manager.getAddress());

    // Alice deposits 1000 USDC
    await usdc.mint(alice.address, DEPOSIT);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(DEPOSIT, alice.address);

    // Admin moves funds: vault → manager → strategy (max 70% per V3 spec)
    const deployed = DEPOSIT * 70n / 100n; // 700 USDC
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000);
    await vault.connect(admin).transferToStrategyManager(deployed);
    await manager.connect(admin).invest(deployed);
  });

  // -------------------------------------------------------------------------
  // emergencyExit sends funds to vault, not admin
  // -------------------------------------------------------------------------
  it("emergencyExit returns funds to vault, not to admin", async function () {
    const adminUsdcBefore = await usdc.balanceOf(admin.address);
    const vaultUsdcBefore = await usdc.balanceOf(await vault.getAddress());

    await manager.connect(admin).emergencyExit();

    const adminUsdcAfter = await usdc.balanceOf(admin.address);
    const vaultUsdcAfter = await usdc.balanceOf(await vault.getAddress());
    const managerUsdcAfter = await usdc.balanceOf(await manager.getAddress());

    // Admin received no USDC
    expect(adminUsdcAfter).to.equal(adminUsdcBefore);

    // Vault received the funds
    expect(vaultUsdcAfter).to.be.gt(vaultUsdcBefore);
    expect(vaultUsdcAfter).to.equal(DEPOSIT);

    // Manager has no idle funds
    expect(managerUsdcAfter).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // partialEmergencyExit returns partial funds to vault
  // -------------------------------------------------------------------------
  it("partial emergencyExit returns partial funds to vault", async function () {
    // Only 700 USDC is deployed (70% of 1000); partial exit of 350 (half of deployed)
    const partialAmount = D6(350);
    const vaultUsdcBefore = await usdc.balanceOf(await vault.getAddress());
    const strategyUsdcBefore = await usdc.balanceOf(await strategy.getAddress());

    await manager.connect(admin).partialEmergencyExit(partialAmount);

    const vaultUsdcAfter = await usdc.balanceOf(await vault.getAddress());
    const strategyUsdcAfter = await usdc.balanceOf(await strategy.getAddress());

    // Vault received 350 USDC
    expect(vaultUsdcAfter - vaultUsdcBefore).to.equal(partialAmount);

    // Strategy has 700 - 350 = 350 USDC remaining
    expect(strategyUsdcAfter).to.equal(strategyUsdcBefore - partialAmount);
  });

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------
  it("non-admin cannot call emergencyExit", async function () {
    await expect(manager.connect(other).emergencyExit()).to.be.reverted;
  });

  it("non-admin cannot call partialEmergencyExit", async function () {
    await expect(manager.connect(other).partialEmergencyExit(D6(100))).to.be.reverted;
  });

  // -------------------------------------------------------------------------
  // emergencyExit preserves totalAssets
  // -------------------------------------------------------------------------
  it("emergencyExit + return to vault preserves totalAssets", async function () {
    // totalAssets = vault balance + manager's totalManagedAssets (which includes strategy)
    const totalBefore = await vault.totalAssets();

    await manager.connect(admin).emergencyExit();

    // After exit, all funds are back in vault, strategy manager has 0
    const totalAfter = await vault.totalAssets();

    // totalAssets should be unchanged (all funds just moved back to vault)
    expect(totalAfter).to.equal(totalBefore);
  });
});
