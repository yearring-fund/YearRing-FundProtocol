# YearRing Fund Protocol — Closed Beta Treasury Record

> Status: **PRE-DEPLOY** — live values marked [TBD] will be filled after mainnet deployment.
> Run `check_base_state.ts --network base` after setup to verify all fields.

---

## Contract Identity

| Field | Value |
|---|---|
| Contract | `TreasuryV02` |
| Address (Base) | `[TBD]` |
| Deployer / Admin | `[TBD]` |

---

## Scope Statement

**TreasuryV02 does NOT control user principal.**

The Treasury's authorized scope is strictly:

| Permitted | Not Permitted |
|---|---|
| Receive management fee shares minted by vault | Control user deposits or principal |
| Hold YRPTS premint (20M) | Call invest/divest on any strategy |
| Authorize rebate manager to pull yrCORE for rebates | Act as a DAO spending treasury |
| Authorize manager to pull YRPTS for lock issuance | Perform token buybacks |
| Track rebate spend against budget cap | Make native token distributions |
| Emit auditable events for all token movements | Operate as an investment vehicle |
| Emergency revoke outstanding allowances | — |

---

## Approved Assets

Assets registered via `setApprovedAsset(token, true)`:

| Token | Address | Purpose |
|---|---|---|
| yrCORE (YearRingCoreVaultV01) | `[TBD]` | Rebate payment asset — manager pulls from treasury to users |
| YRPTS (PointsToken) | `[TBD]` | Points issuance — manager pulls from treasury to users on lock |

---

## Approved Modules

Contracts registered via `setApprovedModule(module, true)`:

| Module | Address | Purpose |
|---|---|---|
| LockPointsRebateManagerV02 | `[TBD]` | Only module authorized to pull approved assets from treasury |

---

## Rebate Manager

Set via `setRebateManager(address)`:

| Field | Value |
|---|---|
| rebateManager | `LockPointsRebateManagerV02` — `[TBD]` |
| REBATE_MANAGER_ROLE granted | Yes (auto-granted by setRebateManager) |
| Purpose | Can call `recordRebateSpent()` to debit rebate budget |

---

## ERC20 Allowances (set via `approveSpender`)

| Token | Spender | Allowance | Purpose |
|---|---|---|---|
| yrCORE | LockPointsRebateManagerV02 | `MaxUint256` | Rebate payout: manager pulls yrCORE from treasury to users |
| YRPTS | LockPointsRebateManagerV02 | `MaxUint256` | Points issuance: manager pulls YRPTS from treasury to users on lock |

> `MaxUint256` allowances are standard ERC20 practice. Real caps enforced by `rebateBudgetOf`.

---

## Rebate Budget

Set via `setRebateBudget(asset, amount)`:

| Asset | Budget | Spent (post-deploy) | Remaining |
|---|---|---|---|
| yrCORE | `MaxUint256` (unlimited for closed beta) | `[TBD — 0 at deploy]` | `[TBD]` |

> **Production note:** Set a finite budget cap to limit maximum fee rebate exposure.
> `MaxUint256` is used for closed beta only. Budget is further constrained by the actual
> yrCORE balance held in Treasury (only accrues via management fee minting).

---

## Treasury Balances (at deploy, before any user activity)

| Token | Balance |
|---|---|
| yrCORE (YearRingCoreVaultV01) | `0` — accrues from management fee minting |
| YRPTS (PointsToken) | `20,000,000 YRPTS` — full supply preminted at deploy |
| USDC | `0` — treasury does not hold USDC |

---

## Points Issuance Flow

```
User calls manager.lockWithPoints(shares, duration)
  → manager checks: pointsToken.allowance(treasury, manager) >= points
  → manager calls: pointsToken.safeTransferFrom(treasury, user, points)
  → manager records: issuedPoints[lockId] = points
  (Treasury YRPTS decreases; user YRPTS increases)
```

On earlyExit:
```
User approves: pointsToken.approve(manager, issuedPoints[lockId])
User calls: manager.earlyExit(lockId)
  → manager calls: pointsToken.safeTransferFrom(user, treasury, points)
  (User YRPTS decreases; Treasury YRPTS increases — points returned)
```

On normal maturity unlock:
```
User calls: ledger.unlock(lockId)
  → user keeps all issued YRPTS (no return required)
```

---

## Rebate Flow

```
Management fee accrues over time:
  vault.accrueManagementFee()
    → mints yrCORE shares to TreasuryV02 (fee ≈ 4 bps/month of TVL)

User claims rebate:
  user calls: manager.claimRebate(lockId)
    → manager calculates: rebate = shares × 4bps × discountBps × elapsed / (10000 × 10000 × 30d)
    → manager calls: vaultShares.safeTransferFrom(treasury, user, rebateShares)
    → manager calls: treasury.recordRebateSpent(yrCORE, user, rebateShares)
    (Treasury yrCORE decreases; user yrCORE increases)
```

---

## Emergency Revoke Capability

`TreasuryV02` supports emergency allowance revocation:

```solidity
function emergencyRevokeAllowance(address token, address spender)
    external onlyRole(EMERGENCY_ROLE)
```

This can be called by the Guardian to immediately revoke any outstanding ERC20 allowance from the treasury to any spender, stopping further pulls even if the manager is compromised.

---

## Post-Deploy Treasury Verification

Run `check_base_state.ts --network base` and confirm Section C outputs:

- [ ] Treasury YRPTS balance = 20,000,000 ✓
- [ ] yrCORE allowance (→ manager) = MaxUint256 ✓
- [ ] YRPTS allowance (→ manager) = MaxUint256 ✓
- [ ] Rebate budget set (> 0) ✓
- [ ] Treasury USDC balance = 0 ✓

---

*This document is part of the closed beta audit trail.*
