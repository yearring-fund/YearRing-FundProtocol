# OV Application — Q&A Draft
## Yearring / FinancialBase · Outlier Ventures Base Camp / Conviction Markets Open Call

---

## Section 1: Team

**Q: Who are the founders and what is your background?**

Si Lugang — Protocol Architect & Builder, Yearring / FinancialBase.

I have built FinancialBase end-to-end: smart contract architecture, deployment infrastructure, test suites, frontend integration, and operational tooling. The protocol has gone from concept to a 613-test, mainnet-deployed system on Base over two years of focused development.

My approach is engineering-first: every design decision is validated by tests before deployment, and every mechanism (including emergency exits and forced-exit protocols) is built before the feature it protects.

Founder: Lugang Si

YearRing Fund Protocol is currently founder-led, with development, protocol design, product direction, and early go-to-market preparation coordinated by the founder.

Additional core contributors, advisors, and domain partners may be added as the protocol moves from controlled mainnet validation into broader user testing and RWA strategy expansion.

---

## Section 2: Project

**Q: What are you building?**

Yearring / FinancialBase is commitment-layer infrastructure for on-chain conviction markets.

It is a two-layer protocol deployed on Base mainnet:

1. **FundVaultV01** — an ERC4626 yield-bearing vault. USDC deposits earn Aave V3 yield and are represented as `fbUSDC` shares. This is the capital layer: ownership without equity, yield without token dependency.

2. **LockRewardManagerV02** — a commitment coordination layer. Participants lock vault shares into tiered positions (Bronze / Silver / Gold) and earn reward token (RWT) proportional to conviction depth. Commitment state is verified entirely on-chain. A built-in forced-exit protocol (dual-signature) ensures no participant can be locked in without a credible exit path.

**Q: What problem are you solving?**

Coordinating capital and conviction without the traditional overhead of equity, cap tables, legal intermediaries, and institutional trust.

The existing infrastructure for funding and ownership coordination — lawyers, cap tables, fund administrators, escrow agents — extracts enormous cost from every transaction. It also excludes most of the world's legitimate capital and builders who cannot afford that overhead.

We are replacing each of those trust primitives with smart contract equivalents that are cheaper, faster, composable, and globally accessible.

**Q: How does your solution work technically?**

- `FundVaultV01`: ERC4626-compliant vault on Base. Deposits route through `StrategyManagerV01` into Aave V3 USDC supply position. Yield accrues to vault NAV. Shares (`fbUSDC`) represent pro-rata ownership.

- `LockRewardManagerV02`: Users lock `fbUSDC` shares for a defined duration. Lock position is recorded in `LockLedgerV02`. Tier eligibility (Bronze/Silver/Gold) is computed on-chain from lock amount and duration. RWT rewards accrue via `LockBenefitV02`. A `BeneficiaryModuleV02` handles multi-party beneficiary designation.

- **Forced-exit protocol**: A two-key authorization mechanism that allows any locked position to be exited under defined conditions, producing an on-chain audit trail. No court, no arbitrator, no manager.

- **Emergency system**: Full emergency pause and sequential exit procedures are implemented and drill-tested.

---

## Section 3: Traction

**Q: What is your current traction / stage?**

| Milestone | Status |
|---|---|
| Protocol architecture | Complete |
| Smart contract development | Complete — V01 + V02 deployed |
| Test suite | 613 tests passing (unit, integration, Aave V3 fork tests) |
| Base mainnet deployment | Live |
| Strategy integration (Aave V3) | Live |
| Step 3 — Mainnet deployment and internal readiness | Complete |
| Step 4 — Controlled user validation | Next |

Step 3 is complete. The protocol has completed mainnet deployment, Aave V3 strategy validation, front-end readiness checks, documentation setup, and public repository cleanup for controlled validation.

Step 4 (first external cohort) is the immediate next step.

**Q: Do you have any revenue or users?**

Step 3 internal readiness is complete — the protocol has been validated on Base mainnet with real USDC across controlled internal positions. This is by design: external users are not onboarded until internal readiness checks and parameter validation are fully complete.

Step 4 opens the protocol to the first real external users. Step 4 parameters will be finalized before opening access.

---

## Section 4: Token & Business Model

**Q: Do you have a token? What is your token model?**

**RWT (Reward Token)** — coordination token, not a funding token.

Design principle: RWT distributes to participants who demonstrate conviction through the lock mechanism. It is not sold to fund the protocol. The vault yield (Aave V3) is the economic floor — RWT coordinates behavior on top of that floor.

This means RWT does not need to appreciate for the protocol to be useful. Participants earn yield regardless of RWT price. RWT adds coordination incentive on top.

**Protocol fee**: A management fee (basis points) is levied on vault AUM and accrues on-chain to the protocol treasury. This is the primary revenue mechanism.

**Q: What is your business model?**

1. Protocol fee on AUM (basis points, on-chain)
2. Future: conviction-as-a-service for organizations deploying this primitive
3. Long-term: governance coordination for RWA pools, DAO treasuries, and on-chain funding rounds

---

## Section 5: Fit with OV

**Q: Why Outlier Ventures? Why now?**

OV's Conviction Markets thesis names exactly the problem we have been building against. The ten problems in your Request for Builders map directly to mechanisms we have already implemented:

- Funding without equity → ERC4626 vault shares
- Ownership without cap tables → `fbUSDC` as on-chain ownership record
- Trust without institutions → smart contracts replace fund administrators
- Verification without managers → on-chain lock ledger replaces human review
- Exit without acquisition → forced-exit dual-signature protocol

We are not applying because we need validation of the thesis. We are applying because OV named it correctly, has capital allocated to it, and we have the working instrument.

**Q: What do you want from OV?**

1. **Capital** for Step 4 user onboarding and V3 protocol development
2. **Network** — introductions to DeFi protocols, RWA funds, and DAO treasuries who need commitment coordination infrastructure
3. **Strategic partnership** with a team that understands the conviction market primitive at a thesis level — not just as a DeFi product

**Q: What stage are you at?**

MVP on mainnet. Internal validation complete. Opening to external users imminently. We are at the beginning of the growth phase.

---

## Section 6: Additional

**Q: Where are you based?**

Remote / Base network (on-chain). Organization: Yearring.  
Contact: hello@yearringfund.com  
Website: https://yearringfund.com

**Q: Are you raising? How much?**

Fundraising status:

YearRing Fund Protocol is currently prioritizing accelerator support, technical review, early user validation, security preparation, and RWA strategy partnerships.

A formal fundraising amount has not been publicly specified in this document. Use of funds would primarily focus on protocol security, engineering, legal/compliance preparation, RWA partnership development, and early user acquisition.

**Q: Anything else you want us to know?**

FinancialBase was built with one non-negotiable constraint: the exit must always be credible. We built the forced-exit protocol and emergency drill procedures before we built the growth features. We believe that a commitment market without a credible exit is a trap — and we refuse to build traps.

This is not a safety disclaimer. It is our core design philosophy.
