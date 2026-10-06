/**
 * AaveV3Fork.test.ts
 *
 * Fork tests for AaveV3StrategyV01 against real Aave V3 on Base mainnet.
 * Covers the four critical paths required by Phase 3 pass criteria:
 *
 *   Path 1 — deposit → invest:   totalAssets() stays constant, aToken balance > 0
 *   Path 2 — yield accrual:      advance 7 days → PPS increases (aToken grows)
 *   Path 3 — divest + redeem:    USDC flows back correctly, user can fully redeem
 *   Path 4 — emergencyExit:      all USDC returns to manager, totalManagedAssets = 0
 *
 * Requirements:
 *   BASE_MAINNET_RPC_URL must be set in .env (QuickNode / Alchemy Base Mainnet endpoint)
 *
 * Run:
 *   npx hardhat test test/AaveV3Fork.test.ts
 *
 * The suite auto-skips if BASE_MAINNET_RPC_URL is not set.
 */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { FundVaultV01, StrategyManagerV01, AaveV3StrategyV01 } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ── Fork constants ────────────────────────────────────────────────────────────

const BASE_RPC = process.env.BASE_MAINNET_RPC_URL;

// Pinned block for reproducibility. Update when addresses might have changed.
// Set FORK_BLOCK env var to override (e.g. "latest").
const FORK_BLOCK: number | undefined = process.env.FORK_BLOCK
  ? parseInt(process.env.FORK_BLOCK)
  : undefined; // undefined = latest

// Real Base mainnet addresses
const USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AUSDC    = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

// USDC whale: the aUSDC contract holds real USDC as Aave reserve backing
const USDC_WHALE = AUSDC;

// ── Helpers ──────────────────────────────────────────────────────────────────

const D6  = (n: number | string) => ethers.parseUnits(String(n), 6);
const D18 = (n: number | string) => ethers.parseUnits(String(n), 18);

async function impersonate(address: string): Promise<SignerWithAddress> {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await network.provider.send("hardhat_setBalance", [address, "0x" + (10n ** 20n).toString(16)]);
  return ethers.getSigner(address);
}

async function stopImpersonate(address: string) {
  await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [address] });
}

// ── Shared fixture ────────────────────────────────────────────────────────────

interface Fixture {
  vault:    FundVaultV01;
  manager:  StrategyManagerV01;
  strategy: AaveV3StrategyV01;
  usdc:     ethers.Contract;
  aUsdc:    ethers.Contract;
  admin:    SignerWithAddress;
  alice:    SignerWithAddress;
}

