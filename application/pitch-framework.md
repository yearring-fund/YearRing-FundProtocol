# Pitch Framework — Yearring / FinancialBase
## For Outlier Ventures Application (Conviction Markets / Base Camp)

---

## Positioning Statement (One Sentence)

> **Yearring is the commitment-layer infrastructure for on-chain conviction markets — enabling funding, ownership, and coordination without equity, cap tables, or legal intermediaries.**

---

## The Problem (Their Words, Our Frame)

The venture model fails not because founders are incompetent, but because the **coordination primitive is wrong**.

Equity requires lawyers. Cap tables require administrators. Trust requires institutions. Exit requires acquisition.

Every one of these is a tax on conviction — and that tax is high enough to exclude most of the world's legitimate builders and capital.

---

## Our Answer: Two Layers, One System

### Layer 1 — The Yield Floor
`FundVaultV01` is an ERC4626 vault on Base. USDC in → `fbUSDC` shares out. Yield comes from Aave V3. No token dependency. No manager. No counterparty risk beyond the strategy contract.

This is funding without equity. The share *is* the ownership record. No lawyer needed to issue it.

### Layer 2 — The Conviction Mechanism
`LockRewardManagerV02` is the commitment layer. Participants lock vault shares into tiered positions:

| Tier | Lock Depth | Signal |
|---|---|---|
| Bronze | Entry-level commitment | Participation |
| Silver | Mid-level lock | Conviction |
| Gold | Deep lock | Alignment |

Conviction depth is verifiable on-chain. Reward token (RWT) distribution is proportional to lock duration × tier. No manager approves upgrades. No institution certifies intent.

---

## Key Differentiators

### 1. The vault earns regardless of the token
Most "commitment" protocols collapse when token price falls — because the yield *is* the token. We separated them by design. Aave V3 yield is the floor. RWT is the coordination layer on top.

### 2. Forced-exit is a first-class primitive
We built a dual-signature exit mechanism before building anything else. Conviction markets only work if exit is credible and non-custodial. Our forced-exit protocol requires two authorized keys and produces an on-chain audit trail — no courts, no arbitrators.

### 3. Already deployed, already tested
611 tests passing. Live on Base mainnet. Internal rehearsal (Step 3) complete. We are not describing a system — we are running one.

---

## Market

**Primary:** DeFi protocol participants seeking yield with commitment coordination (stakers, LPs, DAO treasuries)

**Expansion:**  
- RWA coordination (conviction pools for real-world investment rounds)
- On-chain VC primitives (conviction-gated funding rounds without equity)
- Agent cost governance (commitment-based agent resource allocation — OV problem #07)

---

## Traction

| Metric | Status |
|---|---|
| Mainnet deployment | Live on Base |
| Test coverage | 611 tests, full suite passing |
| Strategy integration | Aave V3 on Base |
| Internal rehearsal | Step 3 complete |
| External users | Step 4 — imminent |

---

## Business Model

- **Protocol fee**: Management fee on vault AUM (basis points, on-chain, configurable by governance)
- **Token coordination**: RWT distribution creates ecosystem participation incentive
- **Future**: Conviction-as-a-service for organizations wanting to deploy this primitive without building it

---

## The Ask from OV

1. **Capital**: Seed round to fund Step 4 (external user onboarding) and V3 development
2. **Network**: Introductions to DeFi protocols, RWA funds, and DAO treasuries that need commitment coordination
3. **Thesis alignment**: OV as a strategic partner who named this problem — we want to build the answer together

---

## Narrative Hooks (for pitching)

- *"You said the right instrument doesn't exist yet. It does. It's been running on Base for months."*
- *"We didn't build a token with a vault attached. We built a vault with a commitment layer on top."*
- *"The forced-exit mechanism isn't a safety feature — it's the conviction guarantee."*
- *"fbUSDC is a cap table entry. It's just stored on a blockchain instead of a spreadsheet."*
