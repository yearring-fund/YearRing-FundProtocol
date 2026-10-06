# V2.1 Post-Deploy State Snapshot

**Network:** Base Mainnet (chainId 8453)  
**Snapshot timestamp:** 2026-05-11  
**Deployer / Admin (current):** `0x087ea7F67d9282f0bdC43627b855F79789C6824C`  
**Target multisig:** `0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8`  
**Seed depositor (Alice/customA):** `0xa7C381eA23E12B83500A5D3eEE850068740B0339`

---

## Contract Addresses

| Contract | Address |
|----------|---------|
| USDC (real Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| PointsLedgerV01 | `0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe` |
| YearRingCoreVaultV21 | `0x53e45AcB32aCD80F3d215a007fD8FE87390746F8` |
| CoreStrategyManagerV21 | `0xc615c0c37524e9997622337cC973aC24C40e0548` |
| TreasuryV21 | `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2` |
| AccessStrategyManagerV21 | `0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0` |
| LockManagerV21 | `0xCDc679865b5161C7b7cf75584551F5B57828d59F` |
| RebateManagerV21 | `0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD` |
| EligibilityModuleV21 | `0x7ee0ED49A008e6feA8d196492699a87f878a2022` |
| PortfolioLensV21 | `0xeb6C6b8FaE3c10271ea94dc5C071FE8147E01a0a` |
| AaveUSDCStrategyV21 (CoreSM) | `0x58F265139E3693651B4E30961a1e535b413BBa2C` |
| AaveUSDCStrategyV21 (ASM) | `0xc61D5966F2802aff6c6377C21bBdE923Daf879e0` |

---

## YearRingCoreVaultV21

| Field | Value | Notes |
|-------|-------|-------|
| `totalAssets` | 10,000,000 (10 USDC) | Seed deposit by Alice |
| `totalSupply` | 10,000,000,000,000,000,000 (10 yrUSDC) | 18-dec, 12-dec offset applied |
| `pricePerShare` | 1,000,000 (1 USDC per 1e18 yrUSDC) | PPS = 1:1, established ✓ |
| `systemMode` | 0 (NORMAL) | |
| `allowlistEnabled` | `true` | Beta gating active |
| `coreStrategyManager` | `0xc615c0c37524e9997622337cC973aC24C40e0548` | Wired ✓ |

**Reserve note:** 9 USDC (90%) auto-rebalanced into CoreSM strategy on seed deposit. 1 USDC remains in vault as idle reserve. This is expected behavior.

---

## CoreStrategyManagerV21

| Field | Value | Notes |
|-------|-------|-------|
| `strategy` | `0x58F265139E3693651B4E30961a1e535b413BBa2C` | AaveUSDCStrategyV21 ✓ |
| `feeReceiver` | `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2` | TreasuryV21 ✓ |
| `feeBpsPerYear` | 50 (0.5% / year) | Hard-coded in contract |
| `totalManagedAssets` | 9,000,000 (9 USDC) | In Aave V3 via strategy |
| `totalUnits` | 9,000,000,000,000,000,000 | 18-dec units |

---

## AccessStrategyManagerV21

| Field | Value | Notes |
|-------|-------|-------|
| `strategy` | `0xc61D5966F2802aff6c6377C21bBdE923Daf879e0` | AaveUSDCStrategyV21 ✓ |
| `feeReceiver` | `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2` | TreasuryV21 ✓ |
| `lockManager` | `0xCDc679865b5161C7b7cf75584551F5B57828d59F` | Wired ✓ |
| `managementFeeBpsPerYear` | 100 (1% / year) | Closed beta default |

---

## TreasuryV21

| Field | Value | Notes |
|-------|-------|-------|
| `rebateManager` | `0x3B1F6956D5212bCA3Af223DD63AE31420233aDAD` | RebateManagerV21 ✓ |
| `accessManagers[0]` | `0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0` | AccessStrategyManagerV21 ✓ |
| `accessManagerCount` | 1 | |

---

## LockManagerV21

| Field | Value | Notes |
|-------|-------|-------|
| `pointsLedger` | `0xb9c51ff318352c21f2fF5D378D31eFE0c7020dFe` | PointsLedgerV01 ✓ |
| `eligibilityModule` | `0x7ee0ED49A008e6feA8d196492699a87f878a2022` | EligibilityModuleV21 ✓ |
| `REBATE_MANAGER_ROLE` → RebateManagerV21 | `true` | ✓ |
| `KEEPER_ROLE` → deployer | `true` | Transfer to keeper bot post-migration |

---

## PointsLedgerV01

| Field | Value | Notes |
|-------|-------|-------|
| `POINTS_MINTER_ROLE` → LockManager | `true` | ✓ |
| `POINTS_BURNER_ROLE` → LockManager | `true` | ✓ |

---

## DEFAULT_ADMIN_ROLE Status

| Contract | deployer (`0x087e...`) | multisig (`0xd29d...`) |
|----------|------------------------|------------------------|
| YearRingCoreVaultV21 | ✓ YES | ✗ NO |
| CoreStrategyManagerV21 | ✓ YES | ✗ NO |
| AccessStrategyManagerV21 | ✓ YES | ✗ NO |
| TreasuryV21 | ✓ YES | ✗ NO |
| LockManagerV21 | ✓ YES | ✗ NO |
| PointsLedgerV01 | ✓ YES | ✗ NO |
| EligibilityModuleV21 | ✓ YES | ✗ NO |

**→ Admin migration to multisig is PENDING. See `V2_1_ADMIN_MIGRATION_RECORD.md`.**

---

## Vault Allowlist (current)

| Address | Role |
|---------|------|
| `0x087ea7F67d9282f0bdC43627b855F79789C6824C` | admin (deployer) |
| `0xa7C381eA23E12B83500A5D3eEE850068740B0339` | Alice / customA (seed depositor) |
| `0x413f038278A97FC2AE413380Ba0ef195F4e8a0b2` | TreasuryV21 |
| `0x49f2FF1CF3BcD216f4958485407a038535f1Ebb0` | AccessStrategyManagerV21 |

**Beta user addresses not yet added. Pending admin migration.**

---

## Wiring Integrity Check

| Connection | Expected | Status |
|-----------|----------|--------|
| vault.coreStrategyManager = CSM | ✓ | PASS |
| CSM.strategy = AaveUSDCStrategyV21 | ✓ | PASS |
| CSM.feeReceiver = Treasury | ✓ | PASS |
| ASM.strategy = AaveUSDCStrategyV21 | ✓ | PASS |
| ASM.feeReceiver = Treasury | ✓ | PASS |
| ASM.lockManager = LockManager | ✓ | PASS |
| Treasury.rebateManager = RebateManager | ✓ | PASS |
| Treasury.accessManagers[0] = ASM | ✓ | PASS |
| LockManager.pointsLedger = PointsLedger | ✓ | PASS |
| LockManager.eligibilityModule = EligibilityModule | ✓ | PASS |
| PointsLedger MINTER = LockManager | ✓ | PASS |
| PointsLedger BURNER = LockManager | ✓ | PASS |

**All 12 wiring checks: PASS**
