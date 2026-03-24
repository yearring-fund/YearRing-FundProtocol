import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, StrategyManagerV01, DummyStrategy, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Integration: FundVaultV01 + StrategyManagerV01 + DummyStrategy", function () {
  let vault: FundVaultV01;
  let manager: StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc: MockUSDC;

  let admin: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);

  async function fullSetup() {
    [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();

    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "Fund Vault", "fvUSDC",
      treasury.address, guardian.address, admin.address
    );
    manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(),
      await vault.getAddress(),
      admin.address,
      guardian.address
    );
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );

    // Wire up
    await vault.connect(admin).setModules(await manager.getAddress());
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000); // 30% reserve

    await manager.connect(guardian).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();

    // Fund users
    await usdc.mint(alice.address, D6(10_000));
    await usdc.mint(bob.address, D6(10_000));
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  }

  beforeEach(fullSetup);

  // ---------------------------------------------------------------------------
  // 4.1 资金流转不影响净值
  // ---------------------------------------------------------------------------
  describe("4.1 capital movement preserves totalAssets and pricePerShare", function () {
    it("totalAssets unchanged after deposit → transfer → invest", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const totalBefore = await vault.totalAssets();

      // Transfer 70% to manager
      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);

      // Invest all idle in manager
      const idle = await manager.idleUnderlying();
      await manager.connect(admin).invest(idle);

      expect(await vault.totalAssets()).to.equal(totalBefore);
    });

    it("pricePerShare unchanged after deposit → transfer → invest", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const priceBefore = await vault.pricePerShare();

      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);
      await manager.connect(admin).invest(await manager.idleUnderlying());

      expect(await vault.pricePerShare()).to.equal(priceBefore);
    });

    it("second depositor gets correct shares after capital deployed", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);
      await manager.connect(admin).invest(await manager.idleUnderlying());

      // Bob deposits at same price
      const priceBefore = await vault.pricePerShare();
      await vault.connect(bob).deposit(D6(1000), bob.address);
      expect(await vault.pricePerShare()).to.equal(priceBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // 4.2 收益反映
  // ---------------------------------------------------------------------------
  describe("4.2 yield accrual increases pricePerShare", function () {
    it("simulateYield increases totalAssets", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);
      await manager.connect(admin).invest(await manager.idleUnderlying());

      const totalBefore = await vault.totalAssets();
      await strategy.simulateYield(D6(100)); // +100 USDC yield
      expect(await vault.totalAssets()).to.equal(totalBefore + D6(100));
    });

    it("simulateYield increases pricePerShare", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);
      await manager.connect(admin).invest(await manager.idleUnderlying());

      const priceBefore = await vault.pricePerShare();
      await strategy.simulateYield(D6(100));
      expect(await vault.pricePerShare()).to.be.gt(priceBefore);
    });

    it("new depositor after yield gets fewer shares (value preserved for old holders)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const toTransfer = await vault.availableToInvest();
      await vault.connect(admin).transferToStrategyManager(toTransfer);
      await manager.connect(admin).invest(await manager.idleUnderlying());

      await strategy.simulateYield(D6(100));

      const aliceShares = await vault.balanceOf(alice.address);
      await vault.connect(bob).deposit(D6(1000), bob.address);
      const bobShares = await vault.balanceOf(bob.address);

      // Bob gets fewer shares than alice for same deposit (yield has raised price)
      expect(bobShares).to.be.lt(aliceShares);
    });
  });

  // ---------------------------------------------------------------------------
  // 4.3 赎回保障路径
  // ---------------------------------------------------------------------------
  describe("4.3 redemption path when vault is underfunded", function () {
    it("redeem fails when vault has insufficient USDC", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      // Transfer all to manager
      await vault.connect(admin).setReserveRatioBps(0);
      await vault.connect(admin).transferToStrategyManager(D6(1000));
      await manager.connect(admin).invest(D6(1000));

      const shares = await vault.balanceOf(alice.address);
      await expect(
        vault.connect(alice).redeem(shares, alice.address, alice.address)
      ).to.be.reverted;
    });

    it("divest + returnToVault enables redeem", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setReserveRatioBps(0);
      await vault.connect(admin).transferToStrategyManager(D6(1000));
      await manager.connect(admin).invest(D6(1000));

      // Operator divests and returns to vault
      await manager.connect(admin).divest(D6(1000));
      await manager.connect(admin).returnToVault(D6(1000));

      // Alice can now redeem
      const shares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
    });
  });

  // ---------------------------------------------------------------------------
  // 4.4 紧急退出路径
  // ---------------------------------------------------------------------------
  describe("4.4 emergency exit path", function () {
    it("pause → emergencyExit → returnToVault → redeem succeeds", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setReserveRatioBps(0);
      await vault.connect(admin).transferToStrategyManager(D6(1000));
      await manager.connect(admin).invest(D6(1000));

      // Emergency flow
      await manager.connect(guardian).pause();
      await manager.connect(admin).emergencyExit();
      const idle = await manager.idleUnderlying();
      await manager.connect(admin).returnToVault(idle);

      // Alice redeems successfully
      const shares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
    });

    it("totalAssets still correct during emergency (strategy empty after exit)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setReserveRatioBps(0);
      await vault.connect(admin).transferToStrategyManager(D6(1000));
      await manager.connect(admin).invest(D6(1000));

      await manager.connect(guardian).pause();
      await manager.connect(admin).emergencyExit();

      // Strategy now empty, idle is in manager
      expect(await strategy.totalUnderlying()).to.equal(0);
      expect(await manager.idleUnderlying()).to.equal(D6(1000));
      expect(await vault.totalAssets()).to.equal(D6(1000));
    });
  });
});
