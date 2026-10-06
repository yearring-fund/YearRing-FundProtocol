# YRFP V2.1 Pre-Deployment Architecture & Naming Review

**Date:** 2026-05-11  
**Reviewer:** Claude Code (automated contract review)  
**Spec:** `fd/YRFP_V2_1_PreDeployment_Architecture_Naming_Review.md`  
**Scope:** `contracts/v2_1/` — all Solidity source and interface files  
**Test suite baseline:** 471 passing, 0 failing

---

## Summary Verdict

| Category | Result |
|---|---|
| Architecture consistency | **PASS** |
| Naming consistency | **PARTIAL** — 2 comment-level V4 residues, no semantic impact |
| Accounting consistency | **PASS** |
| Permission boundary | **PASS** |
| Test coverage | **PASS** |
| Ready for deploy script | **YES** (pending operator address confirmation) |

---

## 1. Architecture Review

### 1.1 Vault Fee Isolation

**Result: PASS**

`YearRingCoreVaultV21.sol` contains zero fee-extraction logic. No management fee, no performance fee, no fee-on-deposit/redeem. All fee extraction is delegated to the strategy layers (CSM / HTM), keeping the vault's share math clean.

### 1.2 Reserve Band Constants

**Result: PASS**

`YearRingCoreVaultV21.sol:49-51`:
```solidity
uint256 public constant MIN_RESERVE_BPS   = 500;   // 5 %
uint256 public constant TARGET_RESERVE_BPS = 1_000; // 10 %
uint256 public constant MAX_RESERVE_BPS   = 1_500;  // 15 %
```

Constants are on-chain, non-configurable, and match the design spec. No admin setter exists for these values.

### 1.3 Pre-Pull Before Burn (Withdraw Path)

**Result: PASS**

`_withdraw()` at lines 264-274 correctly pulls USDC from the strategy **before** burning shares. Execution order:
1. Compute `strategyShortfall` = requested amount − vault idle balance
2. If shortfall > 0: call `coreStrategyManager.withdraw(strategyShortfall)`
3. Transfer assets to receiver
4. Burn shares

This prevents a burn-before-funds race condition.

### 1.4 Auto-Rebalance on Deposit and Redeem

**Result: PASS**

`_deposit()` hook calls `_autoRebalance()` at the end.  
`_withdraw()` hook calls `_autoRebalance()` at the end.  
`_autoRebalance()` pushes to CSM when reserve exceeds MAX (15%) and pulls from CSM when reserve falls below MIN (5%), targeting 10%.

### 1.5 CoreStrategyManager Fee Model

**Result: PASS**

`CoreStrategyManagerV21.sol`:
- `FEE_BPS = 50` (0.5%)
- Fee is applied as **share dilution** (mints fee shares to `feeReceiver`), not as USDC deduction
- No direct USDC transfers in fee logic
- `feeReceiver` is role-gated (`DEFAULT_ADMIN_ROLE`)

### 1.6 HighTierStrategyManager Fee Model

**Result: PASS**

`HighTierStrategyManagerV21.sol`:
- `managementFeeBpsPerYear = 100` (1% per year, closed beta value)
- `MAX_FEE_BPS = 2000` enforced on `setManagementFee()`
- Fee is applied as PPS dilution via HTM's internal share accounting
- `enter()` and `exit()` are guarded by `onlyLockManager` — cannot be called directly

### 1.7 LockManager Constraints

**Result: PASS**

`LockManagerV21.sol`:
- `MIN_COMMITTED_DURATION = 7 days` — enforced on lock creation
- `MIN_LOCK_ASSETS_USDC = 1e6` (1 USDC minimum)
- Eligibility gate: if `eligibilityModule == address(0)`, the check is skipped (open default for local/fork)
- Lock ID is auto-incremented; no overflow risk (uint256)
- Tier multiplier progression: Trial (1.0×) → Bronze (1.3×) → Silver (1.6×) → Gold (2.0×)

### 1.8 Treasury Safety

**Result: PASS**

`TreasuryV21.sol`:
- `withdrawRebate()` is the only outbound path and is guarded by `onlyRebateManager`
- No function allows withdrawal of user principal
- Treasury balance is solely funded by HTM fee proceeds routed by the keeper

### 1.9 PointsLedger Non-Transferability

**Result: PASS**

`PointsLedgerV01.sol`:
- Does **not** inherit `ERC20`
- No `transfer()`, `transferFrom()`, `approve()`, or `allowance()` functions
- `creditLock()` requires `POINTS_MINTER_ROLE`
- Points cannot be moved between addresses by any mechanism

