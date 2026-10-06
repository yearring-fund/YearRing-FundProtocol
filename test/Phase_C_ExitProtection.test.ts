import { expect } from "chai";
import { ethers } from "hardhat";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Phase_C_ExitProtection.test.ts
 *
 * Verifies Step3 C.1 exit priority and role boundary requirements:
 *   - depositsPaused does NOT block redeem
 *   - Paused mode does NOT block redeem
 *   - redeemsPaused blocks redeem but NOT deposit
 *   - investCap / limit update does not affect user shares or accounting
 *   - EMERGENCY_ROLE can hit the brake (Paused) but cannot set EmergencyExit
 *   - EMERGENCY_ROLE can pause manager but cannot unpause
 *   - allowlist removal does not block existing user's redeem (C5 canonical, reconfirmed here)
 */
describe("Phase_C: Exit Priority Protection & Role Boundaries", function () {
  let vault:    FundVaultV01;
  let manager:  StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc:     MockUSDC;

  let admin:     SignerWithAddress;
  let treasury:  SignerWithAddress;
  let guardian:  SignerWithAddress; // holds EMERGENCY_ROLE
  let alice:     SignerWithAddress;
  let bob:       SignerWithAddress;

  const D6     = (n: number) => ethers.parseUnits(String(n), 6);
  const AMOUNT = D6(1_000);

  beforeEach(async function () {
    [, admin, treasury, guardian, alice, bob] = await ethers.getSigners();

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

    // Grant EMERGENCY_ROLE to guardian on both vault and manager
    const EMERGENCY_ROLE = await vault.EMERGENCY_ROLE();
    await vault.connect(admin).grantRole(EMERGENCY_ROLE, guardian.address);
    const MGR_EMERGENCY = await manager.EMERGENCY_ROLE();
    await manager.connect(admin).grantRole(MGR_EMERGENCY, guardian.address);

    // Alice has funds and is allowlisted; bob is NOT allowlisted
    await usdc.mint(alice.address, AMOUNT * 10n);
    await usdc.mint(bob.address,   AMOUNT);
    await usdc.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(bob).approve(await vault.getAddress(),   ethers.MaxUint256);
    await vault.connect(admin).addToAllowlist(alice.address);
    await vault.connect(alice).deposit(AMOUNT, alice.address);
  });

  // ── EXIT PRIORITY: deposits paused → redeem still works ──────────────────

  it("[C-EP1] depositsPaused does NOT block existing user's redeem", async function () {
    await vault.connect(admin).pauseDeposits();
    expect(await vault.depositsPaused()).to.be.true;

    const shares = await vault.balanceOf(alice.address);
    const usdcBefore = await usdc.balanceOf(alice.address);

    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
  });

  it("[C-EP2] systemMode=Paused does NOT block existing user's redeem", async function () {
    await vault.connect(admin).setMode(1); // Paused
    expect(await vault.systemMode()).to.equal(1);

    const shares = await vault.balanceOf(alice.address);
    const usdcBefore = await usdc.balanceOf(alice.address);

    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
  });

  it("[C-EP3] redeemsPaused blocks redeem but does NOT block deposit for allowlisted user", async function () {
    await vault.connect(admin).pauseRedeems();
    expect(await vault.redeemsPaused()).to.be.true;

    // Redeem is blocked
    const shares = await vault.balanceOf(alice.address);
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.be.revertedWithCustomError(vault, "RedeemsArePaused");

    // Deposit is NOT blocked (depositsPaused is independent)
    await expect(vault.connect(alice).deposit(AMOUNT, alice.address))
      .to.not.be.reverted;
  });

  it("[C-EP4] allowlist removal does NOT block existing user's redeem", async function () {
    await vault.connect(admin).removeFromAllowlist(alice.address);
    expect(await vault.isAllowed(alice.address)).to.be.false;

    const shares = await vault.balanceOf(alice.address);
    const usdcBefore = await usdc.balanceOf(alice.address);
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
  });

  it("[C-EP5] investCap hit does NOT block existing user's redeem", async function () {
    // Set investCap to 0 (simulates cap exhausted — no invest possible)
    await manager.connect(admin).setLimits(D6(0), 0);
    // invest() would fail now, but redeem must still work
    const shares = await vault.balanceOf(alice.address);
    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
  });

  it("[C-EP6] setLimits() does NOT change existing user's share balance", async function () {
    const sharesBefore = await vault.balanceOf(alice.address);
    const ppsBefore    = await vault.pricePerShare();

    await manager.connect(admin).setLimits(D6(5_000), D6(100));

    const sharesAfter  = await vault.balanceOf(alice.address);
    const ppsAfter     = await vault.pricePerShare();

    expect(sharesAfter).to.equal(sharesBefore);
    expect(ppsAfter).to.equal(ppsBefore);
  });

  // ── ROLE BOUNDARIES ───────────────────────────────────────────────────────

  it("[C-RB1] EMERGENCY_ROLE can set systemMode=Paused (the brake)", async function () {
    await expect(vault.connect(guardian).setMode(1))
      .to.emit(vault, "ModeChanged")
      .withArgs(1);
  });

  it("[C-RB2] EMERGENCY_ROLE cannot set systemMode=EmergencyExit", async function () {
    await expect(vault.connect(guardian).setMode(2))
      .to.be.reverted;
  });

  it("[C-RB3] EMERGENCY_ROLE cannot set systemMode=Normal (cannot self-resume)", async function () {
    await vault.connect(admin).setMode(1); // pause first
    await expect(vault.connect(guardian).setMode(0))
      .to.be.reverted;
  });

  it("[C-RB4] EMERGENCY_ROLE can pause manager (blocks invest)", async function () {
    await expect(manager.connect(guardian).pause())
      .to.not.be.reverted;
    expect(await manager.paused()).to.be.true;
  });

  it("[C-RB5] EMERGENCY_ROLE cannot unpause manager", async function () {
    await manager.connect(admin).pause();
    await expect(manager.connect(guardian).unpause())
      .to.be.reverted;
  });

  it("[C-RB6] EMERGENCY_ROLE cannot call emergencyExit on manager", async function () {
    await expect(manager.connect(guardian).emergencyExit())
      .to.be.reverted;
  });

  it("[C-RB7] EMERGENCY_ROLE can pauseDeposits but cannot unpauseDeposits", async function () {
    await expect(vault.connect(guardian).pauseDeposits()).to.not.be.reverted;
    expect(await vault.depositsPaused()).to.be.true;
    await expect(vault.connect(guardian).unpauseDeposits()).to.be.reverted;
  });

  it("[C-RB8] EMERGENCY_ROLE can pauseRedeems but cannot unpauseRedeems", async function () {
    await expect(vault.connect(guardian).pauseRedeems()).to.not.be.reverted;
    expect(await vault.redeemsPaused()).to.be.true;
    await expect(vault.connect(guardian).unpauseRedeems()).to.be.reverted;
  });

  it("[C-RB9] EMERGENCY_ROLE cannot addToAllowlist or removeFromAllowlist", async function () {
    await expect(vault.connect(guardian).addToAllowlist(bob.address))
      .to.be.reverted;
    await expect(vault.connect(guardian).removeFromAllowlist(alice.address))
      .to.be.reverted;
  });

  it("[C-RB10] EMERGENCY_ROLE cannot setLimits on manager", async function () {
    await expect(manager.connect(guardian).setLimits(0, 0))
      .to.be.reverted;
  });

  // ── COMBINED: emergency pause does not trap user funds ────────────────────

  it("[C-EP7] full emergency pause (deposits + mode=Paused + manager) still allows redeem", async function () {
    // Simulate what emergency_pause.ts does (minus PAUSE_REDEEMS)
    await vault.connect(guardian).pauseDeposits();
    await vault.connect(guardian).setMode(1);
    await manager.connect(guardian).pause();

    const shares = await vault.balanceOf(alice.address);
    const usdcBefore = await usdc.balanceOf(alice.address);

    await expect(vault.connect(alice).redeem(shares, alice.address, alice.address))
      .to.not.be.reverted;
    expect(await usdc.balanceOf(alice.address)).to.be.gt(usdcBefore);
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });
});
