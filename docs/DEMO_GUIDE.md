# Demo Guide

> Three demo paths for YearRing-FundProtocol V2.
> Each path is self-contained and demonstrates a distinct user type.

---

## Scene A — Passive Yield User

**Goal:** Show ERC4626 deposit/redeem with share-price accounting. No lock required.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Connect wallet on Base Sepolia | Address shown in header |
| 2 | Vault → Mint 1,000 MockUSDC | USDC balance increases |
| 3 | Vault → Approve USDC → Deposit 1,000 USDC | Receive fbUSDC shares; `pricePerShare` = 1.00 |
| 4 | *(Admin simulates yield via script)* | `pricePerShare` rises above 1.00 |
| 5 | Click ↻ Refresh in Stats Bar | New `pricePerShare` visible |
| 6 | Vault → Redeem all fbUSDC | Receive more USDC than deposited |

**What it proves:** ERC4626 share accounting is correct. Passive yield is captured without any lock commitment. Strategy / Metrics section shows asset split.

---

## Scene B — Long-Term Committed User (Gold Lock)

> **Reviewer path:** inspect the pre-seeded Alice position in the **Demo State** section (read-only, no wallet needed).
> **Operator/guided path:** run the full lifecycle with Alice's key as described below.

**Goal:** Show RWT issuance, fee rebate accrual, maturity, unlock.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Connect wallet (Alice's key required for operator path) | — |
| 2 | Vault → Mint 1,000 USDC → button auto-switches Approve USDC → Deposit | Receive fbUSDC |
| 3 | Lock → Select **Gold (180 days)** → button auto-switches Approve fbUSDC → Lock + Earn RWT | Lock created; RWT issued immediately |
| 4 | Incentive section | RWT balance increased |
| 5 | State section | State: **Locked (Accumulating)** |
| 6 | Lock row → Claim Rebate | fbUSDC rebate from treasury |
| 7 | *(Full lifecycle: run Option A local demo — `evm_increaseTime` advances past unlockAt)* | State: **Matured** |
| 8 | Lock row → Unlock | Shares returned to wallet |
| 9 | Vault → Redeem | USDC out > USDC in |

**What it proves:** Upfront RWT incentive, linear fee rebate, full lock lifecycle. Maturity/unlock on testnet requires real time; use the local script demo for end-to-end.

---

## Scene C — Beneficiary Continuity Path

> **Reviewer path:** inspect the pre-seeded Carol/Bob positions in the **Demo State** section (read-only, no wallet needed). Carol shows as inactive with a claimed lock; Bob shows as beneficiary.
> **Operator/guided path:** replay the full path with Carol's and Bob's keys as described below.

**Goal:** Show beneficiary designation and lock inheritance on inactivity.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Connect Carol's wallet (operator path) | — |
| 2 | Vault → Deposit 500 USDC → Lock → Silver (90 days) | Carol has active lock |
| 3 | Beneficiary → Set Bob as beneficiary | `beneficiaryOf(carol)` = Bob |
| 4 | *(Admin runs `adminMarkInactive(carol)` via Hardhat script)* | Carol marked inactive |
| 5 | Connect Bob's wallet | — |
| 6 | Beneficiary → Enter Carol's address + Carol's lock ID → Execute Claim | Lock ownership transferred to Bob |
| 7 | Demo State section → inspect Carol and Bob | Carol: claimed=Yes; Bob: lock visible |
| 8 | *(After maturity)* Bob → Unlock → Redeem | Bob receives Carol's locked fbUSDC |

**What it proves:** Beneficiary designation, admin-triggered inactivity, on-chain lock ownership transfer. Free fbUSDC is not automatically transferred (known limitation).

---

## Seeded Demo State (Read-Only)

After running `seed_v2.ts`, the **Demo State** section auto-populates with pre-seeded positions:

| Persona | Scenario |
|---------|----------|
| Alice | Scene B — Gold 180d lock, LockedAccumulating |
| Bob | Scene A/C — free fbUSDC holder, Carol's beneficiary |
| Carol | Scene C — Silver 90d lock, admin-marked inactive |

Reviewers can inspect these without connecting or controlling those wallets.

---

## Running Locally (Full Lifecycle Script)

For maturity/unlock in a single session — runs in Hardhat's in-process EVM:

```bash
npx hardhat run scripts/v2/run_demo.ts
```

No node to start, no `.env` required. Uses `evm_increaseTime` to advance past lock maturity. Covers all three scenes end-to-end.

For local frontend + manual interaction (connect frontend to a local node), see `docs/FRONTEND_DEMO_GUIDE.md → Local Hardhat node`.
