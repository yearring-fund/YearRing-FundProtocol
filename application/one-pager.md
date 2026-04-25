# Yearring / FinancialBase — One Pager
### Commitment-Layer Infrastructure for On-Chain Conviction Markets

---

**The problem OV named correctly:**
You cannot coordinate capital and conviction at scale without lawyers, cap tables, and institutions — unless you replace those trust primitives with something better.

**What we built:**
A two-layer protocol on Base mainnet that does exactly that.

---

## The System

**FundVaultV01 — Capital Layer**
ERC4626 vault. USDC → `fbUSDC` shares. Yield from Aave V3. No token dependency. No equity. No administrator.
→ *Funding without equity. Ownership without a cap table.*

**LockRewardManagerV02 — Conviction Layer**
Lock vault shares into Bronze / Silver / Gold tiers. Conviction depth is verified on-chain. Reward token (RWT) distributes proportionally. A dual-signature forced-exit protocol ensures exit is always available — no manager, no court needed.
→ *Verification without managers. Exit without acquisition. Trust without institutions.*

---

## Why It Works

The vault yield is the economic floor — it does not depend on RWT price or protocol growth. A participant earns Aave V3 yield on day one. Conviction coordination is layered on top of that floor, not below it.

This separation is the design insight most "commitment" protocols miss.

---

## Current State

| | |
|---|---|
| Deployment | Base mainnet, live |
| Test coverage | 613 tests passing |
| Strategy | Aave V3 USDC supply, integrated |
| Stage | Step 3 internal rehearsal (real USDC, 5 addresses) |
| Next | Step 4 — first external cohort |

---

## What We're Looking For

- **Capital** to fund Step 4 onboarding and V3 development
- **Network** to reach DeFi protocols, RWA funds, and DAO treasuries
- **Partners** who understand conviction as a coordination primitive

---

**Yearring**  
hello@yearringfund.com  
https://yearringfund.com  
https://docs.yearringfund.com
