# YearRing Fund Protocol — Closed Beta Deployment Record

> Status: **DEPLOYED & REHEARSAL PASSED**
> Last updated: 2026-05-07
> RPC provider: Infura Base Mainnet (base-mainnet.infura.io)

---

## Chain & Deployer

| Field | Value |
|---|---|
| Chain | Base Mainnet (Chain ID: 8453) |
| Deployer | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| Admin address (current) | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` (deployer EOA — pending transfer to multisig) |
| Guardian address | `0xC8052cF447d429f63E890385a6924464B85c5834` |
| Deployment date | `2026-05-05T16:10:02.920Z` |
| deploy_core_beta.ts | Completed — 14 contracts deployed. See Basescan contract creation TXs per address below. |
| setup_roles.ts | Completed — all 17 role bindings and allowances set. Idempotent. |
| verify_deployment.ts result | ALL CHECKS PASSED (2026-05-05) |
| rehearsal_base.ts result | ALL PHASES PASSED (2026-05-07) — invest/divest/claimRebate/earlyExit/redeem ✓ |
| check_base_state.ts result | ALL STATE CHECKS PASSED (2026-05-07T20:11:24Z) |
| transfer_admin.ts tx | COMPLETE (2026-05-07) — see ROLE_RECORD.md for TX hashes |
| Deployer revoked | CONFIRMED ✓ — Deployer holds NO DEFAULT_ADMIN_ROLE or EMERGENCY_ROLE on any contract |

---

## External Dependencies (Fixed — Base Mainnet)

| Contract | Address | Notes |
|---|---|---|
| USDC (Circle) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Native USDC on Base |
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | Aave V3 lending pool |
| Aave aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | Yield-bearing USDC position |

---

## Deployed Contracts

| Contract | Address | Basescan |
|---|---|---|
| `YearRingCoreVaultV01` | `0x2D2C7BbE92571FF28A23e44d19232e9137F3a310` | [basescan.org/address/0x2D2C7BbE92571FF28A23e44d19232e9137F3a310](https://basescan.org/address/0x2D2C7BbE92571FF28A23e44d19232e9137F3a310) |
| `TreasuryV02` | `0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083` | [basescan.org/address/0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083](https://basescan.org/address/0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083) |
| `PointsToken (YRPTS)` | `0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c` | [basescan.org/address/0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c](https://basescan.org/address/0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c) |
| `LockLedgerV02` | `0x66A4d021642bE3d0916aabA69c415E6D62333A23` | [basescan.org/address/0x66A4d021642bE3d0916aabA69c415E6D62333A23](https://basescan.org/address/0x66A4d021642bE3d0916aabA69c415E6D62333A23) |
| `LockBenefitV02` | `0xD126f3ff0f3A88bF0a9Ad139C2B4A83afb1121c1` | [basescan.org/address/0xD126f3ff0f3A88bF0a9Ad139C2B4A83afb1121c1](https://basescan.org/address/0xD126f3ff0f3A88bF0a9Ad139C2B4A83afb1121c1) |
| `LockPointsRebateManagerV02` | `0x03987638d7a0522c2e1521714e46D486628c87a0` | [basescan.org/address/0x03987638d7a0522c2e1521714e46D486628c87a0](https://basescan.org/address/0x03987638d7a0522c2e1521714e46D486628c87a0) |
| `BeneficiaryModuleV02` | `0xcb201afB89E4f5820b3ab19476501ca0A005bab5` | [basescan.org/address/0xcb201afB89E4f5820b3ab19476501ca0A005bab5](https://basescan.org/address/0xcb201afB89E4f5820b3ab19476501ca0A005bab5) |
| `UserStateEngineV02` | `0x9D0fa30798E8f6F13185571F1033EB26Bae8aac0` | [basescan.org/address/0x9D0fa30798E8f6F13185571F1033EB26Bae8aac0](https://basescan.org/address/0x9D0fa30798E8f6F13185571F1033EB26Bae8aac0) |
| `MetricsLayerV02` | `0x50930AFd56159501801593c8874aA567dd3B6B8E` | [basescan.org/address/0x50930AFd56159501801593c8874aA567dd3B6B8E](https://basescan.org/address/0x50930AFd56159501801593c8874aA567dd3B6B8E) |
| `GovernanceSignalV02` | `0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0` | [basescan.org/address/0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0](https://basescan.org/address/0xDc297daC28ADF25B790CdF4F6Bd17dc63e8Aa5a0) |
| `ClaimLedger` | `0x311A7b06CF01c0E2Cb22935723B2496F2F493C91` | [basescan.org/address/0x311A7b06CF01c0E2Cb22935723B2496F2F493C91](https://basescan.org/address/0x311A7b06CF01c0E2Cb22935723B2496F2F493C91) |
| `StrategyManagerV01` | `0x7359388D2402a1C7494bE45ecC20c95C837f8692` | [basescan.org/address/0x7359388D2402a1C7494bE45ecC20c95C837f8692](https://basescan.org/address/0x7359388D2402a1C7494bE45ecC20c95C837f8692) |
| `AaveV3StrategyV01` | `0xE412435673f630b8546567b8cFadc6A4852fef73` | [basescan.org/address/0xE412435673f630b8546567b8cFadc6A4852fef73](https://basescan.org/address/0xE412435673f630b8546567b8cFadc6A4852fef73) |

---

## Constructor Parameters (Immutable — set at deploy)

### YearRingCoreVaultV01
| Parameter | Value |
|---|---|
| asset | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| name | `"YearRing Core Vault"` |
| symbol | `"yrCORE"` |
| treasury | TreasuryV02 (`0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083`) |
| admin | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| mgmtFeeBpsPerMonth | `4` (4 bps/month ≈ 0.48%/year) |

### PointsToken (YRPTS)
| Parameter | Value |
|---|---|
| name | `"YearRing Points"` |
| symbol | `"YRPTS"` |
| totalSupply | `20,000,000 YRPTS` (preminted to TreasuryV02 at deploy) |
| recipient | TreasuryV02 (`0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083`) |

### LockPointsRebateManagerV02
| Parameter | Value |
|---|---|
| ledger | LockLedgerV02 (`0x66A4d021642bE3d0916aabA69c415E6D62333A23`) |
| benefit | LockBenefitV02 (`0xD126f3ff0f3A88bF0a9Ad139C2B4A83afb1121c1`) |
| pointsToken | PointsToken (`0xe8f731bef3Ebda21Da6aa4a2B061448F7842e90c`) |
| vaultShares | YearRingCoreVaultV01 (`0x2D2C7BbE92571FF28A23e44d19232e9137F3a310`) |
| vault | YearRingCoreVaultV01 (`0x2D2C7BbE92571FF28A23e44d19232e9137F3a310`) |
| treasury | TreasuryV02 (`0xA8a6BE4B0Cf96b43169EB9FeB7d905bfc301a083`) |
| admin | `0x087ea7F67d9282f0bdC43627b855F79789C6824C` |
| emergency | `0xC8052cF447d429f63E890385a6924464B85c5834` |

### AaveV3StrategyV01
| Parameter | Value |
|---|---|
| underlying | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| manager | StrategyManagerV01 (`0x7359388D2402a1C7494bE45ecC20c95C837f8692`) |
| pool | Aave V3 Pool (`0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`) |
| aToken | aUSDC (`0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB`) |
| referralCode | `0` |

---

## Operational Parameter Design Notes

### reserveRatioBps — Staged Adjustment Design

`reserveRatioBps` is set post-deploy via `vault.setReserveRatioBps(newBps)` (DEFAULT_ADMIN_ROLE).
It is **NOT** a constructor parameter and defaults to `10,000` (100%) at deploy — admin must set it explicitly.

| Phase | Value | Condition |
|---|---|---|
| Closed beta initial | `3000` (30%) ← **current** | Conservative safety buffer; set immediately after deploy |
| Stage 2 | `2000` (20%) | After stable redemption patterns + Aave exit validation with real data |
| Stage 3 | `1500` (15%) | After TVL growth and Aave liquidity depth confirmed |
| Mature | `1000–1500` (10–15%) | Only after daily liquidity pool + fast-exit assets verified |

**Important clarifications:**

- `reserveRatioBps = 3000` means 30% of TVL is the *target* idle reserve in the vault. It is **not** a fixed redemption guarantee — large simultaneous redemptions can still deplete idle reserves.
- This parameter must NOT be lowered below 2000 without real user redemption records and a documented exit rehearsal.
- Direct drop to 1000 or below in early stage is not authorized regardless of TVL.
- Long-term architecture target (V3+): separate into `10% daily liquidity pool` + `fast-exit Aave sleeve` + `mid-term strategy sleeve`, rather than a single monolithic Aave position at 85–90% deployment.

**Governance:** All `reserveRatioBps` changes in closed beta require DEFAULT_ADMIN_ROLE (multisig after transfer_admin.ts). V3 should gate this behind a timelock with minimum 24h delay.

---

## Rehearsal Record (Base Mainnet — 2026-05-07)

| Phase | TX Hash | Block |
|---|---|---|
| Phase 2A: transferToStrategyManager | `0xbb9f2301cfef46b382ba1ea688feeed38a0540b4806b911967044c8d2d277aa4` | 45653570 |
| Phase 2A: stratMgr.invest → Aave V3 | `0xe2e9156d43915a06dca3aa6e10a34dcb64f320b688ae95b722c639761c566fec` | 45653573 |
| Phase 2B: stratMgr.divest | `0xd7f705ed4841c357d5eb0105009966a112147dd1f01ddf74db4ea60767202976` | 45653579 |
| Phase 2B: stratMgr.returnToVault | `0xc2a3f4334d3e96ac8dbc818529361fe3de06611e70c32cd4e6e59e6fa62b9193` | 45653582 |
| Phase 3A: manager.claimRebate | `0xfbd803734df01fba90afa606d42ac7b649d79c983fa4d9a5855bb35bb5e185e0` | 45653316 |
| Phase 3B: pts.approve | `0x6755be4f16d58dc2cae2cdfb93c488d7a5e3751a1ea283f7b7f73bfdd28f298d` | 45653320 |
| Phase 3B: manager.earlyExit | `0x005c5a52c87c2b33431404821258361a27e6a6125c50c995a8b5c96a1f569f15` | 45653323 |
| Phase 3C: vault.redeem | `0x60fc9966fccaeac169af30791982d040f26688fbd2ab975812050abd6693b09b` | 45653590 |

**Rehearsal result:** 10 USDC deposited, 9.99986 USDC returned (delta = management fee dust + Aave rounding). All phases PASSED.

---

## Admin Transfer Record

| Field | Value |
|---|---|
| Target multisig | `0xd29d1E3B9478F09aB5D89bC2b59DFDcF0485f7E8` (Base Safe L2 v1.4.1, threshold 2/2) |
| transfer_admin.ts executed | 2026-05-07 — COMPLETE ✓ |
| Deployer DEFAULT_ADMIN_ROLE revoked | CONFIRMED ✓ — all 8 contracts |
| Multisig DEFAULT_ADMIN_ROLE confirmed | CONFIRMED ✓ — all 8 contracts |
| TX hashes (Phase 4 renounces) | See ROLE_RECORD.md — Admin Transfer TX Record |

---

## Post-Deploy Verification Checklist

Run `npx hardhat run scripts/closed_beta/verify_deployment.ts --network base` and confirm:

- [x] vault.asset == USDC ✓
- [x] vault.treasury == TreasuryV02 ✓
- [x] vault.lockLedger == LockLedgerV02 ✓
- [x] vault.strategyManager == StrategyManagerV01 ✓
- [x] vault.externalTransfersEnabled == true ✓
- [x] ledger: LockPointsRebateManagerV02 has OPERATOR_ROLE ✓
- [x] ledger: BeneficiaryModuleV02 has OPERATOR_ROLE ✓
- [x] manager.pointsToken == PointsToken ✓
- [x] treasury.rebateManager == LockPointsRebateManagerV02 ✓
- [x] treasury.approvedAssets[yrCORE] == true ✓
- [x] treasury.approvedAssets[YRPTS] == true ✓
- [x] treasury.approvedModules[manager] == true ✓
- [x] treasury.rebateBudget[yrCORE] > 0 ✓
- [x] yrCORE allowance(treasury → manager) == MaxUint256 ✓
- [x] YRPTS allowance(treasury → manager) == MaxUint256 ✓
- [x] stratMgr.strategy == AaveV3StrategyV01 ✓
- [x] PointsToken treasury balance == 20,000,000 YRPTS ✓

---

## Deployment Script Location

```
scripts/closed_beta/
  config.ts                  ← single source of truth for all params
  deploy_core_beta.ts        ← 14-step deployment
  setup_roles.ts             ← idempotent role + binding setup
  verify_deployment.ts       ← post-setup binding verification
  export_addresses.ts        ← writes to frontend/src/contracts/addresses.ts
  e2e_local_test.ts          ← single-process local validation
  rehearsal_local.ts         ← full user flow rehearsal (local)
  rehearsal_fork.ts          ← Base fork rehearsal (requires RPC)
  rehearsal_base.ts          ← Base mainnet small-amount rehearsal ✓ PASSED
  check_base_state.ts        ← post-deploy on-chain state check ✓ PASSED
  transfer_admin.ts          ← admin role transfer to multisig (PENDING)
```

---

*This document is part of the closed beta audit trail. SiLugang / YearRing Fund Protocol — 2026-05-07.*
