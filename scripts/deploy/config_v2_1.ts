/**
 * config_v2_1.ts — Network configuration for V2.1 deployment
 *
 * Usage: imported by deploy_v2_1.ts and any post-deploy admin scripts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V21Config {
  // ── Chain addresses ────────────────────────────────────────────────────────
  /** USDC token address. Empty string = deploy MockUSDC at runtime. */
  usdc: string;

  // ── Aave V3 (required only on Base; ignored on local) ─────────────────────
  aavePool:         string;
  aaveAUsdc:        string;
  aaveReferralCode: number;

  // ── Vault ─────────────────────────────────────────────────────────────────
  vaultName:   string;  // "YearRing USDC"
  vaultSymbol: string;  // "yrUSDC"

  // ── High-Tier Manager ──────────────────────────────────────────────────────
  /**
   * Annual management fee for ASM in basis points.
   * 100 bps = 1% per year (closed beta default).
   */
  asmFeeBpsPerYear: number;

  // ── Seed deposit ───────────────────────────────────────────────────────────
  /**
   * Initial USDC deposit by deployer to set PPS = 1.
   * Must be > 0. Recommend 10 USDC (= 10_000_000 in 6-dec).
   */
  seedDepositUSDC: bigint; // 6-dec

  // ── Role config ────────────────────────────────────────────────────────────
  /**
   * true  = deployer address holds all admin/keeper roles (local & fork tests).
   * false = ADMIN_ADDRESS / KEEPER_ADDRESS env vars are required (mainnet).
   */
  useDeployerAsAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Base Mainnet — V2.1
// ---------------------------------------------------------------------------
export const v21Mainnet: V21Config = {
  // Real USDC on Base
  usdc:             "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  aavePool:         "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  aaveAUsdc:        "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
  aaveReferralCode: 0,

  vaultName:   "YearRing USDC",
  vaultSymbol: "yrUSDC",

  // 1 % / year ASM management fee (closed beta)
  asmFeeBpsPerYear: 100,

  // Deployer must hold ≥ 10 USDC on mainnet before running
  seedDepositUSDC: 10_000_000n,  // 10 USDC (6-dec)

  useDeployerAsAdmin: false,
};

// ---------------------------------------------------------------------------
// Local / Hardhat (incl. Base fork) — V2.1
// ---------------------------------------------------------------------------
export const v21Local: V21Config = {
  usdc:             "",   // deployed at runtime (MockUSDC)
  aavePool:         "",   // not used — MockStrategyV21 deployed instead
  aaveAUsdc:        "",
  aaveReferralCode: 0,

  vaultName:   "YearRing USDC",
  vaultSymbol: "yrUSDC",

  asmFeeBpsPerYear: 100,

  seedDepositUSDC: 10_000_000n,  // 10 USDC

  useDeployerAsAdmin: true,
};

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------
export function getV21Config(networkName: string): V21Config {
  switch (networkName) {
    case "base":
      return v21Mainnet;
    case "hardhat":
    case "localhost":
    case "base-fork":
      return v21Local;
    default:
      throw new Error(`No V2.1 config for network: ${networkName}`);
  }
}
