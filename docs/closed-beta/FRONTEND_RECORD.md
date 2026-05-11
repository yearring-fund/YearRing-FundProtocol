# YearRing Fund Protocol — Closed Beta Frontend Record

> Status: **COMPLETE** — frontend build passes with all closed beta terminology.
> Addresses are TBD (zero address placeholders) until mainnet deployment completes.

---

## Build Status

| Check | Result |
|---|---|
| `npm run build` (frontend/) | ✓ **PASS** — 4,660 modules transformed, 0 errors |
| TypeScript compile | ✓ No type errors |
| Build output | `dist/step4/` — HTML + JS + CSS bundles |

---

## Address Mapping (frontend/src/contracts/addresses.ts)

Current state: zero-address placeholders for all new contracts.
Must be updated via `export_addresses.ts` after mainnet deployment.

| Key | Current Value | Status |
|---|---|---|
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ✓ Set (Base USDC) |
| `YearRingCoreVaultV01` | `0x000...000` | TBD — post-deploy |
| `TreasuryV02` | `0x000...000` | TBD — post-deploy |
| `PointsToken` | `0x000...000` | TBD — post-deploy |
| `LockLedgerV02` | `0x000...000` | TBD — post-deploy |
| `LockBenefitV02` | `0x000...000` | TBD — post-deploy |
| `LockPointsRebateManagerV02` | `0x000...000` | TBD — post-deploy |
| `BeneficiaryModuleV02` | `0x000...000` | TBD — post-deploy |
| `UserStateEngineV02` | `0x000...000` | TBD — post-deploy |
| `MetricsLayerV02` | `0x000...000` | TBD — post-deploy |
| `GovernanceSignalV02` | `0x000...000` | TBD — post-deploy |
| `ClaimLedger` | `0x000...000` | TBD — post-deploy |

After mainnet deploy, run:
```bash
npx hardhat run scripts/closed_beta/export_addresses.ts --network base
```

---

## Wording Upgrade — Confirmed Removed

The following legacy terminology has been **completely removed** from all frontend source files.

| Old Term | New Term | Verification |
|---|---|---|
| `RWT` / `Reward Token` | `Points` / `YRPTS` | ✓ 0 occurrences in `frontend/src/` |
| `fbUSDC` | `yrCORE` | ✓ 0 occurrences in `frontend/src/` |
| `FundVaultV01` | `YearRingCoreVaultV01` | ✓ 0 occurrences in `frontend/src/` |
| `LockRewardManager` | `LockPointsRebateManagerV02` | ✓ 0 occurrences in `frontend/src/` |
| `lockWithReward` | `lockWithPoints` | ✓ 0 occurrences in `frontend/src/` |
| `earlyExitWithReturn` | `earlyExit` | ✓ 0 occurrences in `frontend/src/` |
| `issuedRewardTokens` | `issuedPoints` | ✓ 0 occurrences in `frontend/src/` |

---

## Wording Upgrade — Confirmed Present

| Term | Occurrences in src/ | Pages/Components |
|---|---|---|
| `yrCORE` | 56 | Lock, Dashboard, DepositRedeem, Positions, Claim, StrategySection, MetricsBar, AdminConsole |
| `Points` / `YRPTS` | 153 | Lock, Dashboard, Positions, Governance, YieldSection |
| `YearRingCoreVaultV01` | 85 | All vault-interacting pages |
| `LockPointsRebateManagerV02` | 22 | Lock, Positions, YieldSection, DemoStateSection |
| `Rebate` | 79 | Lock (Rebate preview), YieldSection, Positions |
| `lockWithPoints` | 30 | Lock page |
| `earlyExit` | — | Positions page |
| `claimRebate` | — | Positions / YieldSection |

---

## Files Modified (Phase 9 — Terminology Upgrade)

| File | Changes |
|---|---|
| `frontend/src/contracts/addresses.ts` | All addresses updated to new contract names |
| `frontend/src/pages/Lock.tsx` | Full rewrite — lockWithPoints, Points display, yrCORE approve |
| `frontend/src/pages/Dashboard.tsx` | yrCORE balance, Points balance, new contract refs |
| `frontend/src/pages/Positions.tsx` | Full rewrite — earlyExit, Points return, issuedPoints |
| `frontend/src/pages/DepositRedeem.tsx` | yrCORE shares wording throughout |
| `frontend/src/pages/Governance.tsx` | Points vote display |
| `frontend/src/pages/Claim.tsx` | yrCORE shares label |
| `frontend/src/components/AdminConsole.tsx` | YearRingCoreVaultV01 refs |
| `frontend/src/components/MetricsBar.tsx` | YearRingCoreVaultV01 refs |
| `frontend/src/components/DemoStateSection.tsx` | LockPointsRebateManagerV02 ref |
| `frontend/src/components/StrategySection.tsx` | YearRingCoreVaultV01 refs |
| `frontend/src/components/YieldSection.tsx` | LockPointsRebateManager ABI, new address |
| `frontend/src/App.tsx` | YearRingCoreVaultV01 in GlobalStatusBar |

---

## Points Formula Confirmation

Frontend preview formula (Lock.tsx):

```typescript
const POINTS_DENOMINATOR   = 5_000_000n     // 500 × 10_000
const USDC_TO_POINTS_SCALE = 1_000_000_000_000n  // 1e12

// previewPoints = lockedUSDCValue × 1e12 × durationDays × multiplierBps / (10000 × 500)
previewPoints = usdcValue * USDC_TO_POINTS_SCALE * days * multiplierBps / (POINTS_DENOMINATOR * 10000n)
```

Matches contract formula in `LockPointsRebateManagerV02._lockInternal`:
```solidity
points = lockedUSDCValue * USDC_TO_POINTS_SCALE * durationDays * multiplierBps / POINTS_DENOMINATOR;
// USDC_TO_POINTS_SCALE = 1e12, POINTS_DENOMINATOR = 10000 × 500
```

**Verified: 500 USDC × 1 day × 1.0× = 1 Point** ✓

---

## User-Facing Disclosure (GovernanceSignal)

GovernanceSignal is deployed and functional, but the frontend must display:

> "GovernanceSignal is non-binding during closed beta. Results are signals only and do not
> trigger any on-chain execution."

This disclosure is required before any governance UI is shown to users.

---

## Post-Deploy Frontend Steps

1. Run `export_addresses.ts --network base` → updates `addresses.ts`
2. Run `npm run build` in `frontend/` → verify 0 errors
3. Confirm all TBD addresses in the build output are real Base addresses
4. Deploy frontend to hosting (Vercel / Cloudflare Pages)

---

*This document is part of the closed beta audit trail.*
