# YearRing Fund Protocol

YearRing Fund Protocol is a Base-native, non-custodial long-term capital container. Users deposit USDC into an ERC-4626 Core Vault and receive **yrUSDC** vault shares. Locked yrUSDC positions record non-transferable internal Points and rebate eligibility across three commitment tiers (Bronze / Silver / Gold). Investable liquidity is routed through strategy managers under transparent on-chain accounting — currently Aave V3 USDC supply on Base.

Exit rights are a first-class protocol constraint. Normal redeem and Emergency Exit paths are always structurally preserved.

---

## Official Links

| | |
|---|---|
| Website | https://yearringfund.com |
| App | https://app.yearringfund.com |
| Docs | https://docs.yearringfund.com |
| GitHub | https://github.com/yearring-fund |
| Contact | hello@yearringfund.com |

---

## Current Base Mainnet Deployment — V2.1 Beta

Deployed on Base mainnet (Chain ID 8453). Source: `deployments/v2_1_base.json`.

| Contract | Address |
|---|---|
| YearRingCoreVaultV21 (yrUSDC) | [`0x53e45AcB32aCD80F3d215a007fD8FE87390746F8`](https://basescan.org/address/0x53e45AcB32aCD80F3d215a007fD8FE87390746F8) |
| CoreStrategyManagerV21 | [`0xc615c0c37524e9997622337cC973aC24C40e0548`](https://basescan.org/address/0xc615c0c37524e9997622337cC973aC24C40e0548) |
| AccessStrategyManagerV21 | [`0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0`](https://basescan.org/address/0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0) |
| AaveUSDCStrategyV21 (CoreSM) | [`0x58F265139E3693651B4E30961a1e535b413BBa2C`](https://basescan.org/address/0x58F265139E3693651B4E30961a1e535b413BBa2C) |
| AaveUSDCStrategyV21 (ASM) | [`0xc61D5966F2802aff6c6377C21bBdE923Daf879e0`](https://basescan.org/address/0xc61D5966F2802aff6c6377C21bBdE923Daf879e0) |
| LockManagerV21 | [`0xCDc679865b5161C7b7cf75584551F5B57828d59F`](https://basescan.org/address/0xCDc679865b5161C7b7cf75584551F5B57828d59F) |
| RebateManagerV21 | [`0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD`](https://basescan.org/address/0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD) |
| EligibilityModuleV21 | [`0x7ee0ED49A008e6feA8d196492699a87f878a2022`](https://basescan.org/address/0x7ee0ED49A008e6feA8d196492699a87f878a2022) |
| PortfolioLensV21 | [`0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a`](https://basescan.org/address/0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a) |
| TreasuryV21 | [`0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2`](https://basescan.org/address/0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2) |
| PointsLedgerV01 | [`0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe`](https://basescan.org/address/0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe) |

---

## Legacy / Deprecated Deployments

The following addresses were the V01/V02 Closed Beta deployment. They are **no longer active** and are listed here for historical reference only. Do not use these addresses.

| Contract | Address | Status |
|---|---|---|
| FundVaultV01 | [`0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54`](https://basescan.org/address/0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54) | Deprecated |
| StrategyManagerV01 | [`0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54`](https://basescan.org/address/0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54) | Deprecated |
| AaveV3StrategyV01 | [`0x621CC4189946128eF2d584F69bb994C84FcA612D`](https://basescan.org/address/0x621CC4189946128eF2d584F69bb994C84FcA612D) | Deprecated |
| LockRewardManagerV02 | [`0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a`](https://basescan.org/address/0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a) | Deprecated |
| LockLedgerV02 | [`0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF`](https://basescan.org/address/0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF) | Deprecated |
| ProtocolTimelockV02 | [`0x054Cb2c32D6062B291420584dE2e5952C372cDD6`](https://basescan.org/address/0x054Cb2c32D6062B291420584dE2e5952C372cDD6) | Deprecated |

---

## Security Status

The V2.1 beta deployment is operated under controlled admin roles during the allowlisted testing phase. All admin, keeper, and emergency roles are held by a monitored operator address.

- Emergency controls are limited to pause and Emergency Exit mode — cannot redirect or seize user funds
- Vault and strategy layers are separated with on-chain reserve enforcement (MIN 5% / TARGET 10% / MAX 15%)
- Multisig and timelock governance are a planned hardening step and will be implemented before any allowlist expansion
- External audit is pending before broader public expansion

> **Note:** Timelock governance should only be described as active after the deployment record and on-chain role ownership confirm it. The V2.1 beta does not currently use a timelock contract.

See [SECURITY.md](./SECURITY.md) for responsible disclosure and [docs/CURRENT_SECURITY_POSTURE.md](./docs/CURRENT_SECURITY_POSTURE.md) for full governance state.

---

## Architecture

### Vault Layer

Responsible for all user-facing fund accounting and share ownership.

- ERC-4626 share accounting (`yrUSDC`)
- On-chain reserve band: MIN 5% / TARGET 10% / MAX 15% — enforced by auto-rebalance
- Allowlist / access control (`allowlistEnabled` + `allowlist(address)`)
- Emergency Mode (`systemMode=2`): freezes deposits and withdrawals
- Management fee accrued in CoreStrategyManagerV21 (not USDC deduction; dilutes PPS)
- NAV / PPS derived from `totalAssets()`, never set directly

Main contract: `YearRingCoreVaultV21`

### Strategy Execution Layer

Responsible for deploying vault capital into approved external protocols.

- Receiving capital from the vault via `depositFromVault`
- Investing into approved external protocols (currently Aave V3 USDC supply on Base)
- Divesting and returning assets to the vault
- Management fee accrual at 50 bps/year (`FEE_BPS`)

Main contracts: `CoreStrategyManagerV21`, `AaveUSDCStrategyV21`

### Commitment / Reward Layer

Coordinates long-term capital behavior without modifying vault accounting.

- Lock-based incentives (30–365+ days, three tiers: Bronze / Silver / Gold)
- Non-transferable internal Points issued at lock time; deducted on early exit
- Management fee rebate in USDC (linear accrual, claimed via RebateManagerV21)
- Beneficiary designation and claim logic (planned for future upgrade)

Main contracts: `LockManagerV21`, `PointsLedgerV01`, `RebateManagerV21`

### Read / Aggregation Layer

- `PortfolioLensV21`: read-only view aggregator for vault state, lock views, pending rewards, and manager info
- `EligibilityModuleV21`: checks lock eligibility for AccessStrategyManager entry

---

## Current Status

| Item | Status |
|---|---|
| Core Vault (YearRingCoreVaultV21 + CoreStrategyManagerV21 + AaveUSDCStrategyV21) | Deployed on Base Mainnet |
| Commitment layer (LockManagerV21 + PointsLedgerV01 + RebateManagerV21) | Deployed on Base Mainnet |
| Portfolio lens (PortfolioLensV21 + EligibilityModuleV21) | Deployed on Base Mainnet |
| Governance (Timelock + multisig) | Planned — not yet in V2.1 beta |
| Access | Invited allowlist — internal validation phase |
| External audit | Pending |

---

## Documentation

| Resource | Description |
|---|---|
| `docs/` | Protocol documentation and architecture notes |
| `docs/CURRENT_SECURITY_POSTURE.md` | Current governance and security state |
| `deployments/v2_1_base.json` | V2.1 Base Mainnet deployment addresses |
| `SECURITY.md` | Security policy and responsible disclosure |
| `evidence/` | Mainnet validation records and execution evidence |

External documentation: https://docs.yearringfund.com

---

## Repository Structure

```
contracts/          Solidity protocol contracts (v2_1/ for current; legacy V01/V02 in root)
deployments/        Deployment JSON files per network and version
docs/               Protocol documentation and architecture notes
evidence/           Mainnet validation records and execution evidence
org-setup/          Frontend application (yearring-app)
scripts/            Hardhat scripts and operational utilities
test/               Contract tests (test/v2_1/ for V2.1 suite)
SECURITY.md         Security policy and disclosure information
```

---

## Development

**Tech stack:** Solidity `^0.8.20`, Hardhat + TypeScript, OpenZeppelin 4.9.x, Vite + React + wagmi v3

```bash
npm install
npx hardhat test
npx hardhat compile
```

---

## Disclaimer

YearRing Fund Protocol is experimental software. This repository and its contents are provided for transparency and technical review. Nothing here constitutes financial advice, investment advice, or a public solicitation.

Users should understand smart contract, DeFi, liquidity, strategy, and regulatory risks before interacting with the protocol. No yield is guaranteed. Strategy returns depend on Aave V3 supply rates, which may vary or reach zero.

---

## License

See [LICENSE](./LICENSE).
