// ---------------------------------------------------------------------------
// Deployment configuration per network
// ---------------------------------------------------------------------------
import { ethers } from "ethers";

export interface NetworkConfig {
  // Token addresses
  usdc: string;

  // Aave V3 addresses (only needed on mainnet/testnet with real Aave)
  aavePool: string;
  aUsdc: string;
  aaveReferralCode: number;

  // Protocol parameters
  reserveRatioBps: number;   // e.g. 3000 = 30% reserve
  mgmtFeeBpsPerMonth: number; // e.g. 9 ≈ 1%/year
  investCap: bigint;          // 0 = unlimited
  minIdle: bigint;            // 0 = no floor

  // Reward distribution
  rewardTokenName: string;
  rewardTokenSymbol: string;
  rewardPremint: bigint;   // total RWD supply
  epochCap: bigint;        // max RWD per epoch
  maxEpochCap: bigint;     // immutable ceiling

  // Role addresses (set in .env for testnet/mainnet)
  useDeployerAsAdmin: boolean; // true = deployer is admin/guardian/treasury (local only)
}

// ---------------------------------------------------------------------------
// Base Mainnet
// ---------------------------------------------------------------------------
export const baseMainnet: NetworkConfig = {
  usdc:                 "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  aavePool:             "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  aUsdc:                "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
  aaveReferralCode:     0,

  reserveRatioBps:      3000,                        // 30% reserve
  mgmtFeeBpsPerMonth:   9,                           // ~1% / year (9 bps/month)
  investCap:            0n,                          // unlimited
  minIdle:              0n,

  rewardTokenName:      "FinancialBase Reward",
  rewardTokenSymbol:    "FBR",
  rewardPremint:        ethers.parseEther("1000000"),
  epochCap:             ethers.parseEther("10000"),
  maxEpochCap:          ethers.parseEther("100000"),

  useDeployerAsAdmin:   false,
};

// ---------------------------------------------------------------------------
// Base Sepolia (testnet)
// IMPORTANT: Verify Aave V3 addresses on Base Sepolia before deploying
// ---------------------------------------------------------------------------
export const baseSepolia: NetworkConfig = {
  usdc:                 "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Circle USDC on Base Sepolia
  aavePool:             "0x07eA79F68B2B3df564D0A34F8e19791234D9C2E0", // ⚠️ verify before use
  aUsdc:                "0x96e32dE4B1d1617B8c2AE13a88B9cC287239b13f", // ⚠️ verify before use
  aaveReferralCode:     0,

  reserveRatioBps:      3000,
  mgmtFeeBpsPerMonth:   9,                           // ~1% / year (9 bps/month)
  investCap:            0n,
  minIdle:              0n,

  rewardTokenName:      "FinancialBase Reward",
  rewardTokenSymbol:    "FBR",
  rewardPremint:        ethers.parseEther("1000000"),
  epochCap:             ethers.parseEther("10000"),
  maxEpochCap:          ethers.parseEther("100000"),

  useDeployerAsAdmin:   true,
};

// ---------------------------------------------------------------------------
// Local / Hardhat (uses MockUSDC + DummyStrategy instead of Aave)
// ---------------------------------------------------------------------------
export const local: NetworkConfig = {
  usdc:                 "",   // deployed at runtime
  aavePool:             "",
  aUsdc:                "",
  aaveReferralCode:     0,

  reserveRatioBps:      3000,
  mgmtFeeBpsPerMonth:   9,                           // ~1% / year (9 bps/month)
  investCap:            0n,
  minIdle:              0n,

  rewardTokenName:      "FinancialBase Reward",
  rewardTokenSymbol:    "FBR",
  rewardPremint:        ethers.parseEther("1000000"),
  epochCap:             ethers.parseEther("10000"),
  maxEpochCap:          ethers.parseEther("100000"),

  useDeployerAsAdmin:   true,
};

// ---------------------------------------------------------------------------
// V2 Demo Config
// ---------------------------------------------------------------------------

export interface V2DemoConfig {
  // Demo deposit amounts (USDC, 6 decimals)
  aliceDeposit: bigint;   // Scene B — long-term user
  bobDeposit:   bigint;   // Scene A observer / beneficiary recipient
  carolDeposit: bigint;   // Scene C — beneficiary origin

  // Lock durations (seconds)
  goldDuration:   bigint; // 180 days — alice (Scene B)
  silverDuration: bigint; // 90 days  — carol (Scene C)

  // Governance signal params
  votingThreshold: bigint; // minimum RWT to create a proposal
  votingPeriod:    bigint; // voting window in seconds

  // RewardToken
  rewardTotalSupply: bigint;
}

export const v2DemoConfig: V2DemoConfig = {
  aliceDeposit:  1_000_000_000n,   // 1000 USDC (6 decimals)
  bobDeposit:      200_000_000n,   // 200 USDC
  carolDeposit:    500_000_000n,   // 500 USDC

  goldDuration:   180n * 86400n,   // 180 days in seconds
  silverDuration:  90n * 86400n,   // 90 days in seconds

  votingThreshold: 100n * 10n**18n, // 100 RWT (18 decimals)
  votingPeriod:    7n * 86400n,     // 7-day voting window

  rewardTotalSupply: 20_000_000n * 10n**18n, // 20,000,000 RWT
};

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

export function getConfig(networkName: string): NetworkConfig {
  switch (networkName) {
    case "base":         return baseMainnet;
    case "baseSepolia":  return baseSepolia;
    case "hardhat":
    case "localhost":    return local;
    default:
      throw new Error(`No config for network: ${networkName}`);
  }
}
