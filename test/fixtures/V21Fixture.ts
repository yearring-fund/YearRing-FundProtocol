/**
 * V21Fixture.ts
 * =============
 * Canonical deployment fixture for YearRing Fund Protocol V2.1 tests.
 *
 * Post-fixture protocol state
 * ----------------------------
 * Vault
 *   allowlistEnabled = true
 *   allowlist:       admin, treasury, accessStrategyManager, user1, user2, user3
 *   coreStrategyManager = csm
 *   seed deposit:    admin → 10 USDC → yrUSDC (initial totalAssets = 10 USDC)
 *
 * CoreStrategyManagerV21
 *   feeReceiver = treasury
 *   strategy    = coreMockStrategy (independent MockStrategyV21 instance)
 *
 * AccessStrategyManagerV21
 *   feeReceiver          = treasury
 *   strategy             = asmMockStrategy (independent MockStrategyV21 instance)
 *   lockManager          = lockManager
 *   managementFeeBpsPerYear = 100 (1 %)
 *   on vault allowlist   = true  (required for exit() → CoreVault.deposit())
 *
 * LockManagerV21
 *   pointsLedger          = pointsLedger
 *   eligibilityModule     = address(0)  (NOT set — connect manually in ASM tests)
 *   REBATE_MANAGER_ROLE   → rebateManager
 *   KEEPER_ROLE           → keeper
 *   coreSMFeeBpsPerYear   = 50 (default, matches CoreSM.FEE_BPS)
 *
 * PointsLedgerV01
 *   POINTS_MINTER_ROLE    → lockManager
 *   POINTS_BURNER_ROLE    → lockManager
 *
 * TreasuryV21
 *   rebateManager         = rebateManager
 *   accessManagers        = [accessStrategyManager]
 *   on vault allowlist    = true  (required for settleCoreSMFees → CoreVault.deposit())
 *
 * EligibilityModuleV21
 *   Deployed with lockManager + pointsLedger wired.
 *   NOT connected to lockManager.eligibilityModule — tests attach manually.
 *
 * PortfolioLensV21
 *   Wired to: vault, lockManager, eligibilityModule, pointsLedger, treasury.
 */

import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MockUSDC,
  YearRingCoreVaultV21,
  CoreStrategyManagerV21,
  MockStrategyV21,
  TreasuryV21,
  AccessStrategyManagerV21,
  LockManagerV21,
  RebateManagerV21,
  EligibilityModuleV21,
  PortfolioLensV21,
  PointsLedgerV01,
} from "../../typechain-types";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface V21Contracts {
  usdc:                    MockUSDC;
  vault:                   YearRingCoreVaultV21;
  csm:                     CoreStrategyManagerV21;
  coreMockStrategy:        MockStrategyV21;
  treasury:                TreasuryV21;
  accessStrategyManager:   AccessStrategyManagerV21;
  asmMockStrategy:         MockStrategyV21;
  lockManager:             LockManagerV21;
  rebateManager:           RebateManagerV21;
  eligibilityModule:       EligibilityModuleV21;
  lens:                    PortfolioLensV21;
  pointsLedger:            PointsLedgerV01;
}

export interface V21Signers {
  admin:  SignerWithAddress;
  keeper: SignerWithAddress;
  user1:  SignerWithAddress;
  user2:  SignerWithAddress;
  user3:  SignerWithAddress;
}

export interface V21Fixture extends V21Contracts {
  signers: V21Signers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (re-exported for use in test files)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a human-readable USDC amount to 6-decimal units. */
export const usdc6 = (n: number | bigint): bigint =>
  ethers.parseUnits(String(n), 6);

/** Parse a human-readable amount to 18-decimal units. */
export const units18 = (n: number | bigint): bigint =>
  ethers.parseUnits(String(n), 18);

export const DAY     = 86_400n;
export const YEAR    = 365n * DAY;

/** Advance chain time and mine one block. */
export async function advanceTime(seconds: bigint): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
}

/** Advance chain time to an absolute timestamp. */
export async function advanceTimeTo(timestamp: bigint): Promise<void> {
  await time.increaseTo(Number(timestamp));
}

// ─────────────────────────────────────────────────────────────────────────────
// Role constants (keccak256 precomputed at module load, matches contracts)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ADMIN_ROLE  = ethers.ZeroHash;
export const KEEPER_ROLE         = ethers.keccak256(ethers.toUtf8Bytes("KEEPER_ROLE"));
export const REBATE_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBATE_MANAGER_ROLE"));
export const POINTS_MINTER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_MINTER_ROLE"));
export const POINTS_BURNER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("POINTS_BURNER_ROLE"));
export const ALLOWLIST_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("ALLOWLIST_ROLE"));
export const EMERGENCY_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));
export const SNAPSHOT_ROLE       = ethers.keccak256(ethers.toUtf8Bytes("SNAPSHOT_ROLE"));

