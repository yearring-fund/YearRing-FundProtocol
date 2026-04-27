# OV Application — Q&A
## YearRing Fund Protocol · Outlier Ventures / Conviction Markets Open Call

---

## Section 1: Team

**Q: Who are the founders and what is your background?**

Si Lugang — Protocol Architect & Builder, YearRing Fund Protocol.

I have built YearRing Fund Protocol end-to-end: smart contract architecture, deployment infrastructure, test suites, frontend integration, and operational tooling. The protocol was built from concept to mainnet deployment in its recent development cycle, informed by over two years of thinking around on-chain financial infrastructure, transparent fund accounting, and long-term capital coordination.

My approach is engineering-first: every design decision is validated by tests before deployment, and every mechanism (including emergency exits and forced-exit protocols) is built before the feature it protects.

YearRing Fund Protocol is currently founder-led, with development, protocol design, product direction, and early go-to-market preparation coordinated by the founder.

Additional core contributors, advisors, and domain partners may be added as the protocol moves from controlled mainnet validation into broader user testing and RWA strategy expansion.

---

## Section 2: Project

**Q: What are you building?**

YearRing Fund Protocol is a non-custodial capital container for long-term on-chain users, starting with conservative DeFi yield and expanding toward RWA distribution.

It is a two-layer protocol deployed on Base mainnet:

1. **FundVaultV01** — an ERC-4626 yield-bearing vault. USDC deposits are represented as `fbUSDC` shares via transparent pro-rata vault accounting. The vault can reflect variable Aave V3 USDC supply yield when the strategy position generates yield. Yield is variable and not guaranteed. Core vault accounting does not depend on any token price.

2. **LockRewardManagerV02** — a commitment coordination layer. Participants lock vault shares into tiered positions (Bronze / Silver / Gold) and earn reward token (RWT) proportional to commitment depth. Commitment state is verified entirely on-chain. A built-in dual-signature forced-exit protocol ensures any locked position can be exited under defined conditions, with an on-chain audit trail.

**Q: What problem are you solving?**

Long-term on-chain capital coordination lacks the right infrastructure. Existing DeFi products are optimized for short-term yield extraction. Long-term participants have no mechanism for expressing verifiable commitment depth in a non-custodial way.

YearRing Fund Protocol provides a structured access layer for DeFi yield and future RWA strategies, with a commitment layer that coordinates long-term capital behavior without a discretionary fund manager. Role-based admin and emergency controls are bounded by timelock governance where applicable.

**Q: How does your solution work technically?**

- `FundVaultV01`: ERC-4626-compliant vault on Base. Deposits route through `StrategyManagerV01` into the Aave V3 USDC supply position. Yield accrues to vault NAV. Shares (`fbUSDC`) represent pro-rata ownership. NAV is derived from `totalAssets()`, never set directly.

- `LockRewardManagerV02`: Users lock `fbUSDC` shares for a defined duration. Lock position is recorded in `LockLedgerV02`. Tier eligibility (Bronze / Silver / Gold) is computed on-chain from lock amount and duration. RWT rewards accrue via `LockBenefitV02`. A `BeneficiaryModuleV02` handles multi-party beneficiary designation.

- **Forced-exit protocol**: A dual-signature authorization mechanism that allows any locked position to be exited under defined conditions, requiring two authorized keys and producing an on-chain audit trail.

- **Emergency system**: Full emergency pause and sequential exit procedures are implemented, drill-tested, and governed by role-based access control bounded by `ProtocolTimelockV02`.

---

## Section 3: Traction

**Q: What is your current traction / stage?**

| Milestone | Status |
|---|---|
| Protocol architecture | Complete |
| Smart contract development | V01 + V02 deployed on Base mainnet |
| Test suite | 611 tests passing (unit, integration, Aave V3 fork tests) |
| Base mainnet deployment | Live |
| Strategy integration (Aave V3) | Live |
| Step 3 — Mainnet deployment and internal readiness | Complete |
| Step 4 — Controlled user validation | In preparation |
| External audit | Pending |

