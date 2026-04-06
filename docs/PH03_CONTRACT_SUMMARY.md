# PH03 — Contract Layer Summary

> All A–G capabilities required by ph_03 are implemented in the existing contracts.
> Zero new contracts at ph_03 stage. No NAV impact.
> Note: ph_04 subsequently fixed one contract bug (LockLedgerV02) and corrected test helpers across 5 files.

---

## Decision Log

### Demo short-duration parameters (ph_03 B)

**Decision: no contract change.**

`LockBenefitV02` tier boundaries remain at production ranges (30 / 90 / 180 days).
Testnet demo scripts pre-seed lock positions in the required lifecycle states
(active, matured, early-exited) so that live demo can demonstrate each path
without waiting for real time to pass.

The seed script is responsible for setting up these states at deploy time.

### Single active lock per user (ph_03 A)

**Decision: no contract change.**

`MAX_ACTIVE_LOCKS_PER_USER = 5` is unchanged.
Demo scripts and frontend present the single-lock flow.
Multi-lock capability is a protocol feature, not a demo constraint.

---

## A–G Capability Map

### A. Lock Ledger

| Capability | Contract | Function |
|---|---|---|
| free balance | `FundVaultV01` | `balanceOf(user)` |
| locked balance | `LockLedgerV02` | `getLock(id).shares` via `userLockIds(user)` |
| lock | `LockRewardManagerV02` | `lockWithReward(shares, duration)` |
| unlock (maturity) | `LockLedgerV02` | `unlock(lockId)` |

### B. Lock Tier

| Capability | Contract | Function |
|---|---|---|
| tier from duration | `LockBenefitV02` | `tierFromDuration(duration)` |
| tier of lock | `LockBenefitV02` | `tierOf(lockId)` |
| multiplier | `LockBenefitV02` | `multiplierOf(lockId)` |
| fee discount | `LockBenefitV02` | `feeDiscountBpsOf(lockId)` |

### C. Incentive Integration

| Layer | Contract | Function |
|---|---|---|
| RWT issued | `LockRewardManagerV02` | `issuedRewardTokens(lockId)` |
| RWT return on exit | `LockRewardManagerV02` | `earlyExitWithReturn(lockId)` |
| Fee rebate preview | `LockRewardManagerV02` | `previewRebate(lockId)` |
| Fee rebate claim | `LockRewardManagerV02` | `claimRebate(lockId)` |
| Preflight checks | `LockRewardManagerV02` | `checkClaimRebate(lockId)` / `checkEarlyExit(lockId)` |

### D. User State

| State | Condition |
|---|---|
| `Normal` | No active locks, or all positions unlocked |
| `LockedAccumulating` | At least one lock before maturity |
| `Matured` | At least one lock past `unlockAt`, not yet unlocked |
| `EarlyExit` | Position exited early |

Contract: `UserStateEngineV02.userStateOf(address)` / `lockStateOf(lockId)`

### E. Early Exit

| Capability | Contract | Function |
|---|---|---|
| Exit before maturity | `LockRewardManagerV02` | `earlyExitWithReturn(lockId)` |
| Shares returned to user | `LockLedgerV02` | internal via `earlyExitFor` |
| RWT return required | `LockRewardManagerV02` | full `issuedRewardTokens(lockId)` amount |
| Preflight | `LockRewardManagerV02` | `checkEarlyExit(lockId)` |

No penalty vault. No complex fee logic. RWT return is the only exit cost.

### F. Beneficiary

| Capability | Contract | Function |
|---|---|---|
| Set | `BeneficiaryModuleV02` | `setBeneficiary(address)` |
| Update | `BeneficiaryModuleV02` | `updateBeneficiary(address)` |
| Revoke | `BeneficiaryModuleV02` | `revokeBeneficiary()` |
| Claim | `BeneficiaryModuleV02` | `executeClaim(owner, lockIds[])` |
| Demo trigger | `BeneficiaryModuleV02` | `adminMarkInactive(address)` |
| Query | `BeneficiaryModuleV02` | `beneficiaryOf(user)` / `isInactive(user)` / `claimed(user)` |

### G. Read Views + Events

**Key read views for frontend:**

| View | Contract |
|---|---|
| `totalAssets()` / `totalSupply()` / `pricePerShare()` | `FundVaultV01` |
| `balanceOf(user)` | `FundVaultV01` |
| `getLock(id)` / `userLockIds(user)` / `activeLockCount(user)` | `LockLedgerV02` |
| `tierOf(id)` / `feeDiscountBpsOf(id)` / `multiplierOf(id)` | `LockBenefitV02` |
| `previewRebate(id)` / `issuedRewardTokens(id)` | `LockRewardManagerV02` |
| `checkClaimRebate(id)` / `checkEarlyExit(id)` | `LockRewardManagerV02` |
| `userStateOf(address)` / `lockStateOf(id)` | `UserStateEngineV02` |
| `beneficiaryOf(user)` / `isInactive(user)` / `claimed(user)` | `BeneficiaryModuleV02` |
| `snapshot()` | `MetricsLayerV02` |

**Events emitted on main paths:**

| Event | Contract |
|---|---|
| `LockedWithReward(lockId, owner, shares, tokens)` | `LockRewardManagerV02` |
| `RebateClaimed(lockId, owner, rebateShares)` | `LockRewardManagerV02` |
| `EarlyExitExecuted(lockId, owner, tokensReturned)` | `LockRewardManagerV02` |
| `Locked(lockId, owner, shares, unlockAt)` | `LockLedgerV02` |
| `Unlocked(lockId, owner, shares)` | `LockLedgerV02` |
| `EarlyExited(lockId, owner, shares)` | `LockLedgerV02` |
| `BeneficiarySet(owner, beneficiary)` | `BeneficiaryModuleV02` |
| `BeneficiaryClaimed(owner, beneficiary, timestamp)` | `BeneficiaryModuleV02` |
| `LockInherited(owner, beneficiary, lockId)` | `BeneficiaryModuleV02` |

---

## File Changes

```
contracts/   zero changes at ph_03 stage
             (ph_04 fix: LockLedgerV02 activeLockCount underflow guard)
test/        zero changes at ph_03 stage
             (ph_04 fix: lock() → lockFor() in 5 test helpers; activeLockCount assertion corrected)
```

---

## Scripts Layer Requirements (Next Phase)

The seed script must pre-configure the following states for demo:

| Demo Path | Required Seed State |
|---|---|
| Path A | alice deposits, holds — no lock |
| Path B | bob deposits + locks (Gold) → advance time past unlockAt → position in Matured state |
| Path C | carol deposits + locks → set beneficiary → adminMarkInactive(carol) → ready for executeClaim |

Time advancement on testnet is not possible. The seed script must deploy and immediately
create positions that are already past maturity (by setting duration = minimum allowed,
then using a short absolute unlockAt in the future — or by accepting that Path B on testnet
shows the lock state rather than the full maturity flow end-to-end).

This is a scripts decision, not a contract decision.
