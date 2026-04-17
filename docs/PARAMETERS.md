# Protocol Parameters

> Demo build parameters. All values are set at deploy/setup time.
> Source of truth: `scripts/config.ts` and `scripts/v2/setup_v2.ts`.

---

## Commitment Tiers

Defined in `LockBenefitV02.sol`. Tier is derived from lock duration at lock time.

| Tier | Duration Range | RWT Multiplier | Fee Discount |
|------|---------------|----------------|--------------|
| Bronze | [30 days, 90 days) | 1.0× (10,000 bps) | 20% (2,000 bps) |
| Silver | [90 days, 180 days) | 1.3× (13,000 bps) | 40% (4,000 bps) |
| Gold | [180 days, 365 days] | 1.8× (18,000 bps) | 60% (6,000 bps) |

The demo UI exposes exactly these three durations: 30 days (Bronze), 90 days (Silver), 180 days (Gold).

---

## RWT Issuance Formula

Defined in `LockRewardManagerV02.sol`.

```
RWT issued = lockedUSDCValue × durationDays × multiplierBps
             ─────────────────────────────────────────────────
                           REWARD_DENOMINATOR

REWARD_DENOMINATOR = 10,000 × 500 = 5,000,000
```

Where:
- `lockedUSDCValue` = `vault.convertToAssets(lockedShares)` — in USDC (6 decimals)
- `durationDays` = lock duration in whole days
- `multiplierBps` = tier multiplier in basis points (10,000 / 13,000 / 18,000)
- Result is scaled to 18 decimals via `USDC_TO_TOKEN_SCALE = 10^12`

**Calibration:** 1 USDC locked for 1 day at Bronze tier (1.0×) = 0.002 RWT.

**Example:** 1,000 USDC × 180 days × 18,000 (Gold) / 5,000,000 = **648 RWT** issued upfront.

---

## Fee Rebate

Defined in `LockRewardManagerV02.sol`.

```
Rebate accrued = mgmtFeeBpsPerMonth × lockedShares × elapsedSeconds
                 ──────────────────────────────────────────────────────
                              10,000 × SECONDS_PER_MONTH
```

- Accrues linearly from `lockedAt` to `unlockAt`
- Paid in fbUSDC shares from the treasury
- Claimable at any time via `claimRebate(lockId)`
- Resets on each claim (`lastRebateClaimedAt` updated)

---

## Management Fee

Set in `scripts/config.ts`, applied via `deploy.ts` or `setup_v2.ts` on `FundVaultV01`.

| Parameter | Value |
|-----------|-------|
| `mgmtFeeBpsPerMonth` | **9 bps/month (~1.08% annualized)** |
| `MAX_MGMT_FEE_BPS_PER_MONTH` | 200 bps/month (hard cap, contract-enforced) |

Fee accrues to treasury as fbUSDC share dilution. It does not affect `totalAssets` or `pricePerShare` directly — it accrues as treasury shares.

---

## Vault Configuration

Set in `deploy.ts` on `FundVaultV01`.

| Parameter | Value | Description |
|-----------|-------|-------------|
| `reserveRatioBps` | 3,000 bps (30%) | Minimum vault liquidity ratio — 30% of assets kept in vault |
| Asset token | MockUSDC (6 dec) | Demo uses publicly mintable MockUSDC on Base Sepolia |
| Share token | fbUSDC (18 dec) | `_decimalsOffset() = 12` — vault shares have 18 decimals |

---

## RewardToken

| Parameter | Value |
|-----------|-------|
| Symbol | RWT |
| Decimals | 18 |
| Total supply | **1,000,000 RWT** — pre-minted to treasury at deploy |
| Mint function | None — supply is permanently fixed |
| Snapshot | Supported (via `ERC20Snapshot`) — for governance signal use |

---

## Early Exit Rules

Defined in `LockRewardManagerV02.sol`.

| Rule | Value |
|------|-------|
| Principal | Returned in full — no haircut on shares |
| RWT | Must be returned in full (all `issuedRewardTokens[lockId]`) |
| Accrued rebate | Auto-settled and paid to user before exit (already-claimed rebate is also kept) |
| Availability | Callable any time before `unlockAt` |

User must `approve` RWT to `LockRewardManagerV02` before calling `earlyExitWithReturn`.

---

## Beneficiary Rules

Defined in `BeneficiaryModuleV02.sol`.

| Rule | Value |
|------|-------|
| Inactivity threshold | **365 days** from last `heartbeat()` |
| Heartbeat | Only `heartbeat()` resets the timer — no other protocol action does |
| Admin override | `adminMarkInactive(address)` — for demo and oracle integration |
| What is transferred | Locked positions only (`transferLockOwnership` per lock ID) |
| What is NOT transferred | Free fbUSDC wallet balance |
| Claim limit | One claim per original owner (`_claimed` flag) |
| Max active locks | **5 per address** — attempting a 6th reverts with `TooManyActiveLocks` |
