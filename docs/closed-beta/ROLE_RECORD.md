# YearRing Fund Protocol — Closed Beta Role Record

> Status: **DEPLOYED** — roles set by setup_roles.ts (2026-05-05).
> DEFAULT_ADMIN_ROLE transfer to Safe multisig is PENDING (transfer_admin.ts not yet executed).
> Last updated: 2026-05-07

---

## Role Overview

The protocol uses OpenZeppelin `AccessControl` with the following roles across contracts.
There is **no Timelock** in closed beta — all admin actions are direct multisig or deployer calls.

---

## 1. DEFAULT_ADMIN_ROLE

`keccak256("DEFAULT_ADMIN_ROLE")` — OpenZeppelin standard, value: `0x00`

**Current holder (pre-transfer):** `0x087ea7F67d9282f0bdC43627b855F79789C6824C` (Deployer EOA)
**Target holder (post-transfer):** `0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8` (Base Safe L2 v1.4.1, threshold 2/2)

| Contract | Address | Current Holder | Post-transfer Holder |
|---|---|---|---|
| YearRingCoreVaultV01 | `0x2D2C7BbE92571FF28A23e44d19232e9137F3a310` | Deployer EOA | Safe multisig |
| TreasuryV02 | `0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083` | Deployer EOA | Safe multisig |
| LockLedgerV02 | `0x66A4d021642bE3d0916aabA69c415E6D62333A23` | Deployer EOA | Safe multisig |
| LockPointsRebateManagerV02 | `0x03987638d7a0522c2e1521714e46D486628c87a0` | Deployer EOA | Safe multisig |
| BeneficiaryModuleV02 | `0xcb201afB89E4f5820b3ab19476501ca0A005bab5` | Deployer EOA | Safe multisig |
| StrategyManagerV01 | `0x7359388D2402a1C7494bE45ecC20c95C837f8692` | Deployer EOA | Safe multisig |
| GovernanceSignalV02 | `0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0` | Deployer EOA | Safe multisig |
| ClaimLedger | `0x311A7b06CF01c0E2Cb22935723B2496F2F493C91` | Deployer EOA | Safe multisig |

> ⚠ Update "Current Holder" column to "Safe multisig" and record TX hashes after `transfer_admin.ts` completes.

---

## 2. EMERGENCY_ROLE

`keccak256("EMERGENCY_ROLE")`

**Current holder:** `0x087ea7F67d9282f0bdC43627b855F79789C6824C` (Deployer EOA — same as admin pre-transfer)
**Target holder:** `0xC8052cF447d429f63E890385a6924464B85c5834` (Guardian EOA)

> transfer_admin.ts grants EMERGENCY_ROLE to guardian, then revokes from deployer.

| Contract | Address | Post-transfer Holder | Permissions |
|---|---|---|---|
| YearRingCoreVaultV01 | `0x2D2C7BbE92571FF28A23e44d19232e9137F3a310` | Guardian EOA | pauseDeposits, pauseRedeems, triggerEmergencyExit |
| LockLedgerV02 | `0x66A4d021642bE3d0916aabA69c415E6D62333A23` | Guardian EOA | pause (blocks all lock/unlock) |
| LockPointsRebateManagerV02 | `0x03987638d7a0522c2e1521714e46D486628c87a0` | Guardian EOA | pause, approveForceExit |
| StrategyManagerV01 | `0x7359388D2402a1C7494bE45ecC20c95C837f8692` | Guardian EOA | pause (blocks invest) |

---

## 3. OPERATOR_ROLE (LockLedgerV02)

`keccak256("OPERATOR_ROLE")`

**Set by:** `setup_roles.ts` (2026-05-05) — permanent, does not change during transfer_admin.ts

| Holder | Address | Purpose |
|---|---|---|
| LockPointsRebateManagerV02 | `0x03987638d7a0522c2e1521714e46D486628c87a0` | Can call `lockFor`, `earlyExitFor` on behalf of users |
| BeneficiaryModuleV02 | `0xcb201afB89E4f5820b3ab19476501ca0A005bab5` | Can call `lockFor` when executing beneficiary claim |

