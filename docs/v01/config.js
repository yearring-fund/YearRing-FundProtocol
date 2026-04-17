/**
 * config.js — Base Mainnet configuration (v01)
 * Chain: Base Mainnet (chainId 8453)
 */

window.MAINNET_CONFIG = {

  CHAIN_ID:   8453,
  CHAIN_NAME: "Base Mainnet",

  RPC_URL: "https://sly-practical-sheet.base-mainnet.quiknode.pro/74522be9c852bdd965c78e170b07f15dbf2cf167/",

  ADDRESSES: {
    USDC:               "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    FundVaultV01:       "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54",
    StrategyManagerV01: "0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54",
    AaveV3StrategyV01:  "0x621CC4189946128eF2d584F69bb994C84FcA612D",
    ADMIN:              "0x087ea7F67d9282f0bdC43627b855F79789C6824C",
  },

  ABI: {
    FundVaultV01: [
      // read
      "function totalAssets() view returns (uint256)",
      "function totalSupply() view returns (uint256)",
      "function pricePerShare() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function convertToAssets(uint256) view returns (uint256)",
      "function previewDeposit(uint256) view returns (uint256)",
      "function previewRedeem(uint256) view returns (uint256)",
      "function systemMode() view returns (uint8)",
      "function depositsPaused() view returns (bool)",
      "function redeemsPaused() view returns (bool)",
      "function isAllowed(address) view returns (bool)",
      "function availableToInvest() view returns (uint256)",
      // write
      "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
      "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
      "function transferToStrategyManager(uint256 amount)",
    ],
    StrategyManagerV01: [
      "function totalManagedAssets() view returns (uint256)",
      "function idleUnderlying() view returns (uint256)",
      "function investCap() view returns (uint256)",
      "function paused() view returns (bool)",
      // write (admin only)
      "function invest(uint256 amount)",
      "function divest(uint256 amount) returns (uint256)",
      "function returnToVault(uint256 amount)",
    ],
    AaveV3StrategyV01: [
      "function totalUnderlying() view returns (uint256)",
    ],
    USDC: [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
  },

  PROTOCOL_NAME:  "YearRing-FundProtocol",
  ASSET_SYMBOL:   "USDC",
  SHARE_SYMBOL:   "fbUSDC",
  ASSET_DECIMALS: 6,
  SHARE_DECIMALS: 18,

  // Step3 script-layer limits (soft)
  TVL_CAP:      20_000,
  PER_USER_CAP: 2_000,
  DAILY_CAP:    5_000,
};
