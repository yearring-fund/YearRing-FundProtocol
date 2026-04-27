# Application Narrative Framework — YearRing Fund Protocol
## Outlier Ventures / Conviction Markets Open Call

---

## Positioning Statement

> **YearRing Fund Protocol is a non-custodial capital container for long-term on-chain users — starting with conservative DeFi yield and expanding toward RWA distribution. It provides transparent vault accounting, on-chain position records, and a commitment layer that coordinates long-term capital behavior without a discretionary fund manager.**

---

## The Problem

Long-term capital coordination on-chain lacks the right infrastructure.

Existing DeFi products are optimized for short-term yield extraction. Long-term participants have no mechanism for expressing conviction depth in a verifiable, non-custodial way. Commitment signals are either off-chain and unenforceable, or on-chain but coupled to token price — collapsing when market conditions change.

What's missing is a protocol that separates the yield floor from the coordination layer, and makes both verifiable without discretionary intermediaries.

---

## The System: Two Layers, One Protocol

### Layer 1 — The Vault

`FundVaultV01` is an ERC-4626 vault on Base. USDC deposits are represented as `fbUSDC` shares via transparent pro-rata vault accounting. Capital can be deployed into approved strategies — currently Aave V3 USDC supply. The vault can reflect variable Aave V3 yield when the strategy generates yield. Yield is variable and not guaranteed.

No discretionary fund manager. Role-based admin and emergency controls are bounded by a 24-hour `ProtocolTimelockV02` for all non-emergency governance operations.

### Layer 2 — The Commitment Layer

`LockRewardManagerV02` is the commitment coordination layer. Participants lock vault shares into tiered positions:

| Tier | Lock Duration | Signal |
|---|---|---|
| Bronze | Entry-level commitment | Participation |
| Silver | Mid-level lock | Conviction |
| Gold | Deep lock | Alignment |

Commitment depth is verifiable on-chain. Reward token (RWT) distribution is proportional to lock duration × tier. RWT is a coordination token — it is not sold to fund the protocol and is not included in vault NAV.

---

## Key Differentiators

### 1. Yield floor independent of token price

The vault strategy yield does not depend on RWT price or protocol growth. Most commitment protocols collapse when token price falls because yield and token are coupled. YearRing separates them by design.

### 2. Credible exit as a first-class primitive

The protocol includes a dual-signature forced-exit mechanism: any locked position can be exited under defined conditions, requiring two authorized keys and producing an on-chain audit trail. This makes commitment credible — participants can verify that exit paths exist before locking.

### 3. Deployed and operationally validated

611 tests passing. Live on Base mainnet. Step 3 internal readiness complete. This is a running system, not a whitepaper.

---

## Alignment with OV Conviction Markets Thesis

OV's Request for Builders identifies ten coordination problems. YearRing Fund Protocol directly addresses several:

| OV Problem | YearRing Implementation |
|---|---|
| Capital access without equity structures (OV #1) | ERC-4626 shares as transparent on-chain position records |
| Verification without managers (OV #4) | On-chain lock ledger; tier and duration computed on-chain |
| Exit without acquisition (OV #8) | Dual-signature forced-exit protocol with on-chain audit trail |
| Trust without centralized institutions (OV #3) | Role-based access control bounded by timelock governance |
| Coordination without corporate structure (OV #5) | Commitment layer coordinates long-term capital behavior on-chain |

---

## Market

**Primary:** DeFi participants seeking structured long-term yield with verifiable commitment coordination (stakers, LPs, DAO treasuries)

**Expansion:**
- RWA coordination (structured pools for real-world investment rounds)
- Long-term capital alignment for on-chain funding infrastructure
- Commitment-based agent cost governance (OV problem #7)

---

## Traction

| Metric | Status |
|---|---|
| Base mainnet deployment | Live |
| Test coverage | 611 tests passing (unit, integration, Aave V3 fork) |
| Strategy integration | Aave V3 USDC supply on Base |
| Step 3 — Internal mainnet readiness | Complete |
| Step 4 — Controlled external-user pilot | In preparation |
| External audit | Pending |

---

## Business Model

- **Protocol fee**: Management fee on vault AUM (basis points, on-chain, governed by timelock)
- **Token coordination**: RWT distribution creates structured participation incentive
- **Future**: Long-term capital coordination infrastructure for RWA pools, DAO treasuries, and structured on-chain funding rounds

---

## The Ask from OV

1. **Capital**: To fund Step 4 controlled user onboarding and V3 protocol development
2. **Network**: Introductions to DeFi protocols, RWA funds, and DAO treasuries that need long-term capital coordination infrastructure
3. **Strategic partnership**: OV named the coordination problem correctly — we are building a working answer to it

---

## Narrative Reference Points

- "We didn't build a token with a vault attached. We built a vault with a commitment layer on top."
- "The forced-exit mechanism isn't a safety feature — it's what makes commitment credible."
- "The vault yield floor does not depend on RWT price. That separation is the design."
- "611 tests. Live on Base. Step 3 complete. This is a running system."