Step 3 is complete. The protocol has completed mainnet deployment, Aave V3 strategy validation, frontend readiness checks, documentation setup, and public repository cleanup for controlled validation.

Step 4 (first controlled external cohort) is the immediate next milestone.

**Q: Do you have any revenue or users?**

Step 3 internal readiness is complete — the protocol has been validated on Base mainnet with real USDC across controlled internal positions. External users are not onboarded until internal readiness checks and parameter validation are fully complete.

Step 4 opens the protocol to the first controlled external users. Step 4 parameters will be finalized before opening access.

---

## Section 4: Token & Business Model

**Q: Do you have a token? What is your token model?**

**RWT (Reward Token)** — coordination token, not a funding token.

RWT distributes to participants who demonstrate long-term commitment through the lock mechanism. It is not sold to fund the protocol. The vault strategy yield is the economic floor — RWT coordinates behavior on top of that floor. RWT is not included in vault NAV. Core vault accounting does not depend on RWT price.

**Protocol fee**: A management fee (basis points) is levied on vault AUM and accrues on-chain to the protocol treasury. This is the primary revenue mechanism.

**Q: What is your business model?**

1. Protocol fee on AUM (basis points, on-chain, governed by timelock)
2. Future: long-term capital coordination infrastructure for organizations deploying structured on-chain pools
3. Long-term: governance coordination for RWA pools, DAO treasuries, and structured on-chain funding rounds

---

## Section 5: Fit with OV

**Q: Why Outlier Ventures? Why now?**

OV's Conviction Markets thesis identifies coordination problems that YearRing Fund Protocol has been building against. Several of the ten problems in the Request for Builders map to mechanisms already implemented:

| OV Problem | YearRing Implementation |
|---|---|
| Capital access without equity structures (OV #1) | ERC-4626 shares as transparent on-chain position records |
| Verification without managers (OV #4) | On-chain lock ledger; tier and duration computed on-chain |
| Exit without acquisition (OV #8) | Dual-signature forced-exit protocol with on-chain audit trail |
| Trust without centralized institutions (OV #3) | Role-based access control bounded by timelock governance |
| Coordination without corporate structure (OV #5) | Commitment layer coordinates long-term capital behavior on-chain |

We are applying because OV named the coordination problem correctly, has capital allocated to it, and we have a working protocol addressing it.

**Q: What do you want from OV?**

1. **Capital** for Step 4 controlled user onboarding and V3 protocol development
2. **Network** — introductions to DeFi protocols, RWA funds, and DAO treasuries that need long-term capital coordination infrastructure
3. **Strategic partnership** with a team that understands long-term capital coordination as a protocol primitive

**Q: What stage are you at?**

Mainnet validation deployment on Base. Step 3 internal readiness complete. Preparing a controlled external-user pilot as the next milestone, after finalizing safety boundaries, access controls, and public-facing documentation. External audit is pending.

---

## Section 6: Additional

**Q: Where are you based?**

Remote. Organization: YearRing Fund Protocol / Yearring.
Contact: hello@yearringfund.com
Website: https://yearringfund.com

**Q: Are you raising? How much?**

YearRing Fund Protocol is currently prioritizing accelerator support, technical review, early user validation, security preparation, and RWA strategy partnerships.

A formal fundraising amount has not been publicly specified in this document. Use of funds would primarily focus on protocol security, engineering, external audit preparation, RWA partnership development, and Step 4 user onboarding.

**Q: Anything else you want us to know?**

YearRing Fund Protocol was built with a consistent design constraint: exit paths must always be structurally preserved. The forced-exit protocol and emergency drill procedures were implemented before the growth features they protect. A commitment coordination layer without credible exit is not a commitment system — it is a trap.

This is not a disclaimer. It is a design principle.
