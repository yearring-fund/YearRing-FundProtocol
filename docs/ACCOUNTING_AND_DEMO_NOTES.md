# Accounting and Demo Notes

> ph_04 output — testing and accounting isolation audit for V2 demo build.

---

## 1. Risk Check Summary

### Check 1 — totalAssets self-consistency ✅

`FundVaultV01.totalAssets()` = USDC held in vault + assets managed by strategy.

All three V2 paths (`lockWithReward`, `claimRebate`, `earlyExitWithReturn`) are pure ERC20 transfers of fbUSDC shares. No USDC moves in or out of the vault in any V2 path. `totalAssets()` is unaffected.

**Covered by:** `Accounting.test.ts` Groups 1–3.

---

### Check 2 — shares / NAV integrity ✅

No V2 path mints or burns shares. `totalSupply()` is invariant across all V2 operations. `pricePerShare()` = `convertToAssets(10^18) / 10^18` is therefore stable.

RWT is a separate ERC20 (RewardToken.sol). Its issuance and return do not touch the vault at all.

**Covered by:** `Accounting.test.ts` Groups 1–3.

---

### Check 3 — free / locked switch correctness ✅ (with fix)

**Normal paths:**
- `lockWithReward`: shares move `user → LockLedger`. `vault.balanceOf(user)` decreases. `ledger.totalLockedShares()` increases.
- `unlock()`: shares move `LockLedger → user`. Inverse of above.
- `earlyExitFor`: same as unlock, marks `earlyExited = true`.

**Beneficiary path (bug found and fixed):**

`transferLockOwnership` intentionally does NOT update `_activeLockCount` for either party (design: inherited locks don't occupy the new owner's slot capacity; points stay with original owner).

However, `unlock()` and `_earlyExit()` unconditionally decremented `_activeLockCount[owner]`, causing an arithmetic underflow when a beneficiary (whose counter was never incremented) called `unlock()` on an inherited lock.

**Fix applied:** Added a guard `if (_activeLockCount[owner] > 0)` before the decrement in both `unlock()` and `_earlyExit()`.

**Covered by:** `Beneficiary.test.ts` "new owner (bob) can unlock after maturity" (was failing, now passes). `Accounting.test.ts` Group 6.

---

### Check 4 — RWT issuance isolated from asset accounting ✅

RWT is transferred `treasury → user` at lock time. RWT is returned `user → treasury` on early exit. Neither operation touches the vault or USDC.

`issuedRewardTokens[lockId]` is cleared to 0 after early exit — no double-counting possible.

**Covered by:** `Accounting.test.ts` Group 3.

---

### Check 5 — fee discount only affects fee, not asset accounting ✅

`_calcRebate()` computes:

```
rebate = shares × mgmtFeeBps × discountBps × elapsed
         / (BPS² × SECONDS_PER_MONTH)
```

This is a pure calculation on the locked shares amount. The rebate is paid as `treasury → user` share transfer. It does not modify vault USDC balances or share supply. `mgmtFeeBps` is read from the vault via `staticcall`; writing it does not affect vault accounting.

**Covered by:** `Accounting.test.ts` Group 2.

---

### Check 6 — beneficiary claim asset attribution ✅ (new tests added)

`executeClaim` calls `ledger.transferLockOwnership(lockId, beneficiary)`. This is a metadata update only:
- `pos.owner` changes from original owner to beneficiary.
- `pos.shares` is unchanged.
- `totalLockedShares` is unchanged.
- `vault.totalAssets()` is unchanged.
- `vault.totalSupply()` is unchanged.

After inheritance, when the beneficiary calls `unlock()`, shares move `LockLedger → beneficiary`. This is a standard share transfer; vault accounting remains unaffected.

**V2 Known Limitation:** Free fbUSDC of the original owner is NOT transferred on-chain. `executeClaim` records a `BeneficiaryClaimed` event only. Off-chain tooling or a separate manual transfer is required for free balance transfer. This is intentional and documented.

**Covered by:** `Accounting.test.ts` Group 6 (new).

---

### Check 7 — strategy yield → user asset display ✅

When `DummyStrategy.simulateYield()` is called, the strategy's `totalUnderlying` increases. `StrategyManagerV01.totalManagedAssets()` reads this value. `FundVaultV01.totalAssets()` = vault USDC + `strategyManager.totalManagedAssets()`. Therefore `pricePerShare()` increases proportionally.

Users' locked shares (fbUSDC) gain USDC value automatically because `convertToAssets(lockedShares)` uses the updated NAV. The RWT reward was issued at lock time using the NAV at that moment — this is correct behavior, not a bug.

**Covered by:** `Integration.test.ts`.

---

## 2. Bugs Found and Fixed

