# FinancialBase — One Pager

## Problem

Most on-chain yield products are built for liquidity. Users deposit, earn, and exit freely — often within hours. This is rational for traders, but it creates a structural mismatch: protocols that need stable, long-horizon capital have no mechanism to attract or retain it. The result is mercenary liquidity that chases the highest APY and leaves at the first sign of volatility.

Few on-chain products explicitly reward long-term capital commitment and enforce early-exit accountability on-chain.

## Solution

FinancialBase is an on-chain asset management protocol with a commitment incentive layer built in.

The foundation is a 100% reserve ERC4626 vault. Users deposit USDC and receive yield-bearing shares (fbUSDC). This part is standard.

The differentiation is the lock layer on top: users who voluntarily lock their shares for a fixed duration (30–365 days protocol range; current UI exposes three tiers: 30 / 90 / 180 days) unlock two stacked incentives — upfront reward tokens (RWT) proportional to principal × duration × tier, and a management fee rebate that accrues linearly over the lock duration and is claimable as vault shares. Longer commitments receive disproportionately higher rewards (under the current parameter set, Gold earns 10.8× more reward tokens than Bronze for the same principal).

The system is designed so that commitment depth is measurable on-chain: core protocol metrics are queryable on-chain in a single call, while richer commitment analytics are produced through an off-chain aggregation script.

## Why This Is Not Lock-Up Liquidity Mining

A 30–365 day lock, by itself, is better understood as a medium-horizon commitment. What makes FinancialBase a long-horizon asset system is the architecture built around it:

- **Vault yield is independent of the token.** The vault generates base yield through strategy performance. If the reward token goes to zero, `pricePerShare` still appreciates. The vault does not need the token to function as a yield-bearing asset.
- **The commitment mechanism, however, does depend on the token.** Upfront rewards are issued in RWT at lock time; early exit requires returning them. This is not a toggle — it is how the commitment incentive works in V2. Removing the token means removing the commitment layer, not just a feature flag.
- **Commitment is structured, not cosmetic.** The lock is not an APY multiplier bolted onto a farming scheme. It is a structured commitment with explicit upfront incentives and explicit unwind conditions.
- **The lock window is a repeatable commitment primitive.** A 30–365 day lock is not the full definition of long-term capital. It is the first on-chain commitment layer in a system designed to favor capital that stays, compounds, and remains aligned over time.

In a typical liquidity mining model, token emissions are the primary reason users stay — and the token is what creates the apparent yield. In FinancialBase, the vault yield exists independently; the token coordinates commitment behavior on top of that yield base. The two dependencies are distinct and should not be conflated.

That is why the current design should be understood as a **long-horizon asset architecture**, not a short-term vault with a lock-up switch.

---

## Why Now

DeFi protocols are maturing past the "APY arms race" phase. Sustainable protocols need capital that stays. Regulatory and institutional attention is shifting toward products with clear structures, auditable accounting, and real utility — not just token emissions. This protocol is built for this environment: no inflationary token mechanics, no off-chain promises, no incentives that disappear after a season.

The infrastructure to build this (ERC4626, access control, on-chain time) has been stable long enough to build on seriously.

## Why Different from a Normal DeFi Vault

| Normal vault | FinancialBase |
|---|---|
| Rewards liquidity equally | Rewards commitment duration and depth |
| Users are interchangeable | Users are segmented by tier (Bronze / Silver / Gold) |
| No cost to exit | Early exit requires returning upfront reward tokens |
| Yield is the only incentive | Yield + RWT upfront reward + fee rebate |
| No on-chain commitment signal | Locked ratio and tier breakdown queryable in one call |
| Capital is anonymous | A beneficiary module supports continuity of locked positions under predefined inactivity conditions |

The lock layer is not a feature bolted on top of a vault. It is the mechanism that makes commitment depth measurable, incentivized, and verifiable on-chain.

## Current Build Status

V3 is the current version — all commitment layer modules are live on Base Sepolia testnet and fully tested on local Hardhat. All modules are deployed and tested:

- FundVaultV01: ERC4626, 100% reserve, management fee accrual, safety mode (pause/emergency exit)
- LockLedgerV02: share custody, multi-tier lock durations (30 / 90 / 180d)
- LockRewardManagerV02: upfront reward token issuance, linear rebate, early exit with token return
- LockBenefitV02: tier classification (Bronze / Silver / Gold) and fee discount rate
- BeneficiaryModuleV02: designated beneficiary can claim locked positions when a predefined inactivity condition is satisfied; lock duration and shares preserved
- UserStateEngineV02: single-call user state aggregation
- MetricsLayerV02: protocol-level metrics snapshot + off-chain aggregation script
- GovernanceSignalV02: on-chain governance signal layer (vote weight derived from lock tier; signals are advisory only and do not auto-execute)
- ProtocolTimelockV02: 24h timelock enforced for non-emergency admin operations
- Frontend dashboard: deployed on Base Sepolia, covering all user-facing modules

Test coverage: 500+ tests passing across all modules (exact count grows as new phases are added; run `npx hardhat test` for the current number). Three end-to-end demo scripts (regular user / long-term committed user / beneficiary path).

## How to Verify

The claims above are checkable locally in under five minutes. No testnet access required.

**Prerequisites:** Node.js 18+, then `npm install --legacy-peer-deps`

---

**1. Run the full test suite** — confirms all protocol invariants hold across 500+ tests:

```bash
npx hardhat test
```

Expected output: all tests passing, including accounting isolation tests that assert `vault.totalAssets()`, `vault.totalSupply()`, and `ledger.totalLockedShares()` are unchanged by commitment operations.

---

**2. Run the metrics script** — deploys a local protocol instance, seeds a representative state (Alice / Bob / Carol at different tiers), and outputs a JSON snapshot:

```bash
npx hardhat run scripts/metrics.ts
```

Expected output:
```
TVL              : 4500.00 USDC
Total Locked     : 3500.0000 fbUSDC
Locked Ratio     : 77.77%
Total Locks Ever : 4

Tier Distribution:
  Bronze  :    1       1000.0000 fbUSDC
  Silver  :    1       2000.0000 fbUSDC
  Gold    :    1        500.0000 fbUSDC

Early Exit Count      : 1
Total Active Points   : 900.00 pts
```

A pre-generated copy of this output is available at [`docs/metrics_output.json`](./metrics_output.json).

---

**3. Run the end-to-end demo** — traces a complete long-term user lifecycle (deposit → 180-day lock → strategy yield → maturity → unlock → redeem):

```bash
npx hardhat run scripts/demo_b.ts
```

This script prints each step with before/after balances, upfront reward token issuance amount, accrued points, and final redemption value vs. original deposit. It confirms the commitment math and yield accounting end-to-end without requiring any external network.

---

## Next Milestone

Step1 (V3 commitment layer) is complete. The next stage is Step2:

1. **Step2 — Mainnet real-yield verification:** Deploy the Aave V3 strategy on Base mainnet with a small real USDC position to complete the first live capital round-trip (user wallet → Vault → Aave V3 → Vault → user wallet).
2. **Step2 — Evidence package:** Produce on-chain proof of yield (transaction receipts, before/after `pricePerShare` readings, Aave aToken balance reconciliation).
3. **V4 planning:** Multi-strategy routing, governance execution bridge (from signal to on-chain enforcement), and institutional-grade compliance disclosure layer.
