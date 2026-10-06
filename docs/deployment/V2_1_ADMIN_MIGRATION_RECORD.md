# V2.1 Admin Migration Record

**Purpose:** Transfer `DEFAULT_ADMIN_ROLE` from deployer EOA to multisig on all V2.1 contracts.

---

## Addresses

| Role | Address |
|------|---------|
| Deployer (current admin) | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| Target multisig | `0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8` |

---

## Migration Script

```
scripts/deploy/migrate_admin_v2_1.ts
```

### Dry run (no txs, safe to run anytime):
```bash
DRY_RUN=true npx hardhat run scripts/deploy/migrate_admin_v2_1.ts --network base
```

### Live execution (irreversible):
```bash
npx hardhat run scripts/deploy/migrate_admin_v2_1.ts --network base
```

---

## Migration Flow

The script executes in **3 phases** per safety protocol:

```
Phase 1 — Grant DEFAULT_ADMIN_ROLE to multisig (all 8 contracts)
          ↓  abort if any grant fails
Phase 2 — Verify multisig has role on ALL contracts
          ↓  abort if any verification fails
Phase 3 — Revoke DEFAULT_ADMIN_ROLE from deployer (all 8 contracts)
          ↓  verify deployer lost role on each
```

Grant happens before revoke. If the grant phase fails for any reason, the script aborts without revoking the deployer — preventing accidental role loss.

---

## Contracts in Scope

| Contract | Address |
|----------|---------|
| YearRingCoreVaultV21 | `0x53e45AcB32aCD80F3d215a007fD8FE87390746F8` |
| CoreStrategyManagerV21 | `0xc615c0c37524e9997622337cC973aC24C40e0548` |
| TreasuryV21 | `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2` |
| AccessStrategyManagerV21 | `0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0` |
| LockManagerV21 | `0xCDc679865b5161C7b7cf75584551F5B57828d59F` |
| RebateManagerV21 | `0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD` |
| EligibilityModuleV21 | `0x7ee0ED49A008e6feA8d196492699a87f878a2022` |
| PointsLedgerV01 | `0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe` |

**PortfolioLensV21 is read-only (no admin role) — not in scope.**

---

## Pre-Migration Checklist

- [ ] Confirm multisig `0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8` is operational
- [ ] Test multisig can sign a transaction on Base mainnet
- [ ] Run dry run first: `DRY_RUN=true npx hardhat run ...`
- [ ] Deployer has sufficient ETH for 16 txs (8 grants + 8 revokes) — ~0.002 ETH
- [ ] Basescan verification complete (optional but recommended before migration)

---

## Post-Migration Checklist

- [ ] Verify deployer has NO `DEFAULT_ADMIN_ROLE` on any contract
- [ ] Verify multisig HAS `DEFAULT_ADMIN_ROLE` on all 8 contracts
- [ ] Test multisig can call one admin function (e.g. `vault.setAllowlistEnabled`)
- [ ] Add beta user addresses to allowlist via multisig

---

## Current Status

**NOT YET EXECUTED**

Pre-deploy state snapshot: all 8 contracts have deployer as admin, multisig has no role.
See `V2_1_POST_DEPLOY_STATE.md` for full state at time of deployment.

---
<!-- Migration execution records appended below by script -->

## Migration Complete

- **Timestamp:** 2026-05-11T17:04:51.204Z
- **Deployer:** 0x087ea7F67d9282f0bdC43627b855F79789C6824C
- **Multisig:** 0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8
- **Result:** All 8 contracts — deployer revoked, multisig is sole admin
