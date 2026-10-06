/**
 * AaveStrategy.test.ts
 * =====================
 * Unit tests for AaveUSDCStrategyV21 using MockAavePool + MockAToken.
 *
 * Coverage
 * --------
 *  1. Deployment — immutables, aToken underlying verification, ZeroAddress guards
 *  2. invest()         — USDC → Aave pool, aToken balance, Invested event
 *  3. divest()         — partial / full withdraw, USDC forwarded to manager
 *  4. emergencyExit()  — full aToken + idle USDC withdrawal, timestamp recorded
 *  5. totalUnderlying()— aToken balance + idle USDC
 *  6. Yield simulation — addYield increases NAV, divest returns principal + yield
 *  7. Failure paths    — setFailSupply / setFailWithdraw propagate pool errors
 *  8. onlyManager guard — invest / divest / emergencyExit block non-manager callers
 *
 * Circular-dependency note
 * ------------------------
 * MockAToken(underlying, pool)  ← needs pool address at deploy
 * MockAavePool(usdc, aToken)    ← needs aToken address at deploy
 *
 * Solution: predict MockAavePool's address using deployer nonce before deploying
 * MockAToken. Then deploy in order: aToken (nonce N) → pool (nonce N+1 = predicted).
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  MockUSDC,
  MockAToken,
  MockAavePool,
  AaveUSDCStrategyV21,
} from "../../typechain-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function usdc6(n: number | bigint): bigint {
  return ethers.parseUnits(String(n), 6);
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

interface AaveStrategyFixture {
  usdc:     MockUSDC;
  aToken:   MockAToken;
  pool:     MockAavePool;
  strategy: AaveUSDCStrategyV21;
  manager:  Awaited<ReturnType<typeof ethers.getSigner>>;
  user1:    Awaited<ReturnType<typeof ethers.getSigner>>;
}

async function deployAaveStrategyFixture(): Promise<AaveStrategyFixture> {
  // Hardhat accounts: [0] deployer, [1] manager (acts as CSM), [2] user1
  const [deployer, manager, user1] = await ethers.getSigners();

  // ── MockUSDC ──────────────────────────────────────────────────────────────
  const usdc     = await ethers.getContractFactory("MockUSDC")
    .then(f => f.connect(deployer).deploy()) as MockUSDC;
  const usdcAddr = await usdc.getAddress();

  // ── Break the MockAToken ↔ MockAavePool circular dependency ───────────────
  // MockAToken constructor needs pool address (immutable).
  // MockAavePool constructor needs aToken address (immutable).
  // Strategy: predict pool address from deployer's current nonce + 1.
  const deployerNonce  = await ethers.provider.getTransactionCount(deployer.address);
  const futurePoolAddr = ethers.getCreateAddress({
    from:  deployer.address,
    nonce: deployerNonce + 1,   // aToken deploy uses nonce N, pool uses nonce N+1
  });

  // Deploy MockAToken with the future pool address (nonce N)
  const aToken     = await ethers.getContractFactory("MockAToken")
    .then(f => f.connect(deployer).deploy(usdcAddr, futurePoolAddr)) as MockAToken;
  const aTokenAddr = await aToken.getAddress();

  // Deploy MockAavePool (nonce N+1 → its address == futurePoolAddr)
  const pool     = await ethers.getContractFactory("MockAavePool")
    .then(f => f.connect(deployer).deploy(usdcAddr, aTokenAddr)) as MockAavePool;
  const poolAddr = await pool.getAddress();

  // Sanity — must match or all mock interactions will fail
  if (poolAddr !== futurePoolAddr) {
    throw new Error(`Pool address mismatch: expected ${futurePoolAddr}, got ${poolAddr}`);
  }

  // ── AaveUSDCStrategyV21 ───────────────────────────────────────────────────
  const strategy = await ethers.getContractFactory("AaveUSDCStrategyV21")
    .then(f => f.connect(deployer).deploy(
      usdcAddr,
      manager.address,  // manager — only caller allowed for fund ops
      poolAddr,
      aTokenAddr,
      0,                // referralCode
    )) as AaveUSDCStrategyV21;

  return { usdc, aToken, pool, strategy, manager, user1 };
}

// ─── Utility: push USDC to strategy as if manager transferred it ──────────

/**
 * Simulate manager pushing `amount` USDC to strategy before calling invest().
 * (In production, CSM calls underlyingToken.safeTransfer(strategy, amount) then invest().)
 */
