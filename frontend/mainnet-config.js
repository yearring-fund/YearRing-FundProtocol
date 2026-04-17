/**
 * mainnet-config.js — Base Mainnet read-only configuration
 *
 * Source of truth: deployments/base.json
 * Chain: Base Mainnet (chainId 8453)
 *
 * RPC: Set MAINNET_RPC_URL below to your QuickNode/Alchemy Base Mainnet HTTPS endpoint.
 * This page is for internal / allowlist use only — not public.
 */

window.MAINNET_CONFIG = {

  CHAIN_ID:   8453,
  CHAIN_NAME: "Base Mainnet",

  // QuickNode Base Mainnet HTTPS endpoint
  // Replace with your actual endpoint from deployments/.env
  RPC_URL: "https://sly-practical-sheet.base-mainnet.quiknode.pro/74522be9c852bdd965c78e170b07f15dbf2cf167/",

  // ── Contract addresses (source: deployments/base.json) ────────────────────
  ADDRESSES: {
    USDC:               "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    FundVaultV01:       "0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54",
    StrategyManagerV01: "0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54",
    AaveV3StrategyV01:  "0x621CC4189946128eF2d584F69bb994C84FcA612D",
  },

  // ── Minimal read-only ABIs ─────────────────────────────────────────────────
  ABI: {
    FundVaultV01: [
      "function totalAssets() view returns (uint256)",
      "function totalSupply() view returns (uint256)",
      "function pricePerShare() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function convertToAssets(uint256) view returns (uint256)",
      "function systemMode() view returns (uint8)",
      "function depositsPaused() view returns (bool)",
      "function redeemsPaused() view returns (bool)",
      "function isAllowed(address) view returns (bool)",
    ],
    StrategyManagerV01: [
      "function totalManagedAssets() view returns (uint256)",
      "function investCap() view returns (uint256)",
      "function paused() view returns (bool)",
    ],
    AaveV3StrategyV01: [
      "function totalUnderlying() view returns (uint256)",
    ],
    USDC: [
      "function balanceOf(address) view returns (uint256)",
    ],
  },

  // ── Protocol metadata ──────────────────────────────────────────────────────
  PROTOCOL_NAME: "YearRing-FundProtocol",
  ASSET_SYMBOL:  "USDC",
  SHARE_SYMBOL:  "fbUSDC",
  ASSET_DECIMALS: 6,
  SHARE_DECIMALS: 18,
};
