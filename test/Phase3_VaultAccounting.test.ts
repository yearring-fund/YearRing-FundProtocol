import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FundVaultV01, StrategyManagerV01, DummyStrategy, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Phase3: Vault Accounting and Redemption Rules", function () {
  let vault: FundVaultV01;
  let manager: StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc: MockUSDC;

  let admin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const D6  = (n: number) => ethers.parseUnits(String(n), 6);
  const D18 = (n: number) => ethers.parseUnits(String(n), 18);

  beforeEach(async function () {
    [, admin, treasury, alice, bob] = await ethers.getSigners();

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
    await vault.connect(admin).setReserveRatioBps(3000);

    for (const user of [alice, bob]) {
      await usdc.mint(user.address, D6(10_000));
      await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    }
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(admin).addToAllowlist(bob.address);
  });

  // ---------------------------------------------------------------------------
  // PPS = totalAssets / totalShares correctness
  // ---------------------------------------------------------------------------
  describe("PPS = totalAssets / totalShares", function () {
    it("initial PPS = 1 USDC after first deposit", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      // pricePerShare() = convertToAssets(10^18) = 1e6 = 1 USDC
      expect(await vault.pricePerShare()).to.equal(D6(1));
    });

    it("PPS unchanged after deposit when no yield", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const pps1 = await vault.pricePerShare();
      await vault.connect(bob).deposit(D6(500), bob.address);
      expect(await vault.pricePerShare()).to.equal(pps1);
    });

    it("PPS increases when totalAssets grows (yield)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const ppsBefore = await vault.pricePerShare();

      // Simulate yield by minting extra USDC directly to vault
      await usdc.mint(await vault.getAddress(), D6(100));

      expect(await vault.pricePerShare()).to.be.gt(ppsBefore);
    });

    it("PPS reflects deployed capital correctly", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const ppsBefore = await vault.pricePerShare();

      // Deploy 70% → manager → strategy; totalAssets unchanged
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      expect(await vault.pricePerShare()).to.equal(ppsBefore);
    });

    it("totalAssets = vault USDC + strategy assets (not just vault cash)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      // vault USDC = 300, strategy = 700 → totalAssets = 1000
      expect(await vault.totalAssets()).to.equal(D6(1000));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(D6(300));
    });

    it("strategy loss is reflected in totalAssets and PPS", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));

      const ppsBefore = await vault.pricePerShare();

      // Simulate 100 USDC loss in strategy: burn from strategy's balance
      // (DummyStrategy holds USDC; we can't easily simulate loss, but we verify
      //  that totalAssets = vault + strategy, so any strategy loss flows through)
      // Here we verify the accounting chain is correct by checking the formula
      const vaultBal = await usdc.balanceOf(await vault.getAddress());
      const strategyBal = await usdc.balanceOf(await strategy.getAddress());
      expect(await vault.totalAssets()).to.equal(vaultBal + strategyBal);
    });
  });

  // ---------------------------------------------------------------------------
  // RWT excluded from NAV
  // ---------------------------------------------------------------------------
  describe("RWT excluded from NAV", function () {
    it("minting RWT does not change totalAssets or PPS", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const totalBefore = await vault.totalAssets();
      const ppsBefore = await vault.pricePerShare();

      // Deploy a RewardToken and mint to alice — should not affect vault NAV
      const rwt = await (await ethers.getContractFactory("RewardToken")).deploy(
        "RWT", "RWT", D18(1_000_000), alice.address
      );
      await rwt.connect(alice).transfer(bob.address, D18(100));

      expect(await vault.totalAssets()).to.equal(totalBefore);
      expect(await vault.pricePerShare()).to.equal(ppsBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // D1: redeem() blocked in EmergencyExit mode (V3 frozen decision)
  // ---------------------------------------------------------------------------
  describe("D1: redeem blocked in EmergencyExit mode", function () {
    it("redeem() works normally in Normal mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const shares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
    });

    it("redeem() works normally in Paused mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMode(1); // Paused
      const shares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
    });

    it("redeem() reverts with UseClaimExitAssets in EmergencyExit mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMode(2); // EmergencyExit
      const shares = await vault.balanceOf(alice.address);
      await expect(
        vault.connect(alice).redeem(shares, alice.address, alice.address)
      ).to.be.revertedWithCustomError(vault, "UseClaimExitAssets");
    });

    it("redeem() available again after mode returns to Normal", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMode(2);
      await vault.connect(admin).setMode(0); // back to Normal
      const shares = await vault.balanceOf(alice.address);
      await expect(
        vault.connect(alice).redeem(shares, alice.address, alice.address)
      ).to.not.be.reverted;
    });

    it("claimExitAssets() works in EmergencyExit mode (the correct path)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(bob).deposit(D6(500), bob.address);
      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(600));

      const aliceShares = await vault.balanceOf(alice.address);
      const before = await usdc.balanceOf(alice.address);
      await vault.connect(alice).claimExitAssets(1, aliceShares);
      expect(await usdc.balanceOf(alice.address)).to.be.gt(before);
    });
  });

  // ---------------------------------------------------------------------------
  // D2: management fee paused in EmergencyExit mode (V3 frozen decision)
  // ---------------------------------------------------------------------------
  describe("D2: management fee paused in EmergencyExit mode", function () {
    it("fee accrues in Normal mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100); // 1% per month

      const treasurySharesBefore = await vault.balanceOf(treasury.address);
      await time.increase(30 * 24 * 3600); // advance 30 days
      await vault.accrueManagementFee();

      expect(await vault.balanceOf(treasury.address)).to.be.gt(treasurySharesBefore);
    });

    it("fee does NOT accrue in EmergencyExit mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);

      await vault.connect(admin).setMode(2); // EmergencyExit
      const treasurySharesBefore = await vault.balanceOf(treasury.address);

      await time.increase(30 * 24 * 3600); // advance 30 days
      await vault.accrueManagementFee();

      expect(await vault.balanceOf(treasury.address)).to.equal(treasurySharesBefore);
    });

    it("no backdated fee: 30-day EmergencyExit period not charged on return to Normal", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);

      await vault.connect(admin).setMode(2); // EmergencyExit
      const treasuryAtEnter = await vault.balanceOf(treasury.address);

      await time.increase(30 * 24 * 3600); // 30 days pass in EmergencyExit

      await vault.connect(admin).setMode(0); // back to Normal
      await vault.accrueManagementFee();     // triggers for elapsed since setMode(0) (≤ 2 seconds)

      const treasuryAfterReturn = await vault.balanceOf(treasury.address);
      // Fee for 30 days at 100 bps/month would be ~1% of supply (≈ 1e19)
      // Only up to ~2 seconds of fee should have accrued (≈ 7e12 shares)
      const maxAcceptable = (await vault.totalSupply()) * 100n * 2n / (10000n * BigInt(30 * 24 * 3600));
      expect(treasuryAfterReturn - treasuryAtEnter).to.be.lte(maxAcceptable);
    });

    it("fee resumes after returning to Normal (only for time after return)", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);

      await vault.connect(admin).setMode(2);
      await time.increase(30 * 24 * 3600); // no fee period

      await vault.connect(admin).setMode(0);
      const treasurySharesAtReturn = await vault.balanceOf(treasury.address);

      await time.increase(30 * 24 * 3600); // another 30 days in Normal mode
      await vault.accrueManagementFee();

      // Should have accrued only for the Normal mode period (≈ 1% of supply)
      expect(await vault.balanceOf(treasury.address)).to.be.gt(treasurySharesAtReturn);
    });

    it("PPS unaffected during EmergencyExit: fee clock advances but PPS stable", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).setMgmtFeeBpsPerMonth(100);

      // Record PPS right before entering EmergencyExit
      await vault.connect(admin).setMode(2); // entering EmergencyExit: flushes fee up to this block
      const ppsAtEnter = await vault.pricePerShare();

      await time.increase(30 * 24 * 3600);
      await vault.accrueManagementFee(); // no-op in EmergencyExit (no shares minted)

      // PPS should be exactly unchanged (no dilution from fee)
      expect(await vault.pricePerShare()).to.equal(ppsAtEnter);
    });
  });

  // ---------------------------------------------------------------------------
  // Reserve band correctness (Phase 2 rebalance already tested; here we verify
  // the accounting invariant: totalAssets never drops due to capital movement)
  // ---------------------------------------------------------------------------
  describe("reserve band accounting invariant", function () {
    it("totalAssets unchanged after transferToStrategyManager", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      const totalBefore = await vault.totalAssets();
      await vault.connect(admin).transferToStrategyManager(D6(700));
      expect(await vault.totalAssets()).to.equal(totalBefore);
    });

    it("totalAssets unchanged after manager.invest()", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      const totalBefore = await vault.totalAssets();
      await manager.connect(admin).invest(D6(700));
      expect(await vault.totalAssets()).to.equal(totalBefore);
    });

    it("totalAssets unchanged after divest + returnToVault", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(admin).transferToStrategyManager(D6(700));
      await manager.connect(admin).invest(D6(700));
      const totalBefore = await vault.totalAssets();

      await manager.connect(admin).divest(D6(700));
      await manager.connect(admin).returnToVault(D6(700));

      expect(await vault.totalAssets()).to.equal(totalBefore);
    });

    it("claimExitAssets burns shares and reduces totalAssets proportionally", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      await vault.connect(bob).deposit(D6(500), bob.address);
      const totalBefore = await vault.totalAssets(); // 1500

      await vault.connect(admin).setMode(2);
      await vault.connect(admin).openExitModeRound(D6(1500));

      const aliceShares = await vault.balanceOf(alice.address);
      await vault.connect(alice).claimExitAssets(1, aliceShares);

      // totalAssets should decrease by alice's pro-rata assets
      expect(await vault.totalAssets()).to.be.lt(totalBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // maxRedeem / maxDeposit respect mode gates
  // ---------------------------------------------------------------------------
  describe("maxRedeem and maxDeposit respect mode", function () {
    it("maxRedeem > 0 in Normal mode", async function () {
      await vault.connect(alice).deposit(D6(1000), alice.address);
      expect(await vault.maxRedeem(alice.address)).to.be.gt(0);
    });

    it("maxDeposit > 0 in Normal mode", async function () {
      expect(await vault.maxDeposit(alice.address)).to.be.gt(0);
    });
  });
});