async function pushUSDC(
  fixture: AaveStrategyFixture,
  amount:  bigint
): Promise<void> {
  const { usdc, strategy, manager } = fixture;
  const stratAddr = await strategy.getAddress();
  await usdc.mint(manager.address, amount);
  await usdc.connect(manager).transfer(stratAddr, amount);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AaveUSDCStrategyV21", function () {

  // ===========================================================================
  // 1. Deployment
  // ===========================================================================

  describe("deployment", function () {
    it("sets underlyingToken to USDC", async function () {
      const { strategy, usdc } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.underlying()).to.equal(await usdc.getAddress());
    });

    it("sets manager address correctly", async function () {
      const { strategy, manager } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.manager()).to.equal(manager.address);
    });

    it("sets pool address correctly", async function () {
      const { strategy, pool } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.pool()).to.equal(await pool.getAddress());
    });

    it("sets aToken address correctly", async function () {
      const { strategy, aToken } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.aToken()).to.equal(await aToken.getAddress());
    });

    it("referralCode is 0", async function () {
      const { strategy } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.referralCode()).to.equal(0n);
    });

    it("lastEmergencyExitAt is 0 on deploy", async function () {
      const { strategy } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.lastEmergencyExitAt()).to.equal(0n);
    });

    it("totalUnderlying() is 0 on deploy (no USDC or aTokens)", async function () {
      const { strategy } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.totalUnderlying()).to.equal(0n);
    });

    it("reverts ZeroAddress when underlying is address(0)", async function () {
      const { pool, aToken, manager } = await loadFixture(deployAaveStrategyFixture);
      const factory = await ethers.getContractFactory("AaveUSDCStrategyV21");
      await expect(
        factory.deploy(
          ethers.ZeroAddress,
          manager.address,
          await pool.getAddress(),
          await aToken.getAddress(),
          0
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts ZeroAddress when manager is address(0)", async function () {
      const { usdc, pool, aToken } = await loadFixture(deployAaveStrategyFixture);
      const factory = await ethers.getContractFactory("AaveUSDCStrategyV21");
      await expect(
        factory.deploy(
          await usdc.getAddress(),
          ethers.ZeroAddress,
          await pool.getAddress(),
          await aToken.getAddress(),
          0
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts ATokenUnderlyingMismatch when aToken underlying != usdc", async function () {
      const { usdc, pool, manager } = await loadFixture(deployAaveStrategyFixture);

      // Deploy a second USDC mock to use as a wrong underlying
      const wrongUsdc = await ethers.getContractFactory("MockUSDC").then(f => f.deploy());
      const wrongUsdcAddr = await wrongUsdc.getAddress();

      // Deploy aToken with the wrong underlying (wrongUsdc)
      const [deployer] = await ethers.getSigners();
      const poolAddr2  = await pool.getAddress();
      const fakeAToken = await ethers.getContractFactory("MockAToken")
        .then(f => f.deploy(wrongUsdcAddr, poolAddr2));

      const factory = await ethers.getContractFactory("AaveUSDCStrategyV21");
      await expect(
        factory.deploy(
          await usdc.getAddress(),
          manager.address,
          await pool.getAddress(),
          await fakeAToken.getAddress(),
          0
        )
      ).to.be.revertedWithCustomError(factory, "ATokenUnderlyingMismatch");
    });
  });

  // ===========================================================================
  // 2. invest()
  // ===========================================================================

  describe("invest()", function () {
    it("supplies USDC to Aave pool and mints aTokens to strategy", async function () {
      const fixture  = await loadFixture(deployAaveStrategyFixture);
      const { strategy, aToken } = fixture;
      const stratAddr = await strategy.getAddress();

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      expect(await aToken.balanceOf(stratAddr)).to.equal(usdc6(100));
    });

    it("idle USDC in strategy drops to 0 after invest", async function () {
      const fixture  = await loadFixture(deployAaveStrategyFixture);
      const { strategy, usdc } = fixture;
      const stratAddr = await strategy.getAddress();

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      expect(await usdc.balanceOf(stratAddr)).to.equal(0n);
    });

    it("emits Invested with correct amount", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await expect(strategy.connect(fixture.manager).invest(usdc6(100)))
        .to.emit(strategy, "Invested").withArgs(usdc6(100));
    });

    it("totalUnderlying() equals invested amount (via aToken)", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(500));
      await strategy.connect(fixture.manager).invest(usdc6(500));

      expect(await strategy.totalUnderlying()).to.equal(usdc6(500));
    });

    it("partial invest: idle USDC + aTokens both count in totalUnderlying", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(60));

      // 60 in aToken + 40 idle = 100 total
      expect(await strategy.totalUnderlying()).to.equal(usdc6(100));
    });

    it("reverts ZeroAmount when amount == 0", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;
      await expect(strategy.connect(fixture.manager).invest(0n))
        .to.be.revertedWithCustomError(strategy, "ZeroAmount");
    });

    it("reverts InsufficientBalance when strategy idle < amount", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(50));
      await expect(strategy.connect(fixture.manager).invest(usdc6(100)))
        .to.be.revertedWithCustomError(strategy, "InsufficientBalance");
    });

    it("reverts SupplyFailed when pool.supply reverts", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy, pool } = fixture;

      await pool.setFailSupply(true);
      await pushUSDC(fixture, usdc6(100));
      await expect(strategy.connect(fixture.manager).invest(usdc6(100)))
        .to.be.reverted;
    });
  });

  // ===========================================================================
  // 3. divest()
  // ===========================================================================

  describe("divest()", function () {
    it("withdraws USDC from pool and transfers to manager", async function () {
      const fixture  = await loadFixture(deployAaveStrategyFixture);
      const { strategy, usdc } = fixture;
      const managerAddr = fixture.manager.address;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      const balBefore = await usdc.balanceOf(managerAddr);
      await strategy.connect(fixture.manager).divest(usdc6(50));
      expect(await usdc.balanceOf(managerAddr)).to.equal(balBefore + usdc6(50));
    });

    it("returns the actual amount withdrawn", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      const withdrawn = await strategy.connect(fixture.manager).divest.staticCall(usdc6(80));
      expect(withdrawn).to.equal(usdc6(80));
    });

    it("emits Divested with requested and withdrawn amounts", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      await expect(strategy.connect(fixture.manager).divest(usdc6(100)))
        .to.emit(strategy, "Divested").withArgs(usdc6(100), usdc6(100));
    });

    it("totalUnderlying() decreases by withdrawn amount after divest", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(200));
      await strategy.connect(fixture.manager).invest(usdc6(200));

      await strategy.connect(fixture.manager).divest(usdc6(80));
      expect(await strategy.totalUnderlying()).to.equal(usdc6(120));
    });

    it("reverts ZeroAmount when amount == 0", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;
      await expect(strategy.connect(fixture.manager).divest(0n))
        .to.be.revertedWithCustomError(strategy, "ZeroAmount");
    });

    it("reverts WithdrawFailed when pool.withdraw reverts", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy, pool } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));
      await pool.setFailWithdraw(true);

      await expect(strategy.connect(fixture.manager).divest(usdc6(50)))
        .to.be.reverted;
    });
  });

  // ===========================================================================
  // 4. emergencyExit()
  // ===========================================================================

  describe("emergencyExit()", function () {
    it("withdraws entire aToken balance and transfers to manager", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, usdc } = fixture;
      const managerAddr = fixture.manager.address;

      await pushUSDC(fixture, usdc6(300));
      await strategy.connect(fixture.manager).invest(usdc6(300));

      const balBefore = await usdc.balanceOf(managerAddr);
      await strategy.connect(fixture.manager).emergencyExit();
      expect(await usdc.balanceOf(managerAddr)).to.equal(balBefore + usdc6(300));
    });

    it("also forwards idle USDC not yet invested", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, usdc } = fixture;
      const managerAddr = fixture.manager.address;

      // Push 100, invest 60, leave 40 idle
      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(60));

      const balBefore = await usdc.balanceOf(managerAddr);
      await strategy.connect(fixture.manager).emergencyExit();

      // Manager receives 60 (from Aave) + 40 (idle) = 100
      expect(await usdc.balanceOf(managerAddr)).to.equal(balBefore + usdc6(100));
    });

    it("sets lastEmergencyExitAt to block.timestamp", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      await strategy.connect(fixture.manager).emergencyExit();

      const block = await ethers.provider.getBlock("latest");
      expect(await strategy.lastEmergencyExitAt()).to.equal(BigInt(block!.timestamp));
    });

    it("emits EmergencyExited with total USDC returned", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      await expect(strategy.connect(fixture.manager).emergencyExit())
        .to.emit(strategy, "EmergencyExited").withArgs(usdc6(100));
    });

    it("emergencyExit with no assets: emits EmergencyExited(0) and does not revert", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await expect(strategy.connect(fixture.manager).emergencyExit())
        .to.emit(strategy, "EmergencyExited").withArgs(0n);
    });

    it("strategy aToken balance is 0 after emergencyExit", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, aToken } = fixture;
      const stratAddr = await strategy.getAddress();

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));

      await strategy.connect(fixture.manager).emergencyExit();
      expect(await aToken.balanceOf(stratAddr)).to.equal(0n);
      expect(await strategy.totalUnderlying()).to.equal(0n);
    });
  });

  // ===========================================================================
  // 5. totalUnderlying()
  // ===========================================================================

  describe("totalUnderlying()", function () {
    it("is 0 when strategy has no USDC and no aTokens", async function () {
      const { strategy } = await loadFixture(deployAaveStrategyFixture);
      expect(await strategy.totalUnderlying()).to.equal(0n);
    });

    it("equals idle USDC when nothing invested", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(50));
      expect(await strategy.totalUnderlying()).to.equal(usdc6(50));
    });

    it("equals aToken balance when all USDC is invested", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(100));
      expect(await strategy.totalUnderlying()).to.equal(usdc6(100));
    });

    it("equals aToken + idle when partially invested", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await strategy.connect(fixture.manager).invest(usdc6(70));
      // 70 in Aave + 30 idle
      expect(await strategy.totalUnderlying()).to.equal(usdc6(100));
    });
  });

  // ===========================================================================
  // 6. Yield simulation
  // ===========================================================================

  describe("yield simulation", function () {
    it("aToken.addYield increases totalUnderlying (NAV)", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, aToken } = fixture;
      const stratAddr = await strategy.getAddress();

      await pushUSDC(fixture, usdc6(1_000));
      await strategy.connect(fixture.manager).invest(usdc6(1_000));

      expect(await strategy.totalUnderlying()).to.equal(usdc6(1_000));

      // Simulate 10 USDC yield via aToken balance increase
      await aToken.addYield(stratAddr, usdc6(10));
      expect(await strategy.totalUnderlying()).to.equal(usdc6(1_010));
    });

    it("divest returns principal + yield when pool is funded for yield", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, usdc, pool } = fixture;
      const managerAddr = fixture.manager.address;
      const stratAddr   = await strategy.getAddress();

      // Invest 1000 USDC
      await pushUSDC(fixture, usdc6(1_000));
      await strategy.connect(fixture.manager).invest(usdc6(1_000));

      // Simulate 50 USDC yield: mint aTokens + fund pool with extra USDC
      const aTokenAddr = await strategy.aToken();
      const aTokenContract = await ethers.getContractAt("MockAToken", aTokenAddr);
      await aTokenContract.addYield(stratAddr, usdc6(50));
      // fundPool pulls from msg.sender — mint + approve first
      const poolAddr3 = await pool.getAddress();
      await usdc.mint(fixture.manager.address, usdc6(50));
      await usdc.connect(fixture.manager).approve(poolAddr3, usdc6(50));
      await pool.connect(fixture.manager).fundPool(usdc6(50));

      expect(await strategy.totalUnderlying()).to.equal(usdc6(1_050));

      const balBefore = await usdc.balanceOf(managerAddr);
      await strategy.connect(fixture.manager).divest(usdc6(1_050));
      expect(await usdc.balanceOf(managerAddr)).to.equal(balBefore + usdc6(1_050));
    });

    it("emergencyExit returns principal + yield", async function () {
      const fixture   = await loadFixture(deployAaveStrategyFixture);
      const { strategy, pool, usdc } = fixture;
      const managerAddr = fixture.manager.address;
      const stratAddr   = await strategy.getAddress();

      await pushUSDC(fixture, usdc6(1_000));
      await strategy.connect(fixture.manager).invest(usdc6(1_000));

      const aTokenAddr = await strategy.aToken();
      const aTokenContract = await ethers.getContractAt("MockAToken", aTokenAddr);
      await aTokenContract.addYield(stratAddr, usdc6(20));
      // fundPool pulls from msg.sender — mint + approve first
      const poolAddr4 = await pool.getAddress();
      await usdc.mint(fixture.manager.address, usdc6(20));
      await usdc.connect(fixture.manager).approve(poolAddr4, usdc6(20));
      await pool.connect(fixture.manager).fundPool(usdc6(20));

      const balBefore = await usdc.balanceOf(managerAddr);
      const tx = await strategy.connect(fixture.manager).emergencyExit();
      expect(await usdc.balanceOf(managerAddr)).to.equal(balBefore + usdc6(1_020));
    });
  });

  // ===========================================================================
  // 7. onlyManager guard
  // ===========================================================================

  describe("onlyManager guard", function () {
    it("invest() reverts OnlyManager for non-manager caller", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy, user1 } = fixture;

      await pushUSDC(fixture, usdc6(100));
      await expect(strategy.connect(user1).invest(usdc6(100)))
        .to.be.revertedWithCustomError(strategy, "OnlyManager");
    });

    it("divest() reverts OnlyManager for non-manager caller", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy, user1 } = fixture;

      await expect(strategy.connect(user1).divest(usdc6(50)))
        .to.be.revertedWithCustomError(strategy, "OnlyManager");
    });

    it("emergencyExit() reverts OnlyManager for non-manager caller", async function () {
      const fixture = await loadFixture(deployAaveStrategyFixture);
      const { strategy, user1 } = fixture;

      await expect(strategy.connect(user1).emergencyExit())
        .to.be.revertedWithCustomError(strategy, "OnlyManager");
    });
  });

});
