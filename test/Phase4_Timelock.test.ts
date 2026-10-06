import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FundVaultV01, MockUSDC, StrategyManagerV01, DummyStrategy } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Phase4_Timelock.test.ts
 *
 * Verifies the ProtocolTimelockV02 / DEFAULT_ADMIN_ROLE transfer pattern:
 *   - Non-emergency ops cannot execute immediately once admin role is held by timelock
 *   - Scheduled ops fail before delay expires
 *   - Scheduled ops succeed after MIN_DELAY (24h)
 *   - EMERGENCY_ROLE operations bypass timelock and execute immediately
 *
 * Setup:
 *   1. Deploy ProtocolTimelockV02 (proposers=[admin], executors=[address(0)], timelockAdmin=admin)
 *   2. grantRole(DEFAULT_ADMIN_ROLE, timelock) on vault + manager
 *   3. revokeRole(DEFAULT_ADMIN_ROLE, admin) on vault + manager
 *   => admin can no longer call vault/manager admin functions directly
 */
describe("Phase4: Timelock — non-emergency ops require 24h delay", function () {
  let vault:    FundVaultV01;
  let manager:  StrategyManagerV01;
  let strategy: DummyStrategy;
  let usdc:     MockUSDC;
  let timelock: any;  // ProtocolTimelockV02 — typed as any pending typechain regen

  let admin:     SignerWithAddress;
  let emergency: SignerWithAddress;
  let treasury:  SignerWithAddress;
  let alice:     SignerWithAddress;

  const D6         = (n: number) => ethers.parseUnits(String(n), 6);
  const DELAY_24H  = 24 * 3600;
  const ZERO_HASH  = ethers.ZeroHash;

  // OZ TimelockController role constants
  const PROPOSER_ROLE       = ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE"));
  const EXECUTOR_ROLE       = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
  const TIMELOCK_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TIMELOCK_ADMIN_ROLE"));

  // Protocol role constants
  const DEFAULT_ADMIN_ROLE  = ethers.ZeroHash;
  const EMERGENCY_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));

  beforeEach(async function () {
    [, admin, emergency, treasury, alice] = await ethers.getSigners();

    // ── deploy core contracts ─────────────────────────────────────────────────
    usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    vault = await (await ethers.getContractFactory("FundVaultV01")).deploy(
      await usdc.getAddress(), "fbUSDC", "fbUSDC",
      treasury.address, admin.address
    );
    manager = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(), await vault.getAddress(), admin.address
    );
    strategy = await (await ethers.getContractFactory("DummyStrategy")).deploy(
      await usdc.getAddress()
    );
    await manager.connect(admin).pause();
    await manager.connect(admin).setStrategy(await strategy.getAddress());
    await manager.connect(admin).unpause();
    await vault.connect(admin).setModules(await manager.getAddress());

    // Grant EMERGENCY_ROLE to emergency signer
    await vault.connect(admin).grantRole(EMERGENCY_ROLE, emergency.address);
    await manager.connect(admin).grantRole(EMERGENCY_ROLE, emergency.address);

    // ── deploy timelock ───────────────────────────────────────────────────────
    timelock = await (await ethers.getContractFactory("ProtocolTimelockV02")).deploy(
      [admin.address],         // proposers: admin multisig
      [ethers.ZeroAddress],    // executors: address(0) = anyone can execute after delay
      admin.address            // timelock admin (can manage roles; may renounce post-setup)
    );
    const timelockAddr = await timelock.getAddress();

    // ── transfer DEFAULT_ADMIN_ROLE to timelock on vault + manager ────────────
    await vault.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, timelockAddr);
    await vault.connect(admin).revokeRole(DEFAULT_ADMIN_ROLE, admin.address);

    await manager.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, timelockAddr);
    await manager.connect(admin).revokeRole(DEFAULT_ADMIN_ROLE, admin.address);
  });

  // ─── Helper: schedule a call through timelock ─────────────────────────────
  async function scheduleAndExecute(
    target:   string,
    callData: string,
    salt:     string,
    waitSecs: number
  ) {
    // Schedule (admin is a PROPOSER on the timelock)
    await timelock.connect(admin).schedule(
      target, 0n, callData, ZERO_HASH, salt, DELAY_24H
    );
    // Advance time
    await time.increase(waitSecs);
    // Execute (anyone, since executors=[address(0)])
    return timelock.connect(alice).execute(target, 0n, callData, ZERO_HASH, salt);
  }

  // ─── 1. Direct admin call fails after role transfer ───────────────────────
  it("admin cannot call vault admin function directly after timelock setup", async function () {
    await expect(
      vault.connect(admin).setMgmtFeeBpsPerMonth(100)
    ).to.be.revertedWith(/AccessControl/);
  });

  // ─── 2. Execute before delay expires reverts ─────────────────────────────
  it("scheduled op reverts if executed before 24h delay", async function () {
    const callData = vault.interface.encodeFunctionData("setMgmtFeeBpsPerMonth", [100]);
    const salt     = ethers.id("salt-fee-1");
    const vaultAddr = await vault.getAddress();

    await timelock.connect(admin).schedule(
      vaultAddr, 0n, callData, ZERO_HASH, salt, DELAY_24H
    );

    // Try to execute after only 23h
    await time.increase(23 * 3600);
    await expect(
      timelock.connect(alice).execute(vaultAddr, 0n, callData, ZERO_HASH, salt)
    ).to.be.revertedWith("TimelockController: operation is not ready");
  });

  // ─── 3. Execute after delay succeeds ──────────────────────────────────────
  it("scheduled op executes successfully after 24h delay", async function () {
    const callData  = vault.interface.encodeFunctionData("setMgmtFeeBpsPerMonth", [100]);
    const salt      = ethers.id("salt-fee-2");
    const vaultAddr = await vault.getAddress();

    await scheduleAndExecute(vaultAddr, callData, salt, DELAY_24H + 1);

    expect(await vault.mgmtFeeBpsPerMonth()).to.equal(100n);
  });

  // ─── 4. setModules change via timelock ────────────────────────────────────
  it("setModules (high-risk op) executes via timelock after delay", async function () {
    // Deploy a second dummy manager for the swap test
    const manager2 = await (await ethers.getContractFactory("StrategyManagerV01")).deploy(
      await usdc.getAddress(), await vault.getAddress(), await timelock.getAddress()
    );
    const callData  = vault.interface.encodeFunctionData("setModules", [await manager2.getAddress()]);
    const salt      = ethers.id("salt-modules-1");
    const vaultAddr = await vault.getAddress();

    await scheduleAndExecute(vaultAddr, callData, salt, DELAY_24H + 1);
    expect(await vault.strategyManager()).to.equal(await manager2.getAddress());
  });

  // ─── 5. EMERGENCY_ROLE bypasses timelock — pause is immediate ────────────
  it("EMERGENCY_ROLE can pause vault immediately without timelock", async function () {
    await expect(vault.connect(emergency).pauseDeposits()).to.not.be.reverted;
    expect(await vault.depositsPaused()).to.equal(true);
  });

  // ─── 6. EMERGENCY_ROLE setMode(Paused) is immediate ──────────────────────
  it("EMERGENCY_ROLE can set system to Paused immediately", async function () {
    await expect(vault.connect(emergency).setMode(1 /* Paused */)).to.not.be.reverted;
    expect(await vault.systemMode()).to.equal(1n);
  });

  // ─── 7. EMERGENCY_ROLE cannot set Normal mode (admin-only, timelock required) ──
  it("EMERGENCY_ROLE cannot restore Normal mode — requires timelock", async function () {
    // First enter Paused via emergency
    await vault.connect(emergency).setMode(1 /* Paused */);

    // Emergency role cannot exit Paused back to Normal — _checkRole(DEFAULT_ADMIN_ROLE) fires
    await expect(vault.connect(emergency).setMode(0 /* Normal */))
      .to.be.revertedWith(/AccessControl/);
  });

  // ─── 8. Unpause vault requires timelock ───────────────────────────────────
  it("restoring Normal mode requires scheduling through timelock", async function () {
    // Enter paused state
    await vault.connect(emergency).setMode(1 /* Paused */);

    // Schedule setMode(Normal) through timelock
    const callData  = vault.interface.encodeFunctionData("setMode", [0 /* Normal */]);
    const salt      = ethers.id("salt-restore-normal");
    const vaultAddr = await vault.getAddress();

    await scheduleAndExecute(vaultAddr, callData, salt, DELAY_24H + 1);
    expect(await vault.systemMode()).to.equal(0n); // Normal
  });

  // ─── 9. manager unpause requires timelock ────────────────────────────────
  it("StrategyManager unpause requires timelock after role transfer", async function () {
    // Emergency can pause manager
    await expect(manager.connect(emergency).pause()).to.not.be.reverted;

    // Direct unpause by admin fails
    await expect(manager.connect(admin).unpause())
      .to.be.revertedWith(/AccessControl/);

    // Schedule unpause via timelock
    const callData    = manager.interface.encodeFunctionData("unpause");
    const salt        = ethers.id("salt-manager-unpause");
    const managerAddr = await manager.getAddress();

    await scheduleAndExecute(managerAddr, callData, salt, DELAY_24H + 1);
    expect(await manager.paused()).to.equal(false);
  });
});