// ─────────────────────────────────────────────────────────────────────────────
// deployV21Fixture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deploy the full V2.1 protocol suite and return all contracts + signers.
 *
 * Intended to be called inside `loadFixture()` from hardhat-network-helpers
 * so Hardhat can snapshot and reset state between tests cheaply.
 *
 * Signer layout (Hardhat default accounts):
 *   [0] = deployer   (only used during deploy; holds no protocol roles)
 *   [1] = admin      (DEFAULT_ADMIN_ROLE on all contracts)
 *   [2] = keeper     (KEEPER_ROLE on vault, csm, accessStrategyManager, lockManager)
 *   [3] = user1
 *   [4] = user2
 *   [5] = user3
 */
export async function deployV21Fixture(): Promise<V21Fixture> {

  // ── 1. Signers ─────────────────────────────────────────────────────────────
  const [, admin, keeper, user1, user2, user3] = await ethers.getSigners();

  // ── 2. MockUSDC ────────────────────────────────────────────────────────────
  const usdc = await ethers
    .getContractFactory("MockUSDC")
    .then(f => f.deploy()) as MockUSDC;

  const usdcAddr = await usdc.getAddress();

  // ── 3. PointsLedgerV01 ─────────────────────────────────────────────────────
  const pointsLedger = await ethers
    .getContractFactory("PointsLedgerV01")
    .then(f => f.deploy(admin.address)) as PointsLedgerV01;

  const pointsLedgerAddr = await pointsLedger.getAddress();

  // ── 4. YearRingCoreVaultV21 ────────────────────────────────────────────────
  //    CoreSM address is unknown at this point — wired post-deploy via setCoreStrategyManager.
  const vault = await ethers
    .getContractFactory("YearRingCoreVaultV21")
    .then(f => f.deploy(
      usdcAddr,
      admin.address,
      "YearRing USDC",
      "yrUSDC",
    )) as YearRingCoreVaultV21;

  const vaultAddr = await vault.getAddress();

  // ── 5. CoreStrategyManagerV21 ──────────────────────────────────────────────
  //    vault address is now known; CSM is immutably bound to vault.
  const csm = await ethers
    .getContractFactory("CoreStrategyManagerV21")
    .then(f => f.deploy(
      usdcAddr,
      vaultAddr,
      admin.address,
    )) as CoreStrategyManagerV21;

  const csmAddr = await csm.getAddress();

  // ── 6. Wire Vault → CoreSM ────────────────────────────────────────────────
  //    MUST happen before any deposit (autoRebalance will call csm).
  await vault.connect(admin).setCoreStrategyManager(csmAddr);

  // ── 7. CoreSM's own MockStrategyV21 ───────────────────────────────────────
  //    `manager` is immutable — this instance belongs exclusively to CoreSM.
  const coreMockStrategy = await ethers
    .getContractFactory("MockStrategyV21")
    .then(f => f.deploy(
      usdcAddr,
      csmAddr,
      admin.address,
    )) as MockStrategyV21;

  // ── 8. TreasuryV21 ────────────────────────────────────────────────────────
  const treasury = await ethers
    .getContractFactory("TreasuryV21")
    .then(f => f.deploy(
      vaultAddr,
      usdcAddr,
      csmAddr,
      admin.address,
    )) as TreasuryV21;

  const treasuryAddr = await treasury.getAddress();

  // ── 9. AccessStrategyManagerV21 ───────────────────────────────────────────
  //    lockManager address is unknown yet; set via setLockManager() after deploy.
  const accessStrategyManager = await ethers
    .getContractFactory("AccessStrategyManagerV21")
    .then(f => f.deploy(
      usdcAddr,
      vaultAddr,
      ethers.ZeroAddress,   // lockManager — unknown at this point
      100,                  // 100 bps/year = 1% management fee
      admin.address,
    )) as AccessStrategyManagerV21;

  const asmAddr = await accessStrategyManager.getAddress();

  // ── 10. ASM's own MockStrategyV21 ─────────────────────────────────────────
  //     Separate instance from coreMockStrategy — `manager` is immutable.
  const asmMockStrategy = await ethers
    .getContractFactory("MockStrategyV21")
    .then(f => f.deploy(
      usdcAddr,
      asmAddr,
      admin.address,
    )) as MockStrategyV21;

  // ── 11. LockManagerV21 ────────────────────────────────────────────────────
  //    yrUSDC_ == coreVault_ because the vault IS the yrUSDC ERC-20 (ERC4626 share).
  const lockManager = await ethers
    .getContractFactory("LockManagerV21")
    .then(f => f.deploy(
      vaultAddr,            // yrUSDC (vault share token)
      vaultAddr,            // coreVault (for convertToAssets)
      pointsLedgerAddr,
      admin.address,
    )) as LockManagerV21;

  const lockManagerAddr = await lockManager.getAddress();

  // ── 12. Wire ASM → LockManager (now known) ────────────────────────────────
  await accessStrategyManager.connect(admin).setLockManager(lockManagerAddr);

  // ── 13. RebateManagerV21 ──────────────────────────────────────────────────
  const rebateManager = await ethers
    .getContractFactory("RebateManagerV21")
    .then(f => f.deploy(
      vaultAddr,
      lockManagerAddr,
      treasuryAddr,
      admin.address,
    )) as RebateManagerV21;

  const rebateManagerAddr = await rebateManager.getAddress();

  // ── 14. EligibilityModuleV21 ──────────────────────────────────────────────
  //    Deployed fully wired (knows lockManager + pointsLedger) but is NOT attached
  //    to lockManager.eligibilityModule — tests that need it call
  //    lockManager.connect(admin).setEligibilityModule(eligibilityModule.address).
  const eligibilityModule = await ethers
    .getContractFactory("EligibilityModuleV21")
    .then(f => f.deploy(
      lockManagerAddr,
      pointsLedgerAddr,
      admin.address,
    )) as EligibilityModuleV21;

  // ── 15. PortfolioLensV21 ──────────────────────────────────────────────────
  const eligibilityModuleAddr = await eligibilityModule.getAddress();
  const lens = await ethers
    .getContractFactory("PortfolioLensV21")
    .then(f => f.deploy(
      vaultAddr,
      lockManagerAddr,
      eligibilityModuleAddr,
      pointsLedgerAddr,
      treasuryAddr,
    )) as PortfolioLensV21;

  // ─────────────────────────────────────────────────────────────────────────
  // Role grants & configuration
  // ─────────────────────────────────────────────────────────────────────────

  // CoreSM
  await csm.connect(admin).setFeeReceiver(treasuryAddr);
  await csm.connect(admin).setStrategy(await coreMockStrategy.getAddress());
  await csm.connect(admin).grantRole(KEEPER_ROLE, keeper.address);

  // ASM  (lockManager already wired in step 12)
  await accessStrategyManager.connect(admin).setFeeReceiver(treasuryAddr);
  await accessStrategyManager.connect(admin).setStrategy(await asmMockStrategy.getAddress());
  await accessStrategyManager.connect(admin).grantRole(KEEPER_ROLE, keeper.address);

  // Treasury
  await treasury.connect(admin).setRebateManager(rebateManagerAddr);
  await treasury.connect(admin).addAccessManager(asmAddr);

  // LockManager
  await lockManager.connect(admin).grantRole(REBATE_MANAGER_ROLE, rebateManagerAddr);
  await lockManager.connect(admin).grantRole(KEEPER_ROLE, keeper.address);
  // pointsLedger already set in constructor; eligibilityModule intentionally NOT set

  // PointsLedger — grant LockManager minting + burning rights
  await pointsLedger.connect(admin).grantRole(POINTS_MINTER_ROLE, lockManagerAddr);
  await pointsLedger.connect(admin).grantRole(POINTS_BURNER_ROLE, lockManagerAddr);

  // Vault — grant KEEPER_ROLE
  await vault.connect(admin).grantRole(KEEPER_ROLE, keeper.address);

  // ─────────────────────────────────────────────────────────────────────────
  // Vault allowlist
  // NOTE: admin MUST be added BEFORE the seed deposit below.
  // Treasury and ASM MUST be added so their internal CoreVault.deposit() calls succeed.
  // ─────────────────────────────────────────────────────────────────────────

  await vault.connect(admin).setAllowlist(admin.address,    true);
  await vault.connect(admin).setAllowlist(treasuryAddr,     true);
  await vault.connect(admin).setAllowlist(asmAddr,          true);
  await vault.connect(admin).setAllowlist(user1.address,    true);
  await vault.connect(admin).setAllowlist(user2.address,    true);
  await vault.connect(admin).setAllowlist(user3.address,    true);

  // ─────────────────────────────────────────────────────────────────────────
  // Seed deposit — 10 USDC by admin
  // V2.1 hard rule: admin must seed before opening to users to set initial PPS.
  // After this: totalAssets = 10e6, totalSupply = 10e18 (12-dec offset applied).
  // ─────────────────────────────────────────────────────────────────────────

  const SEED = usdc6(10);
  await usdc.mint(admin.address, SEED);
  await usdc.connect(admin).approve(vaultAddr, SEED);
  await vault.connect(admin).deposit(SEED, admin.address);

  // ─────────────────────────────────────────────────────────────────────────
  // Return
  // ─────────────────────────────────────────────────────────────────────────

  return {
    usdc,
    vault,
    csm,
    coreMockStrategy,
    treasury,
    accessStrategyManager,
    asmMockStrategy,
    lockManager,
    rebateManager,
    eligibilityModule,
    lens,
    pointsLedger,
    signers: { admin, keeper, user1, user2, user3 },
  };
}
