# PH02 — Contract Feature Audit

> Output of ph_02 review: contract capability check against testnet demo requirements.
>
> Result: zero contract changes needed at ph_02 stage. All 13 required capabilities were already implemented.
> Note: ph_04 subsequently identified and fixed one contract bug (LockLedgerV02 activeLockCount underflow on beneficiary unlock).

---

## Capability Checklist

| # | Capability | Status | Notes |
| --- | --- | --- | --- |
| 1 | free / locked dual balance | ✅ | `vault.balanceOf(user)` = free; `ledger.getLock` aggregated = locked; frontend reads both |
| 2 | single active lock position | ✅ | MAX_ACTIVE_LOCKS = 5; demo scripts use 1; no contract change needed |
| 3 | lock | ✅ | `LockRewardManagerV02.lockWithReward()` |
| 4 | unlock (at maturity) | ✅ | `LockLedgerV02.unlock(lockId)` — called directly on ledger, not via manager |
| 5 | fixed lock tiers | ✅ | `LockBenefitV02`: Bronze / Silver / Gold; demo short-duration params set in setup script |
| 6 | RWT reward path | ✅ | lockWithReward issues + earlyExitWithReturn recovers + issuedRewardTokens for query |
| 7 | fee rebate path | ✅ | claimRebate + previewRebate + checkClaimRebate (requires treasury pre-approval) |
| 8 | user state query | ✅ | UserStateEngineV02 returns LockState enum; balances and tier read separately by frontend |
| 9 | early exit | ✅ | earlyExitWithReturn + checkEarlyExit preflight |
| 10 | beneficiary set and claim | ✅ | setBeneficiary / executeClaim / adminMarkInactive (demo inactivity trigger) |
| 11 | strategy demo loop | ✅ | DummyStrategy in `contracts/mocks/` with simulateYield + simulateLoss |
| 12 | frontend read views | ✅ | All key views exist; frontend aggregates with multiple reads |
| 13 | sufficient events | ✅ | All main-path events present across contracts |

---

## Module Responsibility Boundaries (Demo View)

| Module | Demo Role | Out of Scope |
| --- | --- | --- |
| `FundVaultV01` | deposit / redeem / pricePerShare / totalAssets | No lock, tier, or RWT awareness |
| `StrategyManagerV01` + `DummyStrategy` | invest / simulateYield / totalUnderlying | Does not touch vault accounting directly |
| `RewardToken` | RWT balance / ERC20Snapshot | No reward issuance logic |
| `LockLedgerV02` | fbUSDC custody / unlock / earlyExitFor | No RWT, tier, or rebate awareness |
| `LockBenefitV02` | Pure view: tier classification + discount rate | No state writes |
| `LockRewardManagerV02` | Lock entry point / claimRebate / earlyExitWithReturn | Does not directly touch vault accounting |
| `BeneficiaryModuleV02` | setBeneficiary / executeClaim / adminMarkInactive | Free fbUSDC not transferred on-chain (event only) |
| `UserStateEngineV02` | Returns LockState enum (Normal / LockedAccumulating / Matured / EarlyExit) | Does not return balance struct |
| `MetricsLayerV02` | Single snapshot(): TVL / lockedShares / lockedRatio / totalLocksEver | Tier breakdown is off-chain |

---

## rewardWeight / lockWeight

Not needed. Equivalent internal parameters already exist:

- `LockBenefitV02.multiplierBps` — serves as lockWeight for RWT issuance
- `LockBenefitV02.feeDiscountBps` — fee rebate rate
- `LockPointsV02` time-weighted score — exists internally, not exposed in demo

No new rewardWeight / lockWeight variables required.

---

## Do Not Touch

| Contract / Area | Reason |
| --- | --- |
| `FundVaultV01` core accounting (totalAssets / deposit / redeem / _decimalsOffset) | V01 main path, 148 tests passing; any change risks NAV breakage |
| `StrategyManagerV01` invest / divest / totalManagedAssets | Affects vault.totalAssets() |
| `LockLedgerV02` share custody logic | Core lock accounting; entire V02 stack depends on it |
| `RewardToken` supply / mint logic | Fixed supply; must not be inflated |
| All tested interface signatures | Changing signatures breaks typechain, scripts, and frontend wiring |

---

## Test Coverage

All 13 capabilities are covered by existing tests. Zero new tests needed at the contract layer.

| Test File | Coverage |
| --- | --- |
| `LockRewardManager.test.ts` | lock / RWT issuance / early exit |
| `Accounting.test.ts` | claimRebate / earlyExitWithReturn / accounting isolation |
| `UserState.test.ts` | LockState transitions |
| `EarlyExit.test.ts` | Early exit path |
| `Beneficiary.test.ts` | setBeneficiary / executeClaim / adminMarkInactive |
| `DummyStrategy.test.ts` + `Integration.test.ts` | Strategy demo loop |
| `LockLedger.test.ts` | Lock custody / unlock |

---

## Setup Script Requirements (Not Contract Issues)

The following are not contract bugs but must be handled in `scripts/setup.ts`, or demo calls will silently fail:

1. **Treasury must pre-approve manager for fbUSDC** — required for claimRebate path
2. **Treasury must pre-approve manager for RWT** — required for lockWithReward path
3. **DummyStrategy is in `contracts/mocks/`** — deploy_v2.ts deploys from mocks; no logic impact
4. **BeneficiaryModuleV02 does not transfer free fbUSDC on-chain** — executeClaim transfers lock positions only; free balance stays; document in KNOWN_LIMITATIONS.md
5. **unlock calls `ledger.unlock()` directly** — frontend ABI must include ledger, not only manager

---

## Conclusion

**Zero contract changes at ph_02 stage. Zero test changes at ph_02 stage.**

All required demo capabilities were implemented and tested. ph_04 subsequently fixed one contract bug in LockLedgerV02 and corrected test helpers in 5 test files. See `docs/ACCOUNTING_AND_DEMO_NOTES.md` for full ph_04 change log.
