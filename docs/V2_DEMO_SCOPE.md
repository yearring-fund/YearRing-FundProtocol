# V2 Demo Build — Scope Definition

> This document defines the scope of the current testnet demo build.
> It is not a product roadmap.
> Every decision here serves one goal:
> a deployable, demonstrable, reviewable V2 build for the Outlier application.

---

## What a Reviewer Will See First

1. A vault that generates yield through a strategy path rather than static accounting
2. A lock layer that rewards longer commitment with **RWT** and a **management fee rebate**
3. An early-exit path that makes commitment explicitly accountable under predefined demo rules
4. A beneficiary path that preserves locked positions under predefined inactivity conditions
5. A metrics snapshot that makes protocol-level commitment depth readable in one view

---

## Incentive Layer (Converged)

The current demo build has exactly two **user-facing** incentive layers:

| Layer | Mechanism | When |
|---|---|---|
| **RWT** | Reward tokens issued at lock time; amount determined by principal, duration, and tier configuration | At `lockWithReward` |
| **Fee rebate** | Linear management fee discount accrued during the active lock period; claimable as fbUSDC shares from treasury under demo rules | During an active lock |

### Not part of the current demo-facing incentive stack

- **Independent points system**
  Any points-related logic, if present in the codebase, is treated as a **reserved future module** and is **not part of the current demo build**, frontend, or reviewer-facing documentation.

- **Governance execution**
  Governance signaling or governance execution modules, if present in the codebase, are outside the current demo flow and are not required to understand this build.

The reviewer-facing story is intentionally simple:

- **RWT** represents long-term reward and future ecosystem / governance bridge
- **Fee rebate** provides immediate economic utility for committed users

---

## Demo Paths (Three)

### Path A — Standard User
`deposit → hold → redeem`

**Proves:** base vault yield exists independently of any lock or token incentive.

### Path B — Long-Term Committed User
`deposit → lock (Gold tier) → RWT issued → fee rebate accrues → maturity → unlock → redeem`

**Proves:** commitment is rewarded through two clear incentive layers on top of base vault yield.

### Path C — Beneficiary Path
`deposit → lock → set beneficiary → inactivity trigger → beneficiary claims position → unlock`

**Proves:** locked positions have continuity guarantees and the commitment architecture handles edge cases beyond standard deposit / redeem flows.

---

## Module Scope

### In Demo (active)

| Module | Role in Demo |
|---|---|
| `FundVaultV01` | Deposit / redeem / base vault accounting / yield accumulation |
| `StrategyManagerV01` + `DummyStrategy` | Strategy path and yield simulation for demo purposes |
| `RewardToken` | RWT issuance and early-exit return requirement under demo rules |
| `LockLedgerV02` | Share custody and lock tracking |
| `LockBenefitV02` | Tier classification and lock-level benefit configuration |
| `LockRewardManagerV02` | Lock entry point, rebate claim path, and early-exit entry point |
| `BeneficiaryModuleV02` | Beneficiary designation and claim path |
| `UserStateEngineV02` | Single-call user state for frontend and demo display |
| `MetricsLayerV02` | Protocol-level snapshot for frontend and reviewer view |

### Present in Codebase but Excluded from Current Demo Build

| Module / Logic | Status |
|---|---|
| Points-related logic | Reserved for future use; not part of current demo UI, docs, or incentive story |
| Governance signaling / execution logic | Out of scope for current demo flow |
| Merkle or external reward distribution paths | Out of scope for current demo flow |

The current demo build should be understood through the active modules only.

---

## What Is Explicitly Not Built in This Round

- Independent on-chain points system with user-facing state
- DAO or governance execution path
- Multiple parallel strategies
- Multiple-beneficiary allocation logic
- Full annuity / pension distribution engine
- Multi-asset pools
- Complex penalty vaults for early exit
- Full product frontend beyond the single-page demo interface

---

## Early Exit Rule (Demo Definition)

Early exit is included in the demo because commitment must remain reversible, but not costless.

For the current demo build:

- early exit is available before maturity
- the user's locked position is unwound under predefined demo rules
- any lock-specific extra entitlement is cancelled
- **RWT return is required according to the configured demo parameter set**
- the exact return requirement and threshold values are defined in `docs/PARAMETERS.md`

This document does not define the full economic policy.
It only defines the existence of an accountable early-exit path in the demo build.

---

## Testnet Parameter Framing

Parameter presentation must distinguish between **protocol design ranges** and **demo-operational ranges**.

### Protocol design ranges
These reflect the intended long-term product structure:

- lock tiers: 30 / 90 / 180 days

### Testnet demo ranges
These may use shorter durations solely to make the build demonstrable in live review, recorded demo, or internal walkthroughs.

The exact live demo values must be documented in `docs/PARAMETERS.md`.

This separation prevents confusion between:
- what the protocol is designed to express, and
- what the testnet build uses for demonstrability.

---

## Testnet Setup (Demo Assumptions)

Full deploy-time values are recorded in `docs/PARAMETERS.md` and `docs/CONTRACT_ADDRESSES.md`.

Current demo assumptions:

- **Network:** Base Sepolia
- **Strategy path:** `DummyStrategy` for simulated yield, avoiding external dependency risk during demo
- **RWT supply source:** preconfigured treasury allocation for demo issuance
- **Frontend mode:** single-page reviewer-facing demo, not a production application

---

## Current Delivery Focus

The purpose of this round is not to expand feature scope.
The purpose is to make the current V2 demo build:

- deployable on testnet
- easy to demonstrate remotely
- easy to understand in review
- clearly differentiated from a normal DeFi vault

Accordingly, the active delivery focus is:

1. deployment and setup scripts
2. seed and demo scenario scripts
3. single-page demo frontend
4. reviewer-facing docs
5. parameter and address recording

---

## File Change Summary

### contracts
Contract scope is defined for the current demo build.
Any remaining implementation, cleanup, or integration status should be tracked through test reports, deployment scripts, and frontend wiring rather than described here as product-complete.

### tests
Test coverage status should be reported separately in implementation or delivery notes, not assumed by this scope file.

### scripts (delivery focus)
- `scripts/deploy_v2.ts` — deploy V2 demo modules on top of the V1 base
- `scripts/setup.ts` — grant roles, configure approvals, and set demo parameters
- `scripts/seed.ts` — fund demo accounts, deposit, lock, and set beneficiary state
- `scripts/demo_scenarios.ts` — execute the three reviewer-facing demo paths with printable output
- `scripts/reset.ts` — redeploy and reinitialize the demo environment

### frontend
- `frontend/` — single-page React + wagmi demo app
- Sections: Wallet / Vault / Lock / Incentive / State / Beneficiary / Strategy

### docs (required)
- `docs/V2_DEMO_SCOPE.md` ← this file
- `docs/DEMO_GUIDE.md`
- `docs/CONTRACT_ADDRESSES.md`
- `docs/PARAMETERS.md`
- `docs/KNOWN_LIMITATIONS.md`

### docs (to update for scope alignment)
- `docs/ONE_PAGER.md` — remove points from the active incentive story
- `docs/PRODUCT_ARCHITECTURE.md` — treat points as future / reserved layer only
- `docs/DEMO_SCRIPT_SUMMARY.md` — replace points references with RWT + fee rebate
- `docs/TOKEN_ROLE.md` — align token role with current reviewer-facing scope
- `README.md` — align incentive description with current demo build

---

## Scope Standard

If a feature does not help the reviewer quickly understand, verify, or differentiate this build, it is out of scope for the current round.
