/**
 * config.js — Contract addresses and ABIs for the demo frontend
 *
 * After deployment, update ADDRESSES with values from deployments/baseSepolia.json.
 * Chain ID 84532 = Base Sepolia testnet.
 */

window.DEMO_CONFIG = {

  CHAIN_ID: 84532,
  CHAIN_NAME: "Base Sepolia",
  RPC_URL: "https://sepolia.base.org",

  // ── Fill in after running the deploy + seed scripts ───────────────────────
  // Copy from: deployments/baseSepolia.json → contracts
  ADDRESSES: {
    USDC:                  "",   // MockUSDC
    FundVaultV01:          "",
    StrategyManagerV01:    "",
    RewardToken:           "",
    LockLedgerV02:         "",
    LockBenefitV02:        "",
    LockRewardManagerV02:  "",
    BeneficiaryModuleV02:  "",
    UserStateEngineV02:    "",
    MetricsLayerV02:       "",
  },

  // ── ABIs (human-readable format) ──────────────────────────────────────────

  ABI: {

    USDC: [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ],

    FundVaultV01: [
      "function deposit(uint256 assets, address receiver) returns (uint256)",
      "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
      "function balanceOf(address account) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function totalAssets() view returns (uint256)",
      "function totalSupply() view returns (uint256)",
      "function pricePerShare() view returns (uint256)",
      "function mgmtFeeBpsPerMonth() view returns (uint256)",
      "function previewDeposit(uint256 assets) view returns (uint256)",
      "function previewRedeem(uint256 shares) view returns (uint256)",
      "function asset() view returns (address)",
    ],

    RewardToken: [
      "function balanceOf(address) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ],

    LockLedgerV02: [
      "function getLock(uint256 lockId) view returns (tuple(address owner, uint256 shares, uint64 lockedAt, uint64 unlockAt, bool unlocked, bool earlyExited))",
      "function userLockIds(address owner) view returns (uint256[])",
      "function activeLockCount(address owner) view returns (uint256)",
      "function userLockedSharesOf(address owner) view returns (uint256)",
      "function nextLockId() view returns (uint256)",
      "function unlock(uint256 lockId)",
    ],

    LockBenefitV02: [
      "function tierOf(uint256 lockId) view returns (uint8)",
      "function feeDiscountBpsOf(uint256 lockId) view returns (uint256)",
      "function feeDiscountFromDuration(uint64 duration) pure returns (uint256)",
      "function multiplierOf(uint256 lockId) view returns (uint256)",
      "function tierFromDuration(uint64 duration) pure returns (uint8)",
    ],

    LockRewardManagerV02: [
      "function lockWithReward(uint256 shares, uint64 durationSeconds)",
      "function claimRebate(uint256 lockId)",
      "function earlyExitWithReturn(uint256 lockId)",
      "function previewRebate(uint256 lockId) view returns (uint256)",
      "function issuedRewardTokens(uint256 lockId) view returns (uint256)",
      "function checkEarlyExit(uint256 lockId) view returns (bool canExit, uint256 rwtToReturn)",
      "event LockedWithReward(uint256 indexed lockId, address indexed user, uint256 shares, uint256 duration, uint256 rwt)",
    ],

    BeneficiaryModuleV02: [
      "function setBeneficiary(address beneficiary)",
      "function updateBeneficiary(address newBeneficiary)",
      "function revokeBeneficiary()",
      "function beneficiaryOf(address user) view returns (address)",
      "function isInactive(address user) view returns (bool)",
      "function claimed(address user) view returns (bool)",
      "function executeClaim(address inactive, uint256[] calldata lockIds)",
      "function heartbeat()",
      "function lastActiveAt(address user) view returns (uint256)",
    ],

    UserStateEngineV02: [
      "function lockStateOf(uint256 lockId) view returns (uint8)",
      "function userStateOf(address user) view returns (uint8)",
    ],

    MetricsLayerV02: [
      "function snapshot() view returns (tuple(uint256 totalTVL, uint256 totalLockedShares, uint256 lockedRatioBps, uint256 totalLocksEver))",
    ],
  },

  // ── Display labels ────────────────────────────────────────────────────────

  TIER_LABEL:  ["—", "Bronze (30d)", "Silver (90d)", "Gold (180d)"],
  TIER_DAYS:   [0, 30, 90, 180],
  STATE_LABEL: ["Normal", "Locked (Accumulating)", "Matured", "Early Exited"],
};
