# YearRing Fund Protocol — One Pager

---

## What It Is

YearRing Fund Protocol is a non-custodial capital container for long-term on-chain users, starting with conservative DeFi yield and expanding toward RWA distribution.

The protocol is deployed on Base mainnet. It accepts USDC deposits, issues ERC-4626 shares (`fbUSDC`), and deploys capital into approved yield strategies — currently Aave V3 USDC supply. On top of the vault sits a commitment layer that coordinates long-term capital behavior without modifying vault accounting.

---

## The System

**FundVaultV01 — Capital Layer**

ERC-4626 vault on Base. USDC deposits are represented as `fbUSDC` shares via transparent pro-rata vault accounting. The vault can reflect variable Aave V3 USDC supply yield when the strategy position generates yield. Yield is variable and not guaranteed. Core vault accounting does not depend on any token price.

**LockRewardManagerV02 — Commitment Layer**

Participants lock vault shares into tiered positions (Bronze / Silver / Gold) for 30–365 days. Commitment depth is verified entirely on-chain. Reward tokens (RWT) distribute proportionally to lock duration and tier. A dual-signature forced-exit protocol ensures any locked position can be exited under defined conditions, with an on-chain audit trail.

---

## Why the Separation Matters

Most commitment protocols collapse when token price falls because yield and token are coupled. YearRing separates them by design: the vault strategy yield is the economic floor; RWT coordinates long-term alignment on top of that floor.

RWT is a coordination token. It is not sold to fund the protocol and is not included in vault NAV.

---

## Current State

| Item | Status |
|---|---|
| Base mainnet deployment | Live |
| Test coverage | 611 tests passing (unit, integration, Aave V3 fork) |
| Strategy integration | Aave V3 USDC supply |
| Step 3 — Internal mainnet readiness | Complete |
| Step 4 — Controlled external-user pilot | In preparation |
| External audit | Pending |

The protocol is currently in internal validation / invited whitelist testing. No broad public user launch has started. External audit is pending. The current deployment should be treated as an early-stage mainnet validation, not a fully audited public release.

---

## What We're Looking For

- **Capital** to fund Step 4 onboarding and V3 development
- **Network** to reach DeFi protocols, RWA funds, and DAO treasuries
- **Partners** who understand long-term capital coordination as a protocol primitive

---

**YearRing Fund Protocol**
hello@yearringfund.com
https://yearringfund.com
https://docs.yearringfund.com
https://github.com/yearring-fund
