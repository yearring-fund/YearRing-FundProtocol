# BeneficiaryModuleV02 — Beneficiary Model

## Positioning

A standalone thin-layer module that tracks user activity and executes inheritance
when a user becomes inactive. Non-invasive: reads no external state, modifies no
accounting, does not affect NAV or totalAssets.

---

## Inheritance Rules

| Asset Type | V2 Behaviour |
|---|---|
| Locked positions (fbUSDC in LockLedger) | Transferred on-chain — lock state fully preserved |
| Free fbUSDC shares (in wallet) | Recorded via event only — no on-chain transfer in V2 |
| Points (LockPointsV02) | Never transferred — remain permanently with original owner |

---

## Trigger Scheme (B: Time-Based Inactivity + Admin Override)

| Condition | Details |
|---|---|
| Inactivity threshold | 365 days (aligned with `MAX_LOCK_DURATION`) |
| Timer source | `lastActiveAt[user]` — updated ONLY by explicit user actions |
| Admin override | `adminMarkInactive(user)` bypasses time check (oracle / test use) |
| Never interacted | `lastActiveAt == 0` → NOT considered inactive (safe default) |

---

## Heartbeat Design

`heartbeat()` is the **only** action that resets the inactivity timer.
Other protocol operations (deposit, lock, redeem, claim, etc.) do **not** reset it.
This keeps `BeneficiaryModuleV02` fully independent and non-invasive.

**Actions that update `lastActiveAt`:**

| Action | Updates Timer |
|---|---|
| `heartbeat()` | ✅ |
| `setBeneficiary()` | ✅ |
| `updateBeneficiary()` | ✅ |
| `revokeBeneficiary()` | ✅ |
| Any other protocol action | ❌ (intentional) |

---

## Default Beneficiary

`beneficiaryOf(user)` returns the user's own address if no beneficiary is set.
Self-claim is blocked — `executeClaim` reverts when `beneficiaryOf(user) == user`.

This means:
- All users have safe defaults (no beneficiary = no one can claim against them)
- Inheritance opt-in requires explicit `setBeneficiary()` call

---

## Lock Inheritance Mechanics

When `executeClaim(originalOwner, lockIds)` is called:

1. **Validation**: user inactive + caller is beneficiary + not already claimed
2. **For each lockId**: if `pos.owner == originalOwner && !pos.unlocked`
   → `ledger.transferLockOwnership(lockId, beneficiary)` (OPERATOR_ROLE)
3. **Lock state preserved**: `unlockAt`, `shares`, `lockedAt` all unchanged
4. **`_userLockIds` not modified**: points remain with original owner
5. **`_activeLockCount` updated**: decremented for old owner, incremented for new owner
6. **New owner can `unlock(lockId)` directly** after maturity

```
executeClaim(alice, [lockId1, lockId2])
  │
  ├── isInactive(alice) == true ✓
  ├── beneficiaryOf(alice) == bob ✓
  ├── msg.sender == bob ✓
  │
  ├── ledger.transferLockOwnership(lockId1, bob) → pos.owner = bob
  ├── emit LockInherited(alice, bob, lockId1)
  ├── ledger.transferLockOwnership(lockId2, bob) → pos.owner = bob
  ├── emit LockInherited(alice, bob, lockId2)
  │
  └── emit BeneficiaryClaimed(alice, bob, timestamp)
```

---

## Points Non-Transfer Guarantee

`LockPointsV02.totalPointsOf(owner)` iterates `ledger.userLockIds(owner)`.
`transferLockOwnership` does **not** modify `_userLockIds` — therefore:

- `totalPointsOf(originalOwner)` continues to include all inherited lockIds ✅
- `totalPointsOf(beneficiary)` does not include inherited lockIds ✅
- Points from the inherited lock freeze when beneficiary calls `unlock()` ✅

---

## Contract Interface

```solidity
// User actions
function setBeneficiary(address beneficiary) external;
function updateBeneficiary(address newBeneficiary) external;
function revokeBeneficiary() external;
function heartbeat() external;

// Beneficiary action
// lockIds: active lock positions to inherit (empty = free-assets-only claim)
function executeClaim(address originalOwner, uint256[] calldata lockIds) external;

// Admin (oracle / testing)
function adminMarkInactive(address user) external;
function adminUnmarkInactive(address user) external;

// Views
function beneficiaryOf(address user) external view returns (address);
function isInactive(address user) external view returns (bool);
function lastActiveAt(address user) external view returns (uint64);
function claimed(address user) external view returns (bool);
function adminMarked(address user) external view returns (bool);
```

---

## Security Considerations

- No assets held in this contract — claim execution risk is zero.
- Admin can only mark/unmark inactive; cannot redirect beneficiary or access assets.
- `lastActiveAt == 0` safe default: users who never interacted are NOT inactive.
- `_userLockIds` immutability ensures points cannot be transferred by design.
- Lock ownership transfer requires OPERATOR_ROLE on LockLedger — only this module holds it.
