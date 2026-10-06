import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Step3_LiveRun.test.ts
 *
 * Step3 key path integration tests covering the whitelist run period
 * combined operational flow:
 *
 *   [S3-A] Allowlist gate — only allowed addresses can deposit
 *   [S3-B] Deposit + NAV accounting after allowlisted deposits
 *   [S3-C] invest to strategy, investCap enforcement
 *   [S3-D] Redeem accessible when deposits paused (exit priority)
 *   [S3-E] Emergency pause flow — redeem still works, deposits blocked
 *   [S3-F] Divest + returnToVault restores vault idle for redeem
 *   [S3-G] emergencyExit withdraws all from strategy, users can redeem
 *   [S3-H] Allowlist removal after deposit — can still redeem, cannot re-deposit
 *
 * Notes on vault setup:
 *   - reserveRatioBps defaults to 10,000 (100% reserve) — set to 3,000 before invest tests
 *   - MAX_STRATEGY_DEPLOY_BPS = 7,000 (70% hard cap)
 *   - investCap defaults to 0 (unlimited) in StrategyManagerV01; setLimits(cap, minIdle) to change
 *   - Custom errors are used throughout (not string reverts)
 */
describe("Step3: Live-Run Key Path Integration", function () {
  let vault:    FundVaultV01;
  let manager:  StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc:     MockUSDC;

  let admin:    SignerWithAddress;
  let treasury: SignerWithAddress;
  let guardian: SignerWithAddress;
  let alice:    SignerWithAddress; // allowlisted
  let bob:      SignerWithAddress; // NOT allowlisted
  let carol:    SignerWithAddress; // allowlisted, second user

  const D6 = (n: number) => ethers.parseUnits(String(n), 6);

  beforeEach(async function () {
    [, admin, treasury, guardian, alice, bob, carol] = await ethers.getSigners();

    usdc     = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault    = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "fbUSDC", "fbUSDC", treasury.address, admin.address
    );
    manager  = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(), await vault.getAddress(), admin.address
    );
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );

    // Wire strategy + vault
    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();
    await vault.connect(admin).setModules(await manager.getAddress());

    // Grant EMERGENCY_ROLE to guardian
    const EMERGENCY_ROLE = await vault.EMERGENCY_ROLE();
    await vault.connect(admin).grantRole(EMERGENCY_ROLE, guardian.address);
    const MGR_EMERGENCY = await manager.EMERGENCY_ROLE();
    await manager.connect(admin).grantRole(MGR_EMERGENCY, guardian.address);

    // Add alice and carol to allowlist; bob is NOT allowlisted
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(admin).addToAllowlist(carol.address);

    // Mint USDC
    await usdc.mint(alice.address,  D6(5_000));
    await usdc.mint(bob.address,    D6(5_000));
    await usdc.mint(carol.address,  D6(5_000));

    // Approvals
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(),   ethers.MaxUint256);
    await usdc.connect(carol).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-A: Allowlist gate
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-A1] non-allowlisted address cannot deposit", async function () {
    await expect(
      vault.connect(bob).deposit(D6(100), bob.address)
    ).to.be.revertedWithCustomError(vault, "NotAllowed");
  });

  it("[S3-A2] allowlisted address can deposit successfully", async function () {
    await vault.connect(alice).deposit(D6(500), alice.address);
    const shares = await vault.balanceOf(alice.address);
    expect(shares).to.be.gt(0n);
  });

  it("[S3-A3] isAllowed returns correct value for both cases", async function () {
    expect(await vault.isAllowed(alice.address)).to.equal(true);
    expect(await vault.isAllowed(bob.address)).to.equal(false);
    expect(await vault.isAllowed(carol.address)).to.equal(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-B: Deposit + NAV accounting
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-B1] totalAssets increases after deposit; PPS remains stable", async function () {
    const ppsBefore = await vault.pricePerShare();
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    const totalAssets = await vault.totalAssets();
    expect(totalAssets).to.equal(D6(1_000));
    const ppsAfter = await vault.pricePerShare();
    expect(ppsAfter).to.equal(ppsBefore);
  });

  it("[S3-B2] two allowlisted users deposit; totalAssets = sum", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(carol).deposit(D6(500),   carol.address);
    const totalAssets = await vault.totalAssets();
    expect(totalAssets).to.equal(D6(1_500));
  });

  it("[S3-B3] user share value reflects deposit amount correctly", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    const shares   = await vault.balanceOf(alice.address);
    const estValue = await vault.convertToAssets(shares);
    // Allow 1 USDC tolerance for rounding
    expect(estValue).to.be.closeTo(D6(1_000), D6(1));
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-C: invest to strategy + investCap enforcement
  // Setup: reserveRatioBps must be < 10,000; MAX_STRATEGY_DEPLOY_BPS = 70%
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-C1] admin can transferToStrategyManager then invest", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000); // 30% reserve, 70% can deploy
    await vault.connect(admin).transferToStrategyManager(D6(500));
    await manager.connect(admin).invest(D6(500));
    const stratDep = await strategy.totalUnderlying();
    expect(stratDep).to.equal(D6(500));
  });

  it("[S3-C2] invest beyond investCap reverts with CapExceeded", async function () {
    // Set investCap to 300 USDC via setLimits(cap, minIdle)
    await manager.connect(admin).setLimits(D6(300), 0);
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(500));
    await expect(
      manager.connect(admin).invest(D6(400))
    ).to.be.revertedWithCustomError(manager, "CapExceeded");
  });

  it("[S3-C3] investCap = 1 USDC blocks large invest", async function () {
    await manager.connect(admin).setLimits(D6(1), 0); // 1 USDC cap
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(500));
    await expect(
      manager.connect(admin).invest(D6(100))
    ).to.be.revertedWithCustomError(manager, "CapExceeded");
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-D: Redeem accessible when deposits paused
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-D1] user can redeem when deposits are paused", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).pauseDeposits();
    expect(await vault.depositsPaused()).to.equal(true);

    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("[S3-D2] user can redeem when systemMode = Paused (1)", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setMode(1); // Paused

    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("[S3-D3] non-allowlisted deposit blocked regardless of system mode", async function () {
    await expect(
      vault.connect(bob).deposit(D6(100), bob.address)
    ).to.be.revertedWithCustomError(vault, "NotAllowed");
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-E: Emergency pause flow (GUARDIAN / ADMIN)
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-E1] emergency pause: deposits blocked, redeems still open", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);

    // Simulate emergency_pause.ts: pauseDeposits + setMode(1) + manager.pause()
    await vault.connect(guardian).pauseDeposits();
    await vault.connect(guardian).setMode(1);
    await manager.connect(guardian).pause();

    // Deposits are blocked
    await expect(
      vault.connect(alice).deposit(D6(100), alice.address)
    ).to.be.revertedWithCustomError(vault, "DepositsArePaused");

    // Redeems still work
    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("[S3-E2] GUARDIAN cannot unpause (recovery requires ADMIN)", async function () {
    await vault.connect(guardian).pauseDeposits();
    await expect(
      vault.connect(guardian).unpauseDeposits()
    ).to.be.reverted;
    // Only ADMIN can unpause
    await vault.connect(admin).unpauseDeposits();
    expect(await vault.depositsPaused()).to.equal(false);
  });

  it("[S3-E3] GUARDIAN cannot set mode=EmergencyExit (2)", async function () {
    await expect(
      vault.connect(guardian).setMode(2)
    ).to.be.reverted;
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-F: Divest + returnToVault restores vault idle
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-F1] after invest, divest+returnToVault restores vault liquidity", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(600));
    await manager.connect(admin).invest(D6(600));

    // totalAssets still reflects all funds
    expect(await vault.totalAssets()).to.equal(D6(1_000));

    // Vault idle is only 400 now
    const vaultAddr = await vault.getAddress();
    expect(await usdc.balanceOf(vaultAddr)).to.equal(D6(400));

    // Divest
    await manager.connect(admin).divest(D6(600));
    await manager.connect(admin).returnToVault(D6(600));

    // Vault idle restored
    expect(await usdc.balanceOf(vaultAddr)).to.equal(D6(1_000));
  });

  it("[S3-F2] user can redeem full amount after divest restores vault", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(600));
    await manager.connect(admin).invest(D6(600));

    // Divest + return
    await manager.connect(admin).divest(D6(600));
    await manager.connect(admin).returnToVault(D6(600));

    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
    // Alice gets back approximately her original 5000 USDC (deposited and withdrew 1000)
    const aliceUsdc = await usdc.balanceOf(alice.address);
    expect(aliceUsdc).to.be.closeTo(D6(5_000), D6(1));
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-G: emergencyExit — full withdrawal from strategy
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-G1] emergencyExit pulls all strategy funds back to vault", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(600));
    await manager.connect(admin).invest(D6(600));

    // emergency exit
    await manager.connect(admin).emergencyExit();

    // Strategy should have 0
    expect(await strategy.totalUnderlying()).to.equal(0n);
    // totalAssets is preserved
    expect(await vault.totalAssets()).to.be.closeTo(D6(1_000), D6(1));
  });

  it("[S3-G2] after emergencyExit, user can redeem via claimExitAssets", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    await vault.connect(admin).setExternalTransfersEnabled(true);
    await vault.connect(admin).setReserveRatioBps(3_000);
    await vault.connect(admin).transferToStrategyManager(D6(600));
    await manager.connect(admin).invest(D6(600));
    await manager.connect(admin).emergencyExit();

    // Admin sets EmergencyExit mode and opens exit round
    await vault.connect(admin).setMode(2); // EmergencyExit
    await vault.connect(admin).openExitModeRound(await vault.totalAssets());

    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).claimExitAssets(1, shares); // roundId=1
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  // ────────────────────────────────────────────────────────────────────────
  // S3-H: Allowlist removal does NOT block existing user's redeem
  // ────────────────────────────────────────────────────────────────────────

  it("[S3-H1] removing user from allowlist after deposit does not block their redeem", async function () {
    await vault.connect(alice).deposit(D6(1_000), alice.address);
    // Remove alice from allowlist
    await vault.connect(admin).removeFromAllowlist(alice.address);
    expect(await vault.isAllowed(alice.address)).to.equal(false);

    // Alice can still redeem
    const shares = await vault.balanceOf(alice.address);
    await vault.connect(alice).redeem(shares, alice.address, alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("[S3-H2] removed user cannot make new deposits", async function () {
    await vault.connect(alice).deposit(D6(500), alice.address);
    await vault.connect(admin).removeFromAllowlist(alice.address);

    await expect(
      vault.connect(alice).deposit(D6(100), alice.address)
    ).to.be.revertedWithCustomError(vault, "NotAllowed");
  });
});
