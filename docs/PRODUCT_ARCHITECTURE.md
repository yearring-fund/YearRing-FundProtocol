# FinancialBase — Product Architecture

> Each layer has a single responsibility. No layer modifies the accounting of the layer below it.

---

## Layer Map

```
┌─────────────────────────────────────────────────────────┐
│  BeneficiaryModuleV02     UserStateEngineV02             │  ← User-facing
│  MetricsLayerV02          LockPointsV02                  │
├─────────────────────────────────────────────────────────┤
│  LockRewardManagerV02     LockBenefitV02                 │  ← Commitment layer
│  LockLedgerV02                                           │
├─────────────────────────────────────────────────────────┤
│  FundVaultV01 (fbUSDC)    StrategyManagerV01             │  ← Capital layer
│  MerkleRewardsDistributorV01                             │
└─────────────────────────────────────────────────────────┘
```

---

## Design Principle: Long-Horizon Architecture, Not Lock-Up Mining

A 30–365 day lock, by itself, is medium-horizon. What makes FinancialBase a long-horizon asset system is that each layer in the stack above reinforces continuity rather than churn:

The protocol has two distinct dependency profiles:

- **Vault layer (token-independent):** The vault generates base yield through strategy performance. `pricePerShare` appreciates regardless of whether the reward token exists or what price it trades at. The vault accounting model does not depend on token issuance in any way.
- **Commitment layer (token-dependent):** Upfront commitment rewards are issued in RWT, and early exit requires returning them. This is core to how `LockRewardManagerV02` works in V2. Removing the token would require redesigning the commitment structure, not just toggling a flag.

The correct framing is not "the system works without the token." The correct framing is: **yield does not depend on the token; the current commitment mechanism does.**

This distinguishes FinancialBase from a lock-up liquidity mining scheme, where token emissions are the primary source of apparent yield. Here, the vault is the yield floor; the token coordinates commitment behavior on top of it. The beneficiary and continuity modules reinforce long-duration position preservation at the architecture level — independent of token mechanics.

---

## Core Vault

**Contract**: `FundVaultV01`

The vault is an ERC4626 fund with fully auditable asset accounting. Users deposit USDC and receive `fbUSDC` shares. Share price (`pricePerShare`) rises as the underlying strategy earns yield. Management fee accrues as new shares minted to treasury — it does not reduce user balances directly. `totalAssets` remains auditable even when capital is deployed to an external strategy.

Key design choices:
- `_decimalsOffset = 12`: fbUSDC has 18 decimals regardless of USDC's 6-decimal base, preventing share price inflation attacks on small deposits
- Deposits and redemptions are independently pausable
- No rebase, no elastic supply — standard ERC4626 accounting throughout

The vault does not know about locks, tiers, or points. It only sees standard ERC20 transfers.

---

## Lock Ledger

**Contract**: `LockLedgerV02`

The ledger receives fbUSDC shares from users and holds them in custody for a fixed duration. Each lock position records: owner, shares, lockedAt, unlockAt, and two terminal state flags (unlocked, earlyExited).

Lock durations map to three tiers (protocol-supported range: 30–365 days):
- **Bronze**: 30–89 days — entry commitment
- **Silver**: 90–179 days — medium-term commitment
- **Gold**: 180–365 days — long-term commitment

> **Current UI lock options**: 30 days (Bronze), 90 days (Silver), 180 days (Gold). These are the three fixed durations exposed in the frontend demo. The protocol accepts any duration within each tier's range.

The ledger does not issue rewards, calculate points, or know about tiers. It is a pure custody and time-lock contract. All user-facing operations go through `LockRewardManagerV02`.

Key invariant: under sanctioned protocol flows, `totalLockedShares` should match the ledger's fbUSDC balance.

---

## Tier & Weight Layer

**Contracts**: `LockBenefitV02`, `LockPointsV02`

`LockBenefitV02` classifies each lock position into a tier (Bronze / Silver / Gold) and exposes the tier multiplier and fee discount percentage. It reads from the ledger; it writes nothing.

`LockPointsV02` computes a time-weighted lock score for any active position as a pure view. This value is used internally as a weight basis and is reserved as the foundation for a future user-facing reward layer. It is not exposed as a user incentive in the current demo build.

The tier classification is the active layer in V2: it determines RWT issuance multipliers and fee rebate rates.

---

## Reward Manager

**Contract**: `LockRewardManagerV02`

The single entry point for all commitment operations. Coordinates across ledger, benefit, and vault in one call.

Two reward layers:
1. **Upfront reward tokens** — issued at lock time, amount = `lockedUSDCValue × durationDays × multiplierBps / REWARD_DENOMINATOR`, where `lockedUSDCValue` is evaluated at lock creation time. Longer locks and higher tiers receive disproportionately more tokens.
2. **Rebate (fbUSDC shares)** — accrues linearly over the lock duration as a partial refund of the management fee. Claimable at any time. Source is treasury's fbUSDC shares, not newly minted supply.

Early exit returns the full principal but requires returning all upfront reward tokens. This creates a real cost to breaking commitment without punishing the user's original capital.

Pre-flight views (`checkClaimRebate`, `checkEarlyExit`) allow frontend and scripts to verify treasury readiness before submitting a transaction.

---

## User States

**Contract**: `UserStateEngineV02`

A pure view aggregator. One call returns the complete state of a user across the protocol: vault balance, lock positions, tier, pending rebate, beneficiary assignment. No state written, no assets held.

Intended for frontend dashboards and off-chain scripts. Reduces frontend integration from multi-module reads to a single aggregator call.

---

## Beneficiary Module

**Contract**: `BeneficiaryModuleV02`

Users with locked positions can designate a beneficiary address. If the original owner becomes inactive before the lock matures, the beneficiary can step in and continue the position under the predefined claim path.

The beneficiary acts as a designated executor — they can claim and unlock the position at maturity, but they are not a full ownership replacement. Lock duration is never shortened: same `unlockAt`, same shares. Lock duration and shares are preserved; the position state carries over intact.

This module is designed for the reality that committed lock positions need a continuity guarantee within their duration window. It is not an escape hatch — lock duration is never shortened, and the claim path requires a predefined inactivity condition to be satisfied first.

---

## Strategy Bridge

**Contract**: `StrategyManagerV01`

The strategy layer sits between the vault and external yield sources (currently Aave V3 on Base). The vault does not call the strategy directly. The strategy manager controls how much capital is deployed, handles reporting, and returns assets to the vault on divest.

Strategy deployment is a separate governance action, not automatic. The vault's `totalAssets` remains auditable regardless of deployment state — capital deployed to Aave is still accounted for in the vault's balance sheet.

---

## Future Token Layer

The current reward token (`RewardToken`) is a fixed-supply ERC20 minted to treasury at deployment. In its current role it serves as an upfront commitment signal — issued on lock, returned on early exit.

The same token is designed to carry governance weight in a future on-chain governance module. Rather than launching a separate governance token, the reward token accumulates two roles:

1. **Commitment signal**: holding reward tokens indicates past capital commitment (you received them by locking, not by buying)
2. **Governance weight**: future voting or parameter proposals weighted by token balance

This design avoids the common failure mode of governance tokens with no organic demand driver. Users who hold the token hold it because they made a commitment — not purely because they expected price appreciation.

The token supply, issuance formula, and governance module design are deferred to post-grant development.
