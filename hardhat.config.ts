import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Primary deployer key (admin / guardian / treasury on testnet demo)
// Fallback is a valid non-zero dummy (all-zeros is rejected by the curve library)
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "a".repeat(64);

// Optional per-persona keys for testnet seed.
// Fallback to sequential dummy keys so Hardhat never throws on missing values.
const ALICE_KEY = process.env.ALICE_PRIVATE_KEY || "0x" + "1".repeat(64);
const BOB_KEY   = process.env.BOB_PRIVATE_KEY   || "0x" + "2".repeat(64);
const CAROL_KEY = process.env.CAROL_PRIVATE_KEY  || "0x" + "3".repeat(64);

const TREASURY_KEY = process.env.TREASURY_PRIVATE_KEY || "0x" + "4".repeat(64);

const TESTNET_ACCOUNTS = [PRIVATE_KEY, ALICE_KEY, BOB_KEY, CAROL_KEY, TREASURY_KEY];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      // Use the running node's own accounts (Hardhat default signers)
      accounts: "remote",
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: TESTNET_ACCOUNTS,
      chainId: 84532,
    },
    base: {
      // BASE_MAINNET_RPC_URL must be set in .env (QuickNode / Alchemy Base Mainnet endpoint)
      // Do NOT fall back to https://mainnet.base.org — public node is unstable for production use
      url: process.env.BASE_MAINNET_RPC_URL || (() => { throw new Error("BASE_MAINNET_RPC_URL is not set. Add your QuickNode/Alchemy Base Mainnet endpoint to .env"); })(),
      accounts: TESTNET_ACCOUNTS,
      chainId: 8453,
    },
  },

  etherscan: {
    // Etherscan V2: single API key covers all networks
    apiKey: process.env.BASESCAN_API_KEY || "",
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL:      "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL:  "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL:      "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL:  "https://basescan.org",
        },
      },
    ],
  },

  sourcify: {
    enabled: true,
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
