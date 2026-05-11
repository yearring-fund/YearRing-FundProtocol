# Closed Beta — Pending Contract Changes (2026-05)

> Status: **Code complete, not yet deployed.**
> All changes below are implemented in the working directory and compile successfully.
> Deployment is blocked pending further functional modifications in the next session.

---

## Part A — Points System Redesign

### Problem
`PointsToken` was a full ERC-20: freely transferable between users, no role control,
`snapshot()` callable by anyone. This was a design mismatch — Points should be a
non-transferable internal ledger.

### New Contracts (to be deployed)

#### `PointsLedgerV01.sol` (NEW)
- Non-ERC20 AccessControl contract; no `transfer` / `approve`
- `MAX_SUPPLY = 20,000,000 × 1e18`
- Three roles: `POINTS_MINTER_ROLE`, `POINTS_BURNER_ROLE`, `SNAPSHOT_ROLE`
- `creditLock(address, uint256)` — issued at lock time (MINTER_ROLE)
- `creditContribution(address, uint256)` — issued for community contributions (MINTER_ROLE)
- `debit(address, uint256)` — burn on early exit (BURNER_ROLE)
- `snapshot()` — restricted to SNAPSHOT_ROLE (GovernanceSignalV02)
- `balanceOf` / `balanceOfAt(address, snapshotId)` — OZ ERC20Snapshot binary search algorithm
- `totalIssued` monotonically increasing (debit does not reduce it)
- Separate counters: `lockPointsIssued`, `contributionPointsIssued`
- Interface: `contracts/interfaces/IPointsLedgerV01.sol`

#### `ContributionPointsDistributorV01.sol` (NEW)
- Admin-authorised single or batch Points issuance for community contributors
- `DISTRIBUTOR_ROLE` for issuing; admin receives it at deploy
- `distributeSingle(address recipient, uint256 amount, bytes32 reason)`
- `distributeBatch(bytes32 batchId, bytes32 listHash, address[] recipients, uint256[] amounts)`
- `batchId` prevents replay; `listHash` links to public off-chain list for verifiability
- Interface: `contracts/interfaces/IContributionPointsDistributorV01.sol` (not yet created)

### Modified Contracts

#### `LockPointsRebateManagerV02.sol`
- `IERC20 pointsToken` → `IPointsLedgerV01 pointsLedger`
- Lock issuance: `pointsToken.safeTransferFrom(treasury, owner, points)` → `pointsLedger.creditLock(owner, points)`
- Early exit return: `safeTransferFrom(msg.sender, treasury, points)` → `pointsLedger.debit(owner, points)`
  - User no longer needs to `approve` YRPTS before earlyExit
- `checkEarlyExit` returns 5 values (removed `userPointsAllowance`)
- Removed error: `InsufficientPointsAllowance`

#### `contracts/interfaces/ILockPointsRebateManagerV02.sol`
- `checkEarlyExit` return signature updated (5 values, removed `userPointsAllowance`)

#### `contracts/governance/GovernanceSignalV02.sol`
- Internal `ISnapshotToken` no longer extends `IERC20`
- Now: `interface ISnapshotToken { snapshot(); balanceOf(address); balanceOfAt(address, uint256); }`
- Compatible with `PointsLedgerV01` which is not ERC20

#### `scripts/closed_beta/setup_roles.ts`
- Section C: removed YRPTS Treasury approvals (`setApprovedAsset`, `approveSpender` for points)
- Added Section E: PointsLedgerV01 role grants
  - `POINTS_MINTER_ROLE` → LockPointsRebateManagerV02
  - `POINTS_BURNER_ROLE` → LockPointsRebateManagerV02
  - `POINTS_MINTER_ROLE` → ContributionPointsDistributorV01
  - `SNAPSHOT_ROLE`      → GovernanceSignalV02

### Deploy Script Updates (PENDING — not yet done)
- `deploy_core_beta.ts`: replace PointsToken deployment with PointsLedgerV01 + ContributionPointsDistributorV01
- `verify_deployment.ts`: add role grant checks for new contracts
- `export_addresses.ts`: include new contract addresses

### Frontend Updates (PENDING — not yet done)
- Locks page: remove "approve YRPTS" step from earlyExit flow (no longer needed)
- `checkEarlyExit` call: remove parsing of 6th return value (`userPointsAllowance`)

---