| # | Severity | Description | Fix |
|---|---|---|---|
| 1 | **Critical** | `lock()` API renamed to `lockFor(owner, shares, duration)` — 70 test helpers still called old name | Renamed in `LockLedger.test.ts`, `Beneficiary.test.ts`, `UserState.test.ts`, `LockBenefit.test.ts`, `LockPoints.test.ts` |
| 2 | **Bug** | `unlock()` and `_earlyExit()` unconditionally decrement `_activeLockCount`, causing arithmetic underflow when a beneficiary unlocks an inherited lock | Added guard `if (_activeLockCount[owner] > 0)` in both paths in `LockLedgerV02.sol` |
| 3 | **Test accuracy** | `Beneficiary.test.ts` asserted `activeLockCount` decreases for original owner and increases for beneficiary after `transferLockOwnership` — contract intentionally does neither | Fixed assertion to verify counters remain unchanged (matches NatSpec) |

---

## 3. New Tests Added

**`Accounting.test.ts` — Group 6: Beneficiary claim accounting isolation (7 new tests)**

| Test | What it proves |
|---|---|
| `vault.totalAssets() unchanged after executeClaim` | Ownership transfer is pure metadata |
| `vault.totalSupply() unchanged after executeClaim` | No mint/burn in beneficiary path |
| `ledger.totalLockedShares() unchanged after executeClaim` | Shares stay physically in ledger |
| `lock pos.owner changes to bob, shares field unchanged` | Only ownership metadata changes |
| `pricePerShare() unchanged after executeClaim` | NAV stable through inheritance |
| `vault.totalAssets() unchanged when bob unlocks inherited lock after maturity` | End-to-end: even after unlock, vault accounting is unaffected |
| `free shares of alice are NOT transferred by executeClaim` | Known V2 design — event only |

---

## 4. Required View Functions

The following view functions are missing and would be needed for a complete frontend implementation:

| Function | Contract | Purpose | Priority |
|---|---|---|---|
| `userLockedSharesOf(address user)` | `LockLedgerV02` | Aggregate of all active lock shares for a user. Currently the frontend must iterate `userLockIds` and sum — no single-call equivalent. | **High** — needed for user balance display |
| `userFreeAndLockedShares(address user)` | New helper or frontend aggregation | Returns `(freeShares, lockedShares)` in one call. Convenience wrapper for balance panel. | Medium — can be done client-side |
| `totalUserAssetsUSDC(address user)` | New helper or frontend calc | Returns USDC value of user's total (free + locked) shares via `convertToAssets`. Needed for NAV display. | Medium — can be done client-side |

**Note:** For the current testnet demo, the frontend can aggregate these values with multiple calls to `vault.balanceOf(user)`, `ledger.userLockIds(user)`, `ledger.getLock(id)`, and `vault.convertToAssets(shares)`. Adding `userLockedSharesOf` to `LockLedgerV02` would be the highest-impact single addition.

---

## 5. Accounting Isolation Summary

All V2 paths are pure ERC20 transfers. The vault's accounting invariants hold:

```
totalAssets  = constant  (through all V2 share transfers)
totalSupply  = constant  (through all V2 share transfers)
pricePerShare = totalAssets / totalSupply = constant (through all V2 share transfers)
```

The vault accounting is only affected by:
- USDC deposits / redeems (FundVaultV01 deposit/withdraw paths)
- Management fee accrual (FundVaultV01 internal)
- Strategy yield / loss (StrategyManagerV01 + strategy)

V2 share movements:

| Path | Source → Dest | Vault Impact |
|---|---|---|
| `lockWithReward` | user → LockLedger | None |
| `claimRebate` | treasury → user | None |
| `earlyExitWithReturn` | LockLedger → user (+ treasury → user rebate + user → treasury RWT) | None |
| `unlock` (maturity) | LockLedger → user | None |
| `executeClaim` (ownership) | metadata only | None |
| `executeClaim` + `unlock` (beneficiary matures) | LockLedger → beneficiary | None |

---

## 6. Known Limitations (V2 Demo)

1. **Free fbUSDC not transferred on-chain in beneficiary claim.** `executeClaim` emits `BeneficiaryClaimed` but does not call `vault.transfer()` for free shares. Frontend should display this as "off-chain claim required" or instruct the user to transfer manually.

2. **`activeLockCount` for beneficiary-inherited locks is stale.** After `transferLockOwnership`, the counter for the original owner remains incremented (occupying a slot). The new owner's counter is not incremented (no slot consumed). This is intentional — it prevents slot exhaustion by adversarial inheritance — but the original owner loses one lock slot permanently.

3. **RWT reward is computed from NAV at lock time.** If strategy yield doubles the NAV after the lock is created, the issued RWT is not retroactively adjusted. This is the correct behavior for an upfront issuance model.

4. **`checkClaimRebate` and `checkEarlyExit` return `(0, 0, 0)` for inherited locks.** Because `lastRebateClaimedAt` is keyed by `lockId`, the beneficiary who inherits a lock can still call `claimRebate`, but only `LockRewardManagerV02` checks `pos.owner == msg.sender` — meaning the original rebate entitlement is lost after ownership transfer. Document this in the demo script.
