// ---------------------------------------------------------------------------
// YearRing Fund Protocol — Closed Beta Deployment Configuration
// ---------------------------------------------------------------------------
// Usage: all closed beta deploy / setup / verify scripts must import from
//        this file. No magic numbers in scripts.
//
// Chain: Base Mainnet (chain ID 8453)
// ---------------------------------------------------------------------------

import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Points supply adequacy — verified 2026-05-04
// Formula: points = lockedUSDCValue(6dec) × 1e12 × days × multiplierBps / (10000 × 500)
// Worst case (all Gold 180d 1.8×):
//   - 20M Points supports up to ~$30.8M TVL
//   - 50 users × $20,000 each → 648,000 Points used (3.24% of supply)
//   - 100 users × $50,000 each → 3,240,000 Points used (16.2% of supply)
// Conclusion: 20M Points is sufficient for closed beta at any realistic scale.
// ---------------------------------------------------------------------------

export interface ClosedBetaConfig {
  // ── Chain addresses ──────────────────────────────────────────────────────
  usdc:             string;   // Base USDC
  aavePool:         string;   // Aave V3 Pool on Base
  aUsdc:            string;   // Aave aUSDC on Base
  aaveReferralCode: number;

  // ── Core Vault ───────────────────────────────────────────────────────────
  vaultName:        string;   // "YearRing Core Vault"
  vaultSymbol:      string;   // "yrCORE"
  mgmtFeeBpsPerMonth: number; // 4 bps/month (closed beta rate)

  // ── Points Token ─────────────────────────────────────────────────────────
  pointsTokenName:   string;   // "YearRing Points"
  pointsTokenSymbol: string;   // "YRPTS"
  pointsTotalSupply: bigint;   // 20,000,000 YRPTS (18 decimals)
                               // Same value as v2DemoConfig.rewardTotalSupply.
                               // Does NOT represent future native token supply.

  // ── Strategy ─────────────────────────────────────────────────────────────
  reserveRatioBps:  number;   // initial reserve ratio (bps)
  investCap:        bigint;   // 0 = unlimited
  minIdle:          bigint;   // 0 = no floor

  // ── Governance Signal ────────────────────────────────────────────────────
  votingThreshold:  bigint;   // min Points to cast a vote (18 decimals)
  votingPeriod:     bigint;   // voting window in seconds

  // ── Role config ──────────────────────────────────────────────────────────
  useDeployerAsAdmin: boolean; // true = deployer holds all roles (local / fork only)
}

// ---------------------------------------------------------------------------
// Base Mainnet — Closed Beta
// ---------------------------------------------------------------------------
export const closedBetaMainnet: ClosedBetaConfig = {
  // Chain addresses (same as production Base)
  usdc:             "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  aavePool:         "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  aUsdc:            "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
  aaveReferralCode: 0,

  // Core Vault
  vaultName:          "YearRing Core Vault",
  vaultSymbol:        "yrCORE",
  mgmtFeeBpsPerMonth: 4,        // closed beta rate (was 9 in V1)

  // Points Token
  pointsTokenName:    "YearRing Points",
  pointsTokenSymbol:  "YRPTS",
  pointsTotalSupply:  20_000_000n * 10n ** 18n, // same as v2DemoConfig.rewardTotalSupply

  // Strategy
  //
  // reserveRatioBps — staged design (NOT a fixed guarantee):
  //
  //   3000 (30%)  Closed beta initial value — conservative safety buffer.
  //               Represents a *target* liquidity reserve, NOT a fixed redemption guarantee.
  //               30% means up to 70% of TVL may be deployed to strategy (Aave V3).
  //
  //   Adjustment path (requires multisig + observed real-user data):
  //     3000 → 2000  after stable redemption patterns + strategy exit validation
  //     2000 → 1500  after further TVL growth and Aave liquidity depth confirmed
  //     1500 → 1000  mature phase only; only if daily liquidity pool + fast-exit assets verified
  //
  //   NOT allowed:
  //     Direct drop to 1000 or below without real redemption records and exit rehearsal.
  //     Deploying 90%+ into low-liquidity assets while reserve sits at <10%.
  //
  //   Long-term target architecture (V3+):
  //     10% daily liquidity pool + fast-exit strategy assets + mid-term strategy sleeve
  //     NOT: one monolithic Aave position at 90% deployment.
  //
  reserveRatioBps:    3000,     // 30% target reserve — closed beta initial value
  investCap:          0n,       // unlimited (budget enforced by reserveRatioBps)
  minIdle:            0n,

  // Governance Signal (non-binding during closed beta)
  votingThreshold:    100n * 10n ** 18n, // 100 YRPTS minimum to vote
  votingPeriod:       7n * 86400n,       // 7-day voting window

  useDeployerAsAdmin: false,
};

// ---------------------------------------------------------------------------
// Local / Hardhat Fork — Closed Beta
// ---------------------------------------------------------------------------
export const closedBetaLocal: ClosedBetaConfig = {
  usdc:             "",   // deployed at runtime (MockUSDC)
  aavePool:         "",   // not used in local (DummyStrategy)
  aUsdc:            "",
  aaveReferralCode: 0,

  vaultName:          "YearRing Core Vault",
  vaultSymbol:        "yrCORE",
  mgmtFeeBpsPerMonth: 4,

  pointsTokenName:    "YearRing Points",
  pointsTokenSymbol:  "YRPTS",
  pointsTotalSupply:  20_000_000n * 10n ** 18n,

  reserveRatioBps:    3000,
  investCap:          0n,
  minIdle:            0n,

  votingThreshold:    100n * 10n ** 18n,
  votingPeriod:       7n * 86400n,

  useDeployerAsAdmin: true,
};

// ---------------------------------------------------------------------------
// Config selector
// ---------------------------------------------------------------------------
export function getClosedBetaConfig(networkName: string): ClosedBetaConfig {
  switch (networkName) {
    case "base":
      return closedBetaMainnet;
    case "hardhat":
    case "localhost":
      return closedBetaLocal;
    default:
      throw new Error(`No closed beta config for network: ${networkName}`);
  }
}