## Part B — Vault Auto-Rebalance

### Problem
`YearRingCoreVaultV01` had no automatic capital movement:
- After deposit: reserve would grow indefinitely, funds idle in vault
- After large redeem: vault could be short on USDC (user would get a revert)
- `rebalance()` was pull-only, cooldown-gated, required external trigger

### Reserve Band (new unified rules, all paths)
| Constant | BPS | % | Meaning |
|----------|-----|---|---------|
| `MIN_RESERVE_BPS` | 500 | 5% | Auto-pull trigger (reserve fell too low) |
| `TARGET_RESERVE_BPS` | 1000 | 10% | Rebalance target |
| `MAX_RESERVE_BPS` | 1500 | 15% | Auto-push trigger (reserve too high) |
| `MAX_STRATEGY_DEPLOY_BPS` | 7000 | 70% | Hard cap on strategy allocation |

### Modified: `YearRingCoreVaultV01.sol`

**Removed:**
- `RESERVE_FLOOR_BPS` (1500), `RESERVE_TARGET_BPS` (3000), `RESERVE_CEILING_BPS` (3500)
- `reserveRatioBps` state variable, `setReserveRatioBps()`, `availableToInvest()`
- `InvalidRatio` error, `ReserveRatioUpdated` event

**Added:**
- `MIN_RESERVE_BPS`, `TARGET_RESERVE_BPS`, `MAX_RESERVE_BPS` constants
- `InsufficientVaultLiquidity(uint256 required, uint256 available)` error
- `RebalanceDeployFailed(uint256 amountRequested)` event
- `_autoRebalance()` internal function

**`_deposit` hook:**
- After `super._deposit(...)`, calls `_autoRebalance()`
- If reserve > 15%, pushes excess to strategy automatically

**`_withdraw` hook:**
- Pre-pull: checks if vault USDC < redeem amount
  - If short, calls `stratMgr.returnForRebalance(shortfall)` via try/catch
  - If still short after pull → `revert InsufficientVaultLiquidity` (before burning shares)
- After `super._withdraw(...)`, calls `_autoRebalance()`

**`_autoRebalance()` internal:**
- Pull path (`reserve < 5%`): `stratMgr.returnForRebalance(toPull)` via try/catch; failure → emit `RebalanceDivestFailed`
- Push path (`reserve > 15%`): silent skip if `!externalTransfersEnabled`; cap at 70%; `safeTransfer` → `stratMgr.deployForRebalance()` via try/catch; failure → emit `RebalanceDeployFailed` (USDC safe in stratMgr idle)

**`rebalance()` standalone:**
- Simplified: cooldown check → `_autoRebalance()`; shares exact same logic as hooks

**`transferToStrategyManager()` (admin manual override):**
- Now uses `MIN_RESERVE_BPS` guard (vault must keep ≥ 5% after transfer)
- Still enforces 70% cap and `externalTransfersEnabled`

**`checkUpkeep()`:**
- Updated trigger: `reserveBps < MIN_RESERVE_BPS || reserveBps > MAX_RESERVE_BPS`

### Modified: `StrategyManagerV01.sol`
- Added `deployForRebalance(uint256 amount)`:
  - `onlyVault` gate, `whenNotPaused`, `nonReentrant`
  - Push model: vault pre-transferred USDC; this calls `strategy.invest(amount)`
  - Reverts if paused or no strategy (vault catches in try/catch)

### Modified: `contracts/interfaces/IStrategyManagerV01.sol`
- Added `deployForRebalance(uint256 amount)` declaration

---

## Pending Before Deployment

1. **Deploy script**: update `deploy_core_beta.ts` — replace PointsToken with PointsLedgerV01 + ContributionPointsDistributorV01
2. **Verify script**: update `verify_deployment.ts` — add PointsLedgerV01 / Distributor role checks
3. **Export script**: update `export_addresses.ts`
4. **Frontend**: remove YRPTS approve step from earlyExit UI; update `checkEarlyExit` parsing
5. **Any further functional modifications** (per next session instructions)
6. **Full redeploy** all contracts to Base Mainnet
7. **Re-run setup_roles.ts** → re-add allowlist → rebuild frontend → push

---

## Compile Status
All four modified contracts compile cleanly:
`YearRingCoreVaultV01`, `StrategyManagerV01`, `IStrategyManagerV01`, `GovernanceSignalV02`