These are the **only** OPERATOR_ROLE holders. No EOA holds this role.

---

## 4. TREASURY_OPERATOR_ROLE (TreasuryV02)

`keccak256("TREASURY_OPERATOR_ROLE")`

| Holder | Notes |
|---|---|
| None assigned | Not used in closed beta. DEFAULT_ADMIN_ROLE covers all treasury operations. |

---

## 5. REBATE_MANAGER_ROLE (TreasuryV02)

`keccak256("REBATE_MANAGER_ROLE")`

**Set by:** `setup_roles.ts` via `treasury.setRebateManager(manager)` — permanent

| Holder | Address | How granted | Purpose |
|---|---|---|---|
| LockPointsRebateManagerV02 | `0x03987638d7a0522c2e1521714e46D486628c87a0` | Auto-granted via `setRebateManager()` | Can call `recordRebateSpent()` to debit rebate budget |

---

## 6. VAULT_ROLE (ClaimLedger)

`keccak256("VAULT_ROLE")`

| Holder | Address | Purpose |
|---|---|---|
| YearRingCoreVaultV01 | `0x2D2C7BbE92571FF28A23e44d19232e9137F3a310` | Can call `claimExitAssets` path on ClaimLedger |

> Note: ClaimLedger is deployed but not part of the primary exit path in closed beta.
> Primary exit: users call `redeem()` on YearRingCoreVaultV01 directly.

---

## 7. Role Assignment Sequence (setup_roles.ts — completed 2026-05-05)

```
1.  vault.setLockLedger(ledger)          → binds vault ↔ ledger             ✓
2.  vault.setModules(stratMgr)           → binds vault ↔ stratMgr           ✓
3.  vault.setExternalTransfersEnabled()  → allows vault→stratMgr USDC push  ✓
4.  ledger.grantRole(OPERATOR, manager)  → manager can lock/earlyExit        ✓
5.  ledger.grantRole(OPERATOR, beneMod)  → beneficiary module can lock       ✓
6.  treasury.setRebateManager(manager)   → auto-grants REBATE_MANAGER_ROLE  ✓
7.  treasury.setApprovedAsset(yrCORE)    → marks yrCORE as approved asset   ✓
8.  treasury.setApprovedAsset(YRPTS)     → marks YRPTS as approved asset    ✓
9.  treasury.setApprovedModule(manager)  → marks manager as approved module ✓
10. treasury.approveSpender(yrCORE, manager, MaxUint256) → rebate allowance  ✓
11. treasury.approveSpender(YRPTS, manager, MaxUint256)  → points allowance  ✓
12. treasury.setRebateBudget(yrCORE, MaxUint256)         → enable rebate     ✓
13. stratMgr.pause → setStrategy(aave) → unpause → bind Aave strategy        ✓
```

All 17 bindings verified by `verify_deployment.ts` and `check_base_state.ts`.

---

## 8. Timelock

**None in closed beta.** Admin actions are immediate.

Rationale: closed beta is a limited internal run. Governance-enforced timelocks are a V3 consideration.

---

## 9. Deployer Status

| Phase | Deployer DEFAULT_ADMIN_ROLE | Who holds it |
|---|---|---|
| Deploy + setup (completed 2026-05-05) | YES — required to execute all setup steps | Deployer EOA |
| **Current state (2026-05-07)** | **NO — transfer_admin.ts complete ✓** | **Safe multisig** |
| After transfer_admin.ts completes | NO — deployer is a plain EOA | Safe multisig |
| User onboarding | NO | Safe multisig |

### Admin Transfer Procedure

Run `transfer_admin.ts` before any user onboarding:

```bash
npx hardhat run scripts/closed_beta/transfer_admin.ts --network base
```

Required env vars (already set in .env):
- `MULTISIG_ADDRESS=0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8`
- `GUARDIAN_ADDRESS=0xC8052cF447d429f63E890385a6924464B85c5834`
- `PRIVATE_KEY` — deployer key (currently holds DEFAULT_ADMIN_ROLE)