### 1.10 EligibilityModule Pure View

**Result: PASS**

`EligibilityModuleV21.sol`:
- `canEnterManager()` is declared `view` — no state writes
- Returns `(bool ok, bytes32 reason)` tuple; never reverts
- 10 ordered checks; first failing check short-circuits with reason code
- No fund transfers, no lock modifications, no points mutations

### 1.11 PortfolioLens Read-Only

**Result: PASS**

`PortfolioLensV21.sol`:
- All external functions are `view` or `pure`
- No state-modifying calls anywhere in the contract
- `checkEligibility()` calls `eligibilityModule.canEnterManager()` which is itself `view`

---

## 2. Naming Consistency Review

### 2.1 Contract & Interface Name Alignment

**Result: PASS**

All V2.1 contracts use consistent `V21` suffix:

| Contract | Interface |
|---|---|
| `YearRingCoreVaultV21` | `IYearRingCoreVaultV21` |
| `CoreStrategyManagerV21` | `ICoreStrategyManagerV21` |
| `HighTierStrategyManagerV21` | `IHighTierStrategyManagerV21` |
| `LockManagerV21` | `ILockManagerV21` |
| `TreasuryV21` | `ITreasuryV21` |
| `EligibilityModuleV21` | `IEligibilityModuleV21` |
| `PointsLedgerV01` | `IPointsLedgerV01` |
| `AaveUSDCStrategyV21` | `IAaveUSDCStrategyV21` |
| `PortfolioLensV21` | — (no interface needed, consumer-facing only) |

### 2.2 Role Name Consistency

**Result: PASS**

All roles use the standard pattern `bytes32 public constant <ROLE>_ROLE`:
- `DEFAULT_ADMIN_ROLE` (inherited from OZ AccessControl)
- `EMERGENCY_ROLE`
- `KEEPER_ROLE`
- `REBATE_MANAGER_ROLE`
- `POINTS_MINTER_ROLE`
- `POINTS_BURNER_ROLE`
- `DISTRIBUTOR_ROLE`

No legacy V1 role names (`OPERATOR_ROLE`, `PROTOCOL_ROLE`, etc.) found.

### 2.3 V4 Naming Residues

**Result: PARTIAL — 2 comment-level occurrences**

Two comments reference "V4" in V2.1 source files. Neither affects ABI, bytecode, or business logic:

| File | Line | Content |
|---|---|---|
| `contracts/v2_1/YearRingCoreVaultV21.sol` | 372 | `/// No MAX_STRATEGY_DEPLOY_BPS cap in V4.` |
| `contracts/v2_1/interfaces/ILockManagerV21.sol` | 5 | `/// @notice Interface for the V4 lock contract.` |

**Recommendation:** Clean up before mainnet deploy to avoid confusion in audits. These are NatDoc comments — a one-line edit each.

### 2.4 Stale Token Naming Scan

**Result: PASS — No contamination found**

Searched all V2.1 source for legacy token/share names:

| Pattern | Found |
|---|---|
| `RWT` / `RewardToken` | No |
| `YRPTS` / `PointsToken` | No |
| `fbUSDC` | No |
| `yrCORE` / `feeShares` | No |
| `yUSDC` (old vault share name) | No |

Current share name is `yrUSDC` throughout — consistent with config and deploy script.

---

## 3. Accounting Consistency Review

### 3.1 PPS (Price Per Share) Mechanics

**Result: PASS**

- `pricePerShareRay = convertToAssets(1e18) * RAY / 1e18` — correctly scales to ray precision
- Seed deposit initializes PPS = 1.0 exactly (10 USDC deposited before any strategy deploy)
- Fee dilution (CSM/HTM) decreases outstanding shares' value proportionally — no rounding artifacts in normal operation

### 3.2 Reserve Ratio Calculation

**Result: PASS**

`reserveRatioBps = vaultIdleUSDC * 10_000 / totalAssets`  
Only idle USDC in the vault counts as reserve; strategy-deployed funds are excluded. This correctly reflects liquidity available for immediate redemption.

### 3.3 Points Accrual Formula

**Result: PASS**

`basePoints = lockAmountUSDC * durationDays / 69.444...`  
Equivalent to: 1,000 USDC × 90 days → ~1,300 base Points. Tier multipliers apply at rebate time (not at crediting time), so Points balance is always deterministic from lock parameters.

### 3.4 Rebate Segment Boundary

**Result: PASS**

