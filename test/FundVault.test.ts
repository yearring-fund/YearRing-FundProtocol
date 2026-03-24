import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("FundVaultV01", function () {
  let vault: FundVaultV01;
  let usdc: MockUSDC;
  let admin: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);
  const DEPOSIT = D6(1000);

  beforeEach(async function () {
    [, admin, guardian, treasury, alice, bob] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(),
      "Fund Vault", "fvUSDC",
      treasury.address, guardian.address, admin.address
    );

    await usdc.mint(alice.address, DEPOSIT * 10n);
    await usdc.mint(bob.address, DEPOSIT * 10n);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------
  describe("Deployment", function () {
    it("asset is USDC", async function () {
      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });
    it("shares have 18 decimals", async function () {
      expect(await vault.decimals()).to.equal(18);
    });
    it("initial totalAssets is 0", async function () {
      expect(await vault.totalAssets()).to.equal(0);
    });
    it("treasury is set", async function () {
      expect(await vault.treasury()).to.equal(treasury.address);
    });
    it("depositsPaused starts false", async function () {
      expect(await vault.depositsPaused()).to.equal(false);
    });
    it("redeemsPaused starts false", async function () {
      expect(await vault.redeemsPaused()).to.equal(false);
    });
    it("externalTransfersEnabled starts false", async function () {
      expect(await vault.externalTransfersEnabled()).to.equal(false);
    });
    it("reserveRatioBps starts at 10_000 (100%)", async function () {
      expect(await vault.reserveRatioBps()).to.equal(10_000);
    });
  });

  // ---------------------------------------------------------------------------
  // deposit
  // ---------------------------------------------------------------------------
  describe("deposit", function () {
    it("mints shares and increases totalAssets", async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address);
      expect(await vault.balanceOf(alice.address)).to.be.gt(0);
      expect(await vault.totalAssets()).to.equal(DEPOSIT);
    });
    it("totalAssets equals vault USDC balance after deposit", async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address);
      expect(await vault.totalAssets()).to.equal(
        await usdc.balanceOf(await vault.getAddress())
      );
    });
    it("reverts when depositsPaused", async function () {
      await vault.connect(guardian).pauseDeposits();
      await expect(
        vault.connect(alice).deposit(DEPOSIT, alice.address)
      ).to.be.revertedWithCustomError(vault, "DepositsArePaused");
    });
    it("pricePerShare is 1 USDC after first deposit", async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address);
      expect(await vault.pricePerShare()).to.equal(D6(1));
    });
  });

  // ---------------------------------------------------------------------------
  // redeem
  // ---------------------------------------------------------------------------
  describe("redeem", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address);
    });

    it("burns shares and returns USDC", async function () {
      const shares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
      expect(await vault.balanceOf(alice.address)).to.equal(0);
    });
    it("totalAssets equals vault balance after redeem", async function () {
      const shares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares / 2n, alice.address, alice.address);
      expect(await vault.totalAssets()).to.equal(
        await usdc.balanceOf(await vault.getAddress())
      );
    });
    it("reverts when redeemsPaused", async function () {
      await vault.connect(guardian).pauseRedeems();
      const shares = await vault.balanceOf(alice.address);
      await expect(
        vault.connect(alice).redeem(shares, alice.address, alice.address)
      ).to.be.revertedWithCustomError(vault, "RedeemsArePaused");
    });
  });

  // ---------------------------------------------------------------------------
  // Disabled functions
  // ---------------------------------------------------------------------------
  describe("disabled functions", function () {
    it("mint() reverts with FunctionNotSupported", async function () {
      await expect(
        vault.connect(alice).mint(ethers.parseEther("1"), alice.address)
      ).to.be.revertedWithCustomError(vault, "FunctionNotSupported");
    });
    it("withdraw() reverts with FunctionNotSupported", async function () {
      await expect(
        vault.connect(alice).withdraw(1, alice.address, alice.address)
      ).to.be.revertedWithCustomError(vault, "FunctionNotSupported");
    });
  });

  // ---------------------------------------------------------------------------
  // Pause controls
  // ---------------------------------------------------------------------------
  describe("pause controls", function () {
    it("GUARDIAN can pauseDeposits", async function () {
      await vault.connect(guardian).pauseDeposits();
      expect(await vault.depositsPaused()).to.equal(true);
    });
    it("ADMIN can unpauseDeposits", async function () {
      await vault.connect(guardian).pauseDeposits();
      await vault.connect(admin).unpauseDeposits();
      expect(await vault.depositsPaused()).to.equal(false);
    });
    it("GUARDIAN cannot unpauseDeposits", async function () {
      await vault.connect(guardian).pauseDeposits();
      await expect(
        vault.connect(guardian).unpauseDeposits()
      ).to.be.reverted;
    });
    it("GUARDIAN can pauseRedeems", async function () {
      await vault.connect(guardian).pauseRedeems();
      expect(await vault.redeemsPaused()).to.equal(true);
    });
    it("ADMIN can unpauseRedeems", async function () {
      await vault.connect(guardian).pauseRedeems();
      await vault.connect(admin).unpauseRedeems();
      expect(await vault.redeemsPaused()).to.equal(false);
    });
    it("GUARDIAN cannot unpauseRedeems", async function () {
      await vault.connect(guardian).pauseRedeems();
      await expect(
        vault.connect(guardian).unpauseRedeems()
      ).to.be.reverted;
    });
    it("non-GUARDIAN cannot pauseDeposits", async function () {
      await expect(vault.connect(alice).pauseDeposits()).to.be.reverted;
    });
    it("non-GUARDIAN cannot pauseRedeems", async function () {
      await expect(vault.connect(alice).pauseRedeems()).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Reserve ratio & availableToInvest
  // ---------------------------------------------------------------------------
  describe("reserveRatioBps & availableToInvest", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address); // 1000 USDC
    });

    it("availableToInvest = 0 at 100% reserve", async function () {
      expect(await vault.availableToInvest()).to.equal(0);
    });
    it("availableToInvest = totalAssets at 0% reserve", async function () {
      await vault.connect(admin).setReserveRatioBps(0);
      expect(await vault.availableToInvest()).to.equal(DEPOSIT);
    });
    it("availableToInvest = 70% at 30% reserve", async function () {
      await vault.connect(admin).setReserveRatioBps(3000);
      expect(await vault.availableToInvest()).to.equal(D6(700));
    });
    it("setReserveRatioBps > 10_000 reverts with InvalidRatio", async function () {
      await expect(
        vault.connect(admin).setReserveRatioBps(10_001)
      ).to.be.revertedWithCustomError(vault, "InvalidRatio");
    });
    it("non-ADMIN cannot setReserveRatioBps", async function () {
      await expect(
        vault.connect(alice).setReserveRatioBps(5000)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // transferToStrategyManager
  // ---------------------------------------------------------------------------
  describe("transferToStrategyManager", function () {
    let manager: StrategyManagerV01;
    let strategy: DummyStrategy;

    beforeEach(async function () {
      strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(await usdc.getAddress());
      manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
        await usdc.getAddress(), await vault.getAddress(), admin.address, guardian.address
      );
      await manager.connect(guardian).pause();
      await manager.connect(admin).setStrategy(await strategy.getAddress());
      await manager.connect(admin).unpause();

      await vault.connect(alice).deposit(DEPOSIT, alice.address);
      await vault.connect(admin).setModules(await manager.getAddress());
      await vault.connect(admin).setExternalTransfersEnabled(true);
      await vault.connect(admin).setReserveRatioBps(0);
    });

    it("transfers USDC to strategyManager", async function () {
      const before = await usdc.balanceOf(await manager.getAddress());
      await vault.connect(admin).transferToStrategyManager(DEPOSIT);
      expect(await usdc.balanceOf(await manager.getAddress())).to.equal(before + DEPOSIT);
    });
    it("reverts when ExternalTransfersDisabled", async function () {
      await vault.connect(admin).setExternalTransfersEnabled(false);
      await expect(
        vault.connect(admin).transferToStrategyManager(DEPOSIT)
      ).to.be.revertedWithCustomError(vault, "ExternalTransfersDisabled");
    });
    it("reverts when amount exceeds availableToInvest (ReserveTooLow)", async function () {
      await vault.connect(admin).setReserveRatioBps(5000); // 50% reserve
      await expect(
        vault.connect(admin).transferToStrategyManager(DEPOSIT) // > 500 USDC available
      ).to.be.revertedWithCustomError(vault, "ReserveTooLow");
    });
    it("reverts when strategyManager is zero address", async function () {
      // Deploy fresh vault with no strategyManager set
      const vault2 = await (await ethers.getContractFactory("FundVaultV01")).deploy(
        await usdc.getAddress(), "V2", "V2", treasury.address, guardian.address, admin.address
      );
      await usdc.connect(alice).approve(await vault2.getAddress(), ethers.MaxUint256);
      await vault2.connect(alice).deposit(DEPOSIT, alice.address);
      await vault2.connect(admin).setExternalTransfersEnabled(true);
      await vault2.connect(admin).setReserveRatioBps(0);
      await expect(
        vault2.connect(admin).transferToStrategyManager(DEPOSIT)
      ).to.be.revertedWithCustomError(vault2, "ZeroAddress");
    });
    it("non-ADMIN cannot transferToStrategyManager", async function () {
      await expect(
        vault.connect(alice).transferToStrategyManager(DEPOSIT)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Management fee
  // ---------------------------------------------------------------------------
  describe("management fee", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit(DEPOSIT, alice.address);
    });

    it("rate=0: no shares minted", async function () {
      const supply = await vault.totalSupply();
      await vault.accrueManagementFee();
      expect(await vault.totalSupply()).to.equal(supply);
    });
    it("mints fee shares to treasury after 30 days at 1%/month", async function () {
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);
      await time.increase(30 * 24 * 60 * 60);
      const before = await vault.balanceOf(treasury.address);
      await vault.accrueManagementFee();
      expect(await vault.balanceOf(treasury.address)).to.be.gt(before);
    });
    it("fee is settled before deposit", async function () {
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);
      await time.increase(30 * 24 * 60 * 60);
      const before = await vault.balanceOf(treasury.address);
      await vault.connect(bob).deposit(DEPOSIT, bob.address);
      expect(await vault.balanceOf(treasury.address)).to.be.gt(before);
    });
    it("fee is settled before redeem", async function () {
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);
      await time.increase(30 * 24 * 60 * 60);
      const before = await vault.balanceOf(treasury.address);
      const shares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares / 2n, alice.address, alice.address);
      expect(await vault.balanceOf(treasury.address)).to.be.gt(before);
    });
    it("setMgmtFeeBpsPerMonth > 200 reverts FeeTooHigh", async function () {
      await expect(
        vault.connect(admin).setMgmtFeeBpsPerMonth(201)
      ).to.be.revertedWithCustomError(vault, "FeeTooHigh");
    });
    it("non-ADMIN cannot setMgmtFeeBpsPerMonth", async function () {
      await expect(
        vault.connect(alice).setMgmtFeeBpsPerMonth(10)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------
  describe("access control", function () {
    it("ADMIN can setTreasury", async function () {
      await vault.connect(admin).setTreasury(bob.address);
      expect(await vault.treasury()).to.equal(bob.address);
    });
    it("setTreasury(address(0)) reverts ZeroAddress", async function () {
      await expect(
        vault.connect(admin).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
    it("non-ADMIN cannot setTreasury", async function () {
      await expect(vault.connect(alice).setTreasury(bob.address)).to.be.reverted;
    });
    it("ADMIN can setModules", async function () {
      await vault.connect(admin).setModules(bob.address);
      expect(await vault.strategyManager()).to.equal(bob.address);
    });
    it("setModules(address(0)) reverts ZeroAddress", async function () {
      await expect(
        vault.connect(admin).setModules(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
    it("non-ADMIN cannot setModules", async function () {
      await expect(vault.connect(alice).setModules(bob.address)).to.be.reverted;
    });
  });
});
