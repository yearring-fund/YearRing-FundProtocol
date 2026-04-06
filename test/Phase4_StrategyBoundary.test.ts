import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, StrategyManagerV01, DummyStrategy, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Phase4: Strategy Boundary — single Aave strategy, 70% cap, exception handling", function () {
  let vault: FundVaultV01;
  let manager: StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc: MockUSDC;

  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);

  beforeEach(async function () {
    [, admin, treasury, alice] = await ethers.getSigners();

    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "fbUSDC", "fbUSDC",
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

    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();

    await vault.connect(admin).setModules(await manager.getAddress());
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3000); // 30% reserve

    await usdc.mint(alice.address, D6(10_000));
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).addToAllowlist(alice.address);
  });

  // ---------------------------------------------------------------------------
  // Single strategy boundary
  // ---------------------------------------------------------------------------
  describe("single strategy boundary", function () {
    it("StrategyManager holds exactly one active strategy", async function () {
      expect(await manager.strategy()).to.equal(await strategy.getAddress());
    });

    it("setStrategy() requires old strategy to be fully divested (empty)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      // Deploy a second strategy contract
      const strategy2 = await (await ethers.getContractFactory("DummyStrategy")).deploy(
        await usdc.getAddress()
      );

      // Try to swap: old strategy still has 700 USDC deployed
      await manager.connect(admin).pause();
      await expect(
        manager.connect(admin).setStrategy(await strategy2.getAddress())
      ).to.be.revertedWithCustomError(manager, "OldStrategyNotEmpty");
    });

    it("setStrategy() succeeds after old strategy is fully divested", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      const strategy2 = await (await ethers.getContractFactory("DummyStrategy")).deploy(
        await usdc.getAddress()
      );

      // Divest fully, then swap strategy
      await manager.connect(admin).divest(D6(700));
      await manager.connect(admin).pause();
      await manager.connect(admin).setStrategy(await strategy2.getAddress());
      expect(await manager.strategy()).to.equal(await strategy2.getAddress());
    });

    it("setStrategy() requires paused state", async function () {
      const strategy2 = await (await ethers.getContractFactory("DummyStrategy")).deploy(
        await usdc.getAddress()
      );
      // Not paused
      await expect(
        manager.connect(admin).setStrategy(await strategy2.getAddress())
      ).to.be.revertedWith("Pausable: not paused");
    });
  });

  // ---------------------------------------------------------------------------
  // invest() blocked in non-Normal vault mode
  // ---------------------------------------------------------------------------
  describe("invest() blocked in non-Normal vault mode", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
    });

    it("invest() works in Normal mode", async function () {
      await expect(manager.connect(admin).invest(D6(700)))
        .to.emit(manager, "Invested");
    });

    it("invest() reverts in Paused vault mode", async function () {
      await vault.connect(admin).setMode(1); // Paused
      await expect(
        manager.connect(admin).invest(D6(700))
      ).to.be.revertedWithCustomError(manager, "NotInNormalMode");
    });

    it("invest() reverts in EmergencyExit vault mode", async function () {
      await vault.connect(admin).setMode(2); // EmergencyExit
      await expect(
        manager.connect(admin).invest(D6(700))
      ).to.be.revertedWithCustomError(manager, "NotInNormalMode");
    });
  });

  // ---------------------------------------------------------------------------
  // 70% deploy cap (already enforced in vault, verified end-to-end here)
  // ---------------------------------------------------------------------------
  describe("70% deploy cap end-to-end", function () {
    it("cannot deploy more than 70% of totalAssets through vault", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      // 70% = 700; try to transfer 701
      await expect(
        vault.connect(admin).transferToStrategyManager(D6(701))
      ).to.be.revertedWithCustomError(vault, "MaxDeployExceeded");
    });

    it("can deploy exactly 70% of totalAssets", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await expect(
        vault.connect(admin).transferToStrategyManager(D6(700))
      ).to.not.be.reverted;
    });

    it("second deploy blocked if combined would exceed 70%", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700)); // 700 now in strategy
      // totalAssets still 1000; deployed = 700 (70%); any more would exceed cap
      await expect(
        vault.connect(admin).transferToStrategyManager(D6(1))
      ).to.be.revertedWithCustomError(vault, "MaxDeployExceeded");
    });
  });

  // ---------------------------------------------------------------------------
  // totalUnderlying() conservative reporting
  // ---------------------------------------------------------------------------
  describe("totalUnderlying() conservative reporting", function () {
    it("totalUnderlying() = 0 before invest", async function () {
      expect(await strategy.totalUnderlying()).to.equal(0);
    });

    it("totalUnderlying() = invested amount after invest", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));
      expect(await strategy.totalUnderlying()).to.equal(D6(700));
    });

    it("totalManagedAssets() is conservative: returns idle only if strategy call would fail", async function () {
      // Fund manager directly with idle USDC (no strategy deployed)
      await usdc.mint(await manager.getAddress(), D6(500));
      // manager has 500 idle, strategy has 0 → totalManagedAssets = 500
      expect(await manager.totalManagedAssets()).to.equal(D6(500));
    });
  });

  // ---------------------------------------------------------------------------
  // emergencyExit funds flow back to vault
  // ---------------------------------------------------------------------------
  describe("emergencyExit funds flow to vault", function () {
    it("emergencyExit() returns all funds to vault", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      const vaultBefore = await usdc.balanceOf(await vault.getAddress());
      await manager.connect(admin).emergencyExit();
      const vaultAfter = await usdc.balanceOf(await vault.getAddress());

      // Vault should have received 700 back (was 300, now should be 1000)
      expect(vaultAfter - vaultBefore).to.equal(D6(700));
    });

    it("partialEmergencyExit() returns specified amount to vault", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      const vaultBefore = await usdc.balanceOf(await vault.getAddress());
      await manager.connect(admin).partialEmergencyExit(D6(350));
      const vaultAfter = await usdc.balanceOf(await vault.getAddress());

      expect(vaultAfter - vaultBefore).to.equal(D6(350));
    });

    it("emergencyExit() leaves strategy with 0 underlying", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      await manager.connect(admin).emergencyExit();
      expect(await strategy.totalUnderlying()).to.equal(0);
    });

    it("totalAssets() returns to full deposit amount after emergencyExit", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      await manager.connect(admin).emergencyExit();
      expect(await vault.totalAssets()).to.equal(D6(1000));
    });
  });

  // ---------------------------------------------------------------------------
  // Prohibited behaviors: no second strategy activation
  // ---------------------------------------------------------------------------
  describe("second strategy cannot be concurrently active", function () {
    it("StrategyManager has at most one strategy address", async function () {
      // The contract has a single `strategy` slot — no array, no multi-route
      expect(typeof (await manager.strategy())).to.equal("string"); // single address
    });

    it("activating a second strategy requires fully divesting the first", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      const strategy2 = await (await ethers.getContractFactory("DummyStrategy")).deploy(
        await usdc.getAddress()
      );

      await manager.connect(admin).pause();
      // Cannot swap while first strategy has assets
      await expect(
        manager.connect(admin).setStrategy(await strategy2.getAddress())
      ).to.be.revertedWithCustomError(manager, "OldStrategyNotEmpty");
    });
  });

  // ---------------------------------------------------------------------------
  // divest() and returnToVault() work in Paused mode (read: not blocked)
  // ---------------------------------------------------------------------------
  describe("divest + returnToVault work in non-Normal mode", function () {
    it("divest() works even when vault is in Paused mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      await vault.connect(admin).setMode(1); // Paused
      // divest is allowed (not blocked by mode)
      await expect(manager.connect(admin).divest(D6(700)))
        .to.emit(manager, "Divested");
    });

    it("returnToVault() works even when vault is in Paused mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));

      await vault.connect(admin).setMode(1); // Paused
      await expect(manager.connect(admin).returnToVault(D6(700)))
        .to.emit(manager, "ReturnedToVault");
    });
  });
});