`computeSegmentRebate()` correctly splits elapsed time into:
- Trial (0–30 days from `startTime`): 0% rebate rate
- Bronze (30–90 days): 1.3× tier rebate rate
- Silver / Gold: higher tiers

No off-by-one error at segment boundaries; boundary timestamps are inclusive at `t30 = startTime + 30 days`.

---

## 4. Permission Boundary Review

### 4.1 Privilege Escalation Paths

**Result: PASS**

No contract allows a non-admin to grant itself elevated roles. All `grantRole()` calls require `DEFAULT_ADMIN_ROLE`. Emergency functions are guarded by `EMERGENCY_ROLE`.

### 4.2 HTM Entry/Exit Gate

**Result: PASS**

`onlyLockManager` modifier on `HighTierStrategyManagerV21.enter()` and `exit()` ensures only the deployed `LockManagerV21` contract can move user funds into/out of HTM. No EOA bypass exists.

### 4.3 Strategy Withdrawal Authorization

**Result: PASS**

`AaveUSDCStrategyV21.withdraw()` is guarded by `onlyManager` (= CoreStrategyManager). Direct calls from any other address revert. The vault can only pull funds through the CSM → strategy chain.

### 4.4 Rebate Disbursement Authorization

**Result: PASS**

`TreasuryV21.withdrawRebate()` is guarded by `onlyRebateManager`. The `rebateManager` role is assigned to `LockPointsRebateManagerV02` (or `RebateManagerV21`) at deploy time. Users cannot claim treasury funds directly.

---

## 5. Test Coverage Review

**Result: PASS**

| Test File | Tests |
|---|---|
| `test/v2_1/CoreVault.test.ts` | — |
| `test/v2_1/LockManager.test.ts` | — |
| `test/v2_1/AaveStrategy.test.ts` | 40 |
| `test/v2_1/EligibilityModule.test.ts` | 44 |
| `test/v2_1/PortfolioLens.test.ts` | 58 |
| All other suites | — |
| **Total** | **471 passing** |

All critical paths covered:
- Vault deposit/redeem/rebalance lifecycle
- Lock create/extend/exit with fee accrual
- HTM enter/exit with eligibility gating
- Aave strategy invest/divest/emergency exit
- Points credit and rebate computation
- PortfolioLens cross-contract aggregation
- EligibilityModule all 10 check conditions

---

## 6. Pre-Deploy Action Items

### Must Fix Before Mainnet Deploy

| # | File | Line | Issue | Action |
|---|---|---|---|---|
| 1 | `contracts/v2_1/interfaces/ILockManagerV21.sol` | 5 | NatDoc says "V4 lock contract" | Change to "V2.1 lock contract" |
| 2 | `contracts/v2_1/YearRingCoreVaultV21.sol` | 372 | Comment references V4 | Remove or rewrite to remove V4 reference |

### Must Confirm Before Mainnet Deploy

| # | Item | Current Value | Action Required |
|---|---|---|---|
| 3 | `ADMIN_ADDRESS` env var | (unset) | Set to multisig address before running deploy |
| 4 | `KEEPER_ADDRESS` env var | (unset) | Set to keeper EOA/bot address before running deploy |
| 5 | Deployer USDC balance | (unknown) | Must hold ≥ 10 USDC on Base mainnet for seed deposit |
| 6 | HTM fee `htmFeeBpsPerYear` | 100 bps (1%/yr) | Confirm closed beta fee level is accepted |

### Recommended (Non-Blocking)

| # | Item | Recommendation |
|---|---|---|
| 7 | `EligibilityModule.setManagerConfig` for HTM | Confirm `minPoints=0, minLockDuration=0, requireAllowlist=false` for open closed beta |
| 8 | `deployments/v2_1_base.json` output | Verify file is written and backed up before proceeding |
| 9 | Post-deploy: verify `reserveRatioBps` | Should be ~1000 bps (10%) immediately after seed deposit |
| 10 | Post-deploy: verify `pricePerShareRay` | Should be exactly `1e27` (RAY) after seed deposit |

---

## 7. Conclusion

The V2.1 contract suite is architecturally sound and ready for mainnet deployment subject to:

1. Fixing 2 comment-level V4 naming residues (trivial one-line edits)
2. Operator confirming `ADMIN_ADDRESS` and `KEEPER_ADDRESS` environment variables
3. Deployer confirming ≥ 10 USDC balance on Base mainnet

No security vulnerabilities, no accounting errors, no permission boundary issues, and no stale token naming contamination were found. All 471 tests pass.

**Deploy status: APPROVED pending items 1–3 above.**