async function deployFixture(): Promise<Fixture> {
  const [admin, alice] = await ethers.getSigners();

  // Fund admin + alice with test ETH (fork state might have insufficient balance)
  await network.provider.send("hardhat_setBalance", [admin.address, "0x" + (10n ** 20n).toString(16)]);
  await network.provider.send("hardhat_setBalance", [alice.address, "0x" + (10n ** 20n).toString(16)]);

  // Get test USDC from whale
  const whale = await impersonate(USDC_WHALE);
  const usdc = new ethers.Contract(
    USDC,
    ["function transfer(address to, uint256 amount) returns (bool)",
     "function approve(address spender, uint256 amount) returns (bool)",
     "function balanceOf(address) view returns (uint256)"],
    whale
  );

  await usdc.transfer(alice.address, D6(10_000));
  await stopImpersonate(USDC_WHALE);

  // Deploy protocol stack against real Aave
  const treasury = admin.address;

  const vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
    USDC, "fbUSDC", "fbUSDC", treasury, admin.address
  ) as unknown as FundVaultV01;

  const manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
    USDC, await vault.getAddress(), admin.address
  ) as unknown as StrategyManagerV01;

  const strategy = await (await ethers.getContractFactory("AaveV3StrategyV01")).deploy(
    USDC, await manager.getAddress(), AAVE_POOL, AUSDC, 0
  ) as unknown as AaveV3StrategyV01;

  // Wire: set strategy (requires manager to be paused)
  await manager.connect(admin).pause();
  await manager.connect(admin).setStrategy(await strategy.getAddress());
  await manager.connect(admin).unpause();

  // Wire: set strategy manager on vault
  await vault.connect(admin).setModules(await manager.getAddress());
  await vault.connect(admin).setExternalTransfersEnabled(true);
  await vault.connect(admin).setReserveRatioBps(3000); // 30% reserve

  // Allowlist alice + admin (treasury)
  await vault.connect(admin).addToAllowlist(alice.address);
  await vault.connect(admin).addToAllowlist(admin.address);

  // Alice approves vault
  const usdcAlice = usdc.connect(alice) as ethers.Contract;
  await usdcAlice.approve(await vault.getAddress(), ethers.MaxUint256);

  const aUsdc = new ethers.Contract(
    AUSDC,
    ["function balanceOf(address) view returns (uint256)"],
    admin
  );

  return { vault, manager, strategy, usdc: usdc.connect(admin) as ethers.Contract, aUsdc, admin, alice };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("AaveV3Fork — real Aave V3 on Base mainnet fork", function () {

  // Skip entire suite if no RPC URL configured
  before(async function () {
    if (!BASE_RPC) {
      console.log("  ⚠  BASE_MAINNET_RPC_URL not set — skipping fork tests");
      this.skip();
    }
  });

  // Activate fork once before all tests; skip suite if fork activation fails
  before(async function () {
    this.timeout(120_000);
    const params: Record<string, unknown> = { jsonRpcUrl: BASE_RPC };
    if (FORK_BLOCK) params.blockNumber = FORK_BLOCK;

    try {
      await network.provider.request({
        method: "hardhat_reset",
        params: [{ forking: params }],
      });
      console.log(`  Fork active — block ${FORK_BLOCK ?? "latest"}`);
    } catch (e: any) {
      console.log(`  ⚠  Fork activation failed (${String(e.message).slice(0, 100)}) — skipping fork tests`);
      this.skip();
    }
  });

  // Reset to clean hardhat state after all fork tests
  after(async function () {
    await network.provider.request({ method: "hardhat_reset", params: [] });
  });

  // ── Path 1: deposit → invest ───────────────────────────────────────────────

  describe("Path 1 — deposit → invest", function () {
    this.timeout(120_000);

    it("totalAssets() is preserved after invest, aToken balance > 0", async function () {
      const { vault, manager, strategy, aUsdc, admin, alice } = await deployFixture();

      const depositAmt = D6(1_000); // 1000 USDC

      // Alice deposits
      await vault.connect(alice).deposit(depositAmt, alice.address);
      const totalBefore = await vault.totalAssets();
      const ppsBefore   = await vault.pricePerShare();

      // Admin: transfer 70% to strategy manager, invest all of it
      const toManager = (depositAmt * 70n) / 100n; // 700 USDC
      await vault.connect(admin).transferToStrategyManager(toManager);
      await manager.connect(admin).invest(toManager);

      // Verify: totalAssets() unchanged (accounting is consistent)
      const totalAfter = await vault.totalAssets();
      const ppsAfter   = await vault.pricePerShare();

      expect(totalAfter).to.be.closeTo(totalBefore, D6(1)); // within 1 USDC of rounding
      expect(ppsAfter).to.be.closeTo(ppsBefore, 1n);        // PPS must not change (1-wei Aave rounding tolerance)

      // Verify: aToken balance reflects invested amount
      const stratAddr   = await strategy.getAddress();
      const aTokenBal   = await aUsdc.balanceOf(stratAddr);
      expect(aTokenBal).to.be.closeTo(toManager, D6(1));     // aUSDC ≈ invested USDC

      // Verify: totalManagedAssets includes strategy balance (1-wei Aave rounding tolerance)
      const managed = await manager.totalManagedAssets();
      expect(managed).to.be.closeTo(toManager, D6(1));

      console.log(`    invested=${ethers.formatUnits(toManager, 6)} USDC`);
      console.log(`    aToken=${ethers.formatUnits(aTokenBal, 6)} aUSDC`);
      console.log(`    totalAssets before=${ethers.formatUnits(totalBefore, 6)}, after=${ethers.formatUnits(totalAfter, 6)}`);
    });
  });

  // ── Path 2: yield accrual → PPS increases ─────────────────────────────────

  describe("Path 2 — yield accrual", function () {
    this.timeout(120_000);

    it("PPS increases after advancing 7 days (aToken balance grows)", async function () {
      const { vault, manager, strategy, aUsdc, admin, alice } = await deployFixture();

      const depositAmt = D6(5_000); // 5000 USDC for observable yield
      await vault.connect(alice).deposit(depositAmt, alice.address);

      const toManager = (depositAmt * 70n) / 100n;
      await vault.connect(admin).transferToStrategyManager(toManager);
      await manager.connect(admin).invest(toManager);

      const stratAddr = await strategy.getAddress();

      const ppsBefore         = await vault.pricePerShare();
      const totalBefore       = await vault.totalAssets();
      const aTokenBalBefore   = await aUsdc.balanceOf(stratAddr);
      const underlyingBefore  = await strategy.totalUnderlying();

      // Advance 7 days — Aave accrues yield via liquidity index
      await time.increase(7 * 24 * 3600);
      // Mine one block to push the timestamp change on-chain
      await network.provider.send("evm_mine", []);

      const aTokenBalAfter    = await aUsdc.balanceOf(stratAddr);
      const underlyingAfter   = await strategy.totalUnderlying();
      const totalAfter        = await vault.totalAssets();
      const ppsAfter          = await vault.pricePerShare();

      // aToken balance must have grown (Aave yield)
      expect(aTokenBalAfter).to.be.gt(aTokenBalBefore);

      // totalUnderlying() must reflect the growth
      expect(underlyingAfter).to.be.gt(underlyingBefore);

      // totalAssets() must reflect the growth
      expect(totalAfter).to.be.gt(totalBefore);

      // PPS must have increased (yield flows to shareholders)
      expect(ppsAfter).to.be.gt(ppsBefore);

      const yieldUSDC = Number(ethers.formatUnits(aTokenBalAfter - aTokenBalBefore, 6));
      const ppsGain   = Number(ethers.formatUnits(ppsAfter - ppsBefore, 18));
      console.log(`    aToken gain over 7d: +${yieldUSDC.toFixed(6)} USDC`);
      console.log(`    PPS: ${ethers.formatUnits(ppsBefore, 18)} → ${ethers.formatUnits(ppsAfter, 18)}`);
      console.log(`    PPS gain: +${ppsGain.toFixed(10)}`);

      // Sanity: yield must be positive but not absurdly large (< 1% in 7 days is realistic)
      expect(yieldUSDC).to.be.gt(0);
      expect(yieldUSDC).to.be.lt(Number(ethers.formatUnits(toManager, 6)) * 0.01);
    });
  });

  // ── Path 3: divest + redeem ────────────────────────────────────────────────

  describe("Path 3 — divest + redeem", function () {
    this.timeout(120_000);

    it("user can fully redeem after divest (USDC flows back correctly)", async function () {
      const { vault, manager, usdc, admin, alice } = await deployFixture();

      const depositAmt = D6(2_000);
      await vault.connect(alice).deposit(depositAmt, alice.address);

      const toManager = (depositAmt * 70n) / 100n;
      await vault.connect(admin).transferToStrategyManager(toManager);
      await manager.connect(admin).invest(toManager);

      // Advance time to accrue some yield
      await time.increase(3 * 24 * 3600);
      await network.provider.send("evm_mine", []);

      // Divest: pull all funds back from strategy to manager, then return to vault
      const managed = await manager.totalManagedAssets();
      await manager.connect(admin).divest(managed);
      // After divest, funds are in manager. returnToVault moves them back.
      const managerBal = await (usdc as ethers.Contract).attach(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      ).balanceOf(await manager.getAddress());
      if (managerBal > 0n) {
        await manager.connect(admin).returnToVault(managerBal);
      }

      // Verify vault has enough USDC to serve full redeem
      const aliceShares = await vault.balanceOf(alice.address);
      const expectedOut = await vault.convertToAssets(aliceShares);
      const vaultBal    = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(await vault.getAddress());

      expect(vaultBal).to.be.gte(expectedOut);

      // Alice redeems all shares
      const aliceUsdcBefore = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(alice.address);

      await vault.connect(alice).redeem(aliceShares, alice.address, alice.address);

      const aliceUsdcAfter = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(alice.address);

      const received = aliceUsdcAfter - aliceUsdcBefore;

      // Alice receives at least her deposited amount (any yield is a bonus)
      expect(received).to.be.gte(depositAmt);

      console.log(`    deposited:  ${ethers.formatUnits(depositAmt, 6)} USDC`);
      console.log(`    redeemed:   ${ethers.formatUnits(received, 6)} USDC`);
      console.log(`    gain:      +${ethers.formatUnits(received - depositAmt, 6)} USDC`);

      // Vault share supply should be 0 (or just the treasury's residual dust)
      const supplyAfter = await vault.totalSupply();
      expect(supplyAfter).to.be.closeTo(0n, D18(1)); // within 1 share
    });
  });

  // ── Path 4: emergencyExit ──────────────────────────────────────────────────

  describe("Path 4 — emergencyExit", function () {
    this.timeout(120_000);

    it("emergencyExit() withdraws all from Aave, totalManagedAssets becomes 0", async function () {
      const { vault, manager, strategy, aUsdc, admin, alice } = await deployFixture();

      const depositAmt = D6(3_000);
      await vault.connect(alice).deposit(depositAmt, alice.address);

      const toManager = (depositAmt * 70n) / 100n;
      await vault.connect(admin).transferToStrategyManager(toManager);
      await manager.connect(admin).invest(toManager);

      // Advance 3 days to have accrued yield
      await time.increase(3 * 24 * 3600);
      await network.provider.send("evm_mine", []);

      const stratAddr          = await strategy.getAddress();
      const aTokenBeforeExit   = await aUsdc.balanceOf(stratAddr);
      const managedBeforeExit  = await manager.totalManagedAssets();

      expect(aTokenBeforeExit).to.be.gt(0n);

      // Trigger emergencyExit via manager
      await manager.connect(admin).emergencyExit();

      const aTokenAfterExit    = await aUsdc.balanceOf(stratAddr);
      const managedAfterExit   = await manager.totalManagedAssets();
      const managerUsdcBal     = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(await manager.getAddress());

      // aToken balance must be 0 after emergency exit
      expect(aTokenAfterExit).to.equal(0n);

      // emergencyExit() auto-forwards all USDC to vault — manager balance is 0
      expect(managerUsdcBal).to.equal(0n);

      // totalManagedAssets() is 0: strategy drained, manager empty (already forwarded to vault)
      const managedFinal = await manager.totalManagedAssets();
      expect(managedFinal).to.equal(0n);

      // Vault received the funds: vault had 30% reserve + emergencyExit forwarded strategy funds
      // Total vault balance ≈ (depositAmt - toManager) + managedBeforeExit
      const vaultUsdcBal = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(await vault.getAddress());
      const expectedVaultBal = (depositAmt - toManager) + managedBeforeExit;
      expect(vaultUsdcBal).to.be.closeTo(expectedVaultBal, D6(1));

      // lastEmergencyExitAt must be set
      const lastExit = await strategy.lastEmergencyExitAt();
      expect(lastExit).to.be.gt(0n);

      console.log(`    aToken before: ${ethers.formatUnits(aTokenBeforeExit, 6)} aUSDC`);
      console.log(`    aToken after:  0 aUSDC`);
      console.log(`    USDC returned: ${ethers.formatUnits(managerUsdcBal, 6)} USDC`);
      console.log(`    lastEmergencyExitAt: ${new Date(Number(lastExit) * 1000).toISOString()}`);
    });

    it("emergencyExit() recovers MORE than invested (yield included)", async function () {
      const { vault, manager, strategy, aUsdc, admin, alice } = await deployFixture();

      const depositAmt = D6(5_000);
      await vault.connect(alice).deposit(depositAmt, alice.address);
      const toManager = (depositAmt * 70n) / 100n;
      await vault.connect(admin).transferToStrategyManager(toManager);
      await manager.connect(admin).invest(toManager);

      // 30 days of yield
      await time.increase(30 * 24 * 3600);
      await network.provider.send("evm_mine", []);

      const stratAddr = await strategy.getAddress();
      const aTokenBal = await aUsdc.balanceOf(stratAddr);

      // aToken has grown — emergency exit should recover more than invested
      expect(aTokenBal).to.be.gt(toManager);

      await manager.connect(admin).emergencyExit();

      // emergencyExit() auto-forwards to vault — check vault balance
      const vaultUsdcBal = await new ethers.Contract(
        USDC,
        ["function balanceOf(address) view returns (uint256)"],
        admin
      ).balanceOf(await vault.getAddress());

      // Recovered USDC includes yield (vault had 30% reserve + received the rest)
      expect(vaultUsdcBal).to.be.gte(depositAmt);

      const yield30d = Number(ethers.formatUnits(vaultUsdcBal - depositAmt, 6));
      console.log(`    invested:  ${ethers.formatUnits(toManager, 6)} USDC`);
      console.log(`    vault bal: ${ethers.formatUnits(vaultUsdcBal, 6)} USDC`);
      console.log(`    30d yield: +${yield30d.toFixed(6)} USDC`);
    });
  });
});
