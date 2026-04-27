# YearRing Fund Protocol

YearRing is a non-custodial capital container for long-term on-chain users, starting with conservative DeFi yield and expanding toward RWA distribution.

The protocol accepts USDC deposits, issues ERC-4626 shares (`fbUSDC`), and deploys capital into approved yield strategies — currently Aave V3 USDC supply. On top of the vault sits a commitment layer: participants can lock shares for 30–365 days across three tiers (Bronze / Silver / Gold) to earn reward tokens (RWT) and a management fee rebate. Exit rights are a first-class protocol constraint — normal redeem and emergency claim paths are always structurally preserved.

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

## Mainnet Deployment

Deployed on Base mainnet (Chain ID 8453).

| Contract | Address |
|---|---|
| FundVaultV01 | [`0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54`](https://basescan.org/address/0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54) |
| StrategyManagerV01 | [`0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54`](https://basescan.org/address/0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54) |
| AaveV3StrategyV01 | [`0x621CC4189946128eF2d584F69bb994C84FcA612D`](https://basescan.org/address/0x621CC4189946128eF2d584F69bb994C84FcA612D) |
| LockRewardManagerV02 | [`0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a`](https://basescan.org/address/0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a) |
| LockLedgerV02 | [`0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF`](https://basescan.org/address/0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF) |
| ProtocolTimelockV02 | [`0x054Cb2c32D6062B291420584dE2e5952C372cDD6`](https://basescan.org/address/0x054Cb2c32D6062B291420584dE2e5952C372cDD6) |

Full address list with all contracts: [ADDRESSES.md](./ADDRESSES.md)

---

## Security Status

The protocol is currently unaudited and should be treated as an early-stage mainnet validation. User-facing access is limited while safety boundaries are being finalized.

- Admin roles are governed by `ProtocolTimelockV02` (24-hour delay on all non-emergency changes)
- Emergency controls are limited to pause and emergency exit — cannot redirect funds
- Vault and strategy layers are separated with on-chain exposure caps
- External audit is pending before broader public expansion

See [SECURITY.md](./SECURITY.md) for responsible disclosure and [docs/CURRENT_SECURITY_POSTURE.md](./docs/CURRENT_SECURITY_POSTURE.md) for full governance state.

---

## Application Materials

| Resource | Description |
|---|---|
| [one-pager.md](./application/one-pager.md) | Protocol overview: problem, solution, differentiators |
| [pitch-framework.md](./application/pitch-framework.md) | Conviction Markets narrative and OV thesis alignment |
| [application-qa.md](./application/application-qa.md) | Accelerator application Q&A |
| [YearRing_Fund_Protocol_Deck.pdf](./application/YearRing_Fund_Protocol_Deck.pdf) | Investor deck (PDF) |

Mainnet validation evidence: [evidence/](./evidence/)

---

## Architecture

### Vault Layer

Responsible for all user-facing fund accounting and share ownership.

- ERC-4626 share accounting (`fbUSDC`)
- Reserve management (hard cap: max 70% deployable to strategies)
- Allowlist / access control
- Emergency mode and exit round logic
- Management fee (share dilution, not USDC deduction)
- NAV / PPS derived from `totalAssets()`, never set directly

Main contract: `FundVaultV01`

### Strategy Execution Layer

Responsible for deploying vault capital into approved external protocols.

- Receiving capital from the vault
- Investing into approved external protocols (currently Aave V3)
- Divesting and returning assets to the vault
- Enforcing strategy caps and execution limits

Main contracts: `StrategyManagerV01`, `AaveV3StrategyV01`

### Commitment / Reward Layer

Coordinates long-term capital behavior without modifying vault accounting.

- Lock-based incentives (30–365 days, three tiers)
- RWT issuance at lock time; return required on early exit
- Management fee rebate (linear accrual, settled in fbUSDC from treasury)
- Beneficiary designation and claim logic

Main contracts: `RewardToken`, `LockRewardManagerV02`, `LockLedgerV02`

---

## Current Status

| Item | Status |
|---|---|
| Capital layer (FundVaultV01 + StrategyManagerV01 + AaveV3StrategyV01) | Deployed on Base mainnet |
| Commitment layer (LockRewardManagerV02 + LockLedgerV02) | Deployed on Base mainnet |
| Governance (GovernanceSignalV02 + ProtocolTimelockV02) | Deployed on Base mainnet |
| Admin role migration to Timelock | Complete |
| Access | Invited whitelist — internal validation phase |
| External audit | Pending |

---

## Documentation

| Resource | Description |
|---|---|
| `docs/` | Protocol documentation and architecture notes |
| `docs/CURRENT_SECURITY_POSTURE.md` | Current governance and security state |
| `ADDRESSES.md` | Full Base mainnet contract address list |
| `SECURITY.md` | Security policy and responsible disclosure |
| `evidence/` | Mainnet validation records and execution evidence |

External documentation: https://docs.yearringfund.com

---

## Repository Structure

```
application/        Investor and accelerator application materials (deck, narrative, Q&A)
contracts/          Solidity protocol contracts
docs/               Protocol documentation and architecture notes
evidence/           Mainnet validation records and execution evidence
frontend/           Frontend application
scripts/            Hardhat scripts and operational utilities
test/               Contract tests
ADDRESSES.md        Public Base mainnet contract addresses
SECURITY.md         Security policy and disclosure information
```

---

## Development

**Tech stack:** Solidity `^0.8.20`, Hardhat + TypeScript, OpenZeppelin v4, Vite + React + wagmi v2

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
