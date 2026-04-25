# YearRing Fund Protocol

YearRing Fund Protocol is an on-chain fund and long-term capital coordination protocol designed for transparent, rules-based asset management on Base.

The protocol accepts USDC deposits, issues ERC-4626 shares (`fbUSDC`), and deploys capital into approved yield strategies — currently Aave V3 USDC supply. On top of the vault sits a commitment layer: users can voluntarily lock shares for 30–365 days across three tiers (Bronze / Silver / Gold) to earn reward tokens (RWT) and a management fee rebate. Early exit returns full principal on return of issued RWT.

---

## Core Idea

YearRing is not a short-term yield product.

It is designed as a long-term on-chain capital management container:

- transparent fund accounting (ERC-4626, on-chain NAV)
- separated vault and strategy execution layers
- controlled strategy deployment with hard caps
- non-negotiable exit rights (redeem path always available)
- commitment layer that coordinates long-term capital behavior without modifying vault accounting
- future expansion toward compliant RWA strategies

---

## Current Status

| Item | Status |
|---|---|
| Capital layer (FundVaultV01 + StrategyManagerV01 + AaveV3StrategyV01) | Deployed on Base mainnet |
| Commitment layer (LockRewardManagerV02 + LockLedgerV02) | Deployed on Base mainnet |
| Governance (GovernanceSignalV02 + ProtocolTimelockV02) | Deployed on Base mainnet |
| Access | Invited whitelist — internal validation phase |
| External audit | Pending |

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

## Mainnet Deployment

Deployed on Base mainnet (Chain ID 8453).

See [ADDRESSES.md](./ADDRESSES.md) for full contract address list with BaseScan links.

---

## Documentation

| Resource | Link |
|---|---|
| Protocol Docs | https://docs.yearringfund.com |
| Whitepaper | https://docs.yearringfund.com/whitepaper |
| Architecture | https://docs.yearringfund.com/architecture |
| Risk & Audit Status | https://docs.yearringfund.com/risk-and-audit |
| App | https://app.yearringfund.com |
| Website | https://yearringfund.com |

---

## Audit Status

**External audit: Pending**

The protocol has not yet completed a third-party external audit. It is currently deployed for controlled internal validation with an invited whitelist.

Security model includes:

- role-based access control (DEFAULT_ADMIN_ROLE, EMERGENCY_ROLE, PROPOSER_ROLE)
- 24-hour ProtocolTimelockV02 for all admin parameter changes
- EMERGENCY_ROLE limited to pause and emergency exit only — cannot redirect funds or modify parameters
- separated vault and strategy manager (no direct access between layers)
- reserve and strategy exposure limits (on-chain constants, not configurable)
- mainnet transaction traceability through BaseScan

See [SECURITY.md](./SECURITY.md) for responsible disclosure policy.

A formal external audit is planned before broader public user expansion.

---

## Repository Structure

```
contracts/          Solidity source — vault, strategy, lock, governance
scripts/            Operational and deployment scripts (TypeScript / Hardhat)
test/               Test suite (Hardhat + Chai)
docs/               Internal protocol documentation and operational runbooks
deployments/        Deployed contract address records by network
frontend/           Legacy frontend (V01 demo build)
org-setup/          Org-level assets (yearring-app, yearring-landing, yearring-docs, yearring-protocol)
application/        Accelerator and investor application materials
evidence/           Mainnet operational evidence (snapshots, reports)
```

---

## Development

**Tech stack:** Solidity `^0.8.20`, Hardhat + TypeScript, OpenZeppelin v4, Vite + React + wagmi v2

**Install dependencies:**

```bash
npm install
```

**Run full test suite:**

```bash
npx hardhat test
```

**Run a specific test file:**

```bash
npx hardhat test test/Step3_LiveRun.test.ts
```

**Compile contracts:**

```bash
npx hardhat compile
```

---

## Disclaimer

YearRing Fund Protocol is experimental software.

This repository and its contents are provided for transparency and technical review. Nothing here constitutes financial advice, investment advice, or a public solicitation.

Users should understand smart contract, DeFi, liquidity, strategy, and regulatory risks before interacting with the protocol. No yield is guaranteed. Strategy returns depend on Aave V3 supply rates, which may vary or reach zero.

---

## License

See [LICENSE](./LICENSE).