The script executes in 6 phases (grant-first, revoke-last — irreversible):

```
Phase 1: grantRole(DEFAULT_ADMIN_ROLE → multisig)    on all 8 contracts
Phase 2: grantRole(EMERGENCY_ROLE → guardian)         on EMERGENCY_ROLE contracts
Phase 3: revokeRole(EMERGENCY_ROLE from deployer)     on EMERGENCY_ROLE contracts
Phase 4: renounceRole(DEFAULT_ADMIN_ROLE, deployer)   on all 8 contracts  ← LAST
Phase 5: Post-check — deployer holds NO admin roles
Phase 6: Post-check — multisig holds DEFAULT_ADMIN_ROLE on all contracts
```

> ⚠ **Phase 4 is irreversible.** Ensure Safe multisig (0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8) is operational before running.

### Admin Transfer TX Record

**Phase 1 — Grant DEFAULT_ADMIN_ROLE → Multisig (8 contracts)**
*(executed in first transfer_admin.ts run — see Basescan deployer history ~block 45654xxx)*

**Phase 2 — Grant EMERGENCY_ROLE → Guardian + PROPOSER_ROLE → Multisig**
*(executed in same run — guardian EMERGENCY_ROLE, GovernanceSignalV02 PROPOSER_ROLE)*

**Phase 4 — Renounce DEFAULT_ADMIN_ROLE from Deployer (irreversible)**

| Contract | TX Hash | Block |
|---|---|---|
| YearRingCoreVaultV01 | *(block ~45655xxx — see Basescan deployer history)* | ~45655xxx |
| TreasuryV02 | *(same batch)* | ~45655xxx |
| LockLedgerV02 | *(same batch)* | ~45655xxx |
| LockPointsRebateManagerV02 | `0x5b8b53acb4b5f89a3453f3af6b984767c16340a8b838e6564440b554291d0cd3` | 45655261 |
| BeneficiaryModuleV02 | `0x6aa74943d4ef1c98c894b5d616548b1f909e50d38ad21359f3178ea7be2aea95` | 45655264 |
| StrategyManagerV01 | `0xee10fe3d5230db130ea790449195aa452c7570ad7d0d2a93fdd9a84d5bee4698` | 45655267 |
| GovernanceSignalV02 | `0x57c5135b42a763099461ce3ea6a03cfa422229a86f6908abf2683db8ec505ea5` | 45655270 |
| ClaimLedger | `0x85e9d890f6dda8ffcb363faf2b55124a2cb170924612e2d576ef9aad4168128e` | 45655273 |

**Phase 5/6 Post-checks:** ALL 8 contracts verified — deployer holds NO admin roles, Safe multisig holds DEFAULT_ADMIN_ROLE on all 8. ✓

---

## 10. Post-Transfer Role Verification Checklist

Run after `transfer_admin.ts`:

- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on YearRingCoreVaultV01
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on TreasuryV02
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on LockLedgerV02
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on LockPointsRebateManagerV02
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on BeneficiaryModuleV02
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on StrategyManagerV01
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on GovernanceSignalV02
- [ ] Deployer EOA does **NOT** hold `DEFAULT_ADMIN_ROLE` on ClaimLedger
- [ ] Deployer EOA does **NOT** hold `EMERGENCY_ROLE` on any contract
- [ ] Safe multisig (`0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8`) holds `DEFAULT_ADMIN_ROLE` on all 8 contracts
- [ ] Guardian (`0xC8052cF447d429f63E890385a6924464B85c5834`) holds `EMERGENCY_ROLE` on all EMERGENCY_ROLE contracts
- [ ] `ledger.hasRole(OPERATOR_ROLE, manager)` still true (unaffected by transfer)
- [ ] `ledger.hasRole(OPERATOR_ROLE, beneMod)` still true (unaffected by transfer)
- [ ] `treasury.rebateManager` still == LockPointsRebateManagerV02 (unaffected)

---

*This document is part of the closed beta audit trail. SiLugang / YearRing Fund Protocol — 2026-05-07.*
