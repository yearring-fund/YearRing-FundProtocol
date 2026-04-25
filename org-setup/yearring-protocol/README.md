# YearRing Fund Protocol

YearRing Fund Protocol is an on-chain fund and long-term capital coordination protocol designed to help users access transparent, rules-based, and compounding-oriented asset management strategies onchain.

The protocol starts with simple, auditable strategy containers such as Aave V3 and is designed to expand toward compliant RWA strategies over time.

## Core Idea

YearRing is not designed as a short-term yield chasing product.

It is designed as a long-term on-chain asset management container:

- transparent fund accounting;
- ERC4626-based share ownership;
- separated vault and strategy execution layers;
- controlled strategy deployment;
- emergency exit mechanisms;
- future expansion toward RWA strategies.

## Architecture

The current protocol architecture is separated into two main layers.

### 1. Fund / Vault Layer

The vault layer is responsible for user-facing fund accounting and share ownership.

Main responsibilities:

- user deposit and redeem flow;
- ERC4626 share accounting;
- reserve management;
- allowlist / access control;
- emergency mode and exit round logic;
- management fee accounting;
- NAV and share-value calculation.

Main contract:

- `FundVaultV01`

### 2. Strategy Execution Layer

The strategy layer is responsible for deploying vault capital into approved strategies.

Main responsibilities:

- receiving capital from the vault;
- investing into approved external protocols;
- divesting and returning assets to the vault;
- enforcing strategy caps and execution limits;
- isolating strategy execution risk from the vault layer.

Main contracts:

- `StrategyManagerV01`
- `AaveV3StrategyV01`

### 3. Commitment / Reward Layer

The protocol also includes a commitment and reward layer for long-term user alignment.

Main responsibilities:

- reward token distribution;
- lock-based incentives;
- management fee discount logic;
- long-term participation tracking.

Main contracts:

- `RewardToken`
- `LockRewardManagerV02`
- `LockLedgerV02`

## Mainnet Deployment

The protocol has been deployed and tested on Base mainnet.

See:

- [ADDRESSES.md](./ADDRESSES.md)

## Documentation

Protocol documentation:

- Whitepaper: https://docs.yearringfund.com/whitepaper
- Architecture Overview: https://docs.yearringfund.com/architecture
- Risk & Safety Notes: https://docs.yearringfund.com/risk

Official links:

- Website: https://yearringfund.com
- App: https://app.yearringfund.com
- Docs: https://docs.yearringfund.com
- GitHub: https://github.com/yearring-fund/YearRing-FundProtocol

## Audit Status

External audit status: **Pending**

The current contracts are deployed for controlled mainnet testing and early protocol validation.  
The protocol has not yet completed a third-party external audit.

Security model currently includes:

- role-based access control;
- separated vault and strategy manager;
- emergency pause controls;
- reserve and strategy exposure limits;
- controlled strategy deployment;
- mainnet transaction traceability through BaseScan.

A formal external audit is planned before broader public user expansion.

## Disclaimer

YearRing Fund Protocol is experimental software.

This repository and documentation are provided for transparency and technical review.  
Nothing here should be interpreted as financial advice, investment advice, or a public solicitation.

Users should understand smart contract, DeFi, liquidity, strategy, and regulatory risks before interacting with the protocol.

## License

See [LICENSE](./LICENSE).
