# Closed Beta Frontend Deployment V2 Report

Generated: 2026-05-07  
Last updated: 2026-05-07 (Phase 10 complete)  
Branch: `main`  
Remote: `origin https://github.com/yearring-fund/YearRing-FundProtocol.git`

---

## 1. Scope

- **Modified directory:** `frontend/`
- **Directories intentionally untouched:** `contracts/`, `deployments/`, `scripts/`, `org-setup/yearring-app/`
- **Current branch:** `main`
- **Remote:** `origin` → `yearring-fund/YearRing-FundProtocol` (org repo)
- **Build target:** `frontend/dist/step4/`

---

## 2. Phase Completion Summary

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — Deployment state check | ✅ Complete | git status, addresses, package.json confirmed |
| Phase 1 — P0 mainnet safety fixes | ✅ Complete | MockUSDC/Mint/Testnet/Demo removed; banner updated |
| Phase 2 — BigInt formatting safety | ✅ Complete | All formatters use `formatUnits`; no `Number(bigint)` for amounts |
| Phase 3 — Address & ABI completeness | ✅ Complete | 4 infrastructure addresses added; ABIs extended |
| Phase 4 — Vault/Portfolio readout | ✅ Complete | `convertToAssets`, `totalSupply`, estimated value added |
| Phase 5 — Points/Rebate naming | ✅ Complete | All `YRPTS`/`fee discount`/`RWT` instances removed |
| Phase 6 — Closed beta risk disclosures | ✅ Complete | Risk banners added to Deposit, Dashboard, LimitationsPanel |
| Phase 7 — Admin console | ✅ Complete | Full rewrite; EMERGENCY_ROLE gating; Timelock-disabled ops |
| Phase 8 — Build verification | ✅ Complete | `npm run build` PASS; all grep checks clear |
| Phase 9 — Deployment report | ✅ Complete | This report generated |
| Phase 10 — Deployment config check | ✅ Complete | Entry renamed `index.html`; env vars confirmed none; config documented |
| Phase 11 — Manual mainnet acceptance guide | ✅ Complete | Post-deploy checklist written into Section 15; no mainnet txs executed |

---

## 3. Files Changed

| File | Change Summary |
|---|---|
| `src/App.tsx` | Banner updated; Admin route + nav item added |
| `src/utils.ts` | All formatters rewritten with `formatUnits`; `fmtBps`, `fmtTs`, `tierName`, `lockStateName` added |
| `src/contracts/addresses.ts` | Added: `StrategyManagerV01`, `AaveV3StrategyV01`, `ProtocolTimelockV02`, `Guardian` |
| `src/contracts/abis.ts` | `MockUSDC_ABI` → `USDC_ABI` (mint removed); `FundVault_ABI` extended; `StrategyManager_ABI` added; `AaveV3Strategy_ABI` added; `Treasury_ABI` added |
| `src/components/AdminConsole.tsx` | Full rewrite — see Phase 7 detail |
| `src/components/VaultSection.tsx` | Mint removed; `convertToAssets`, `totalSupply` added; `USDC_ABI` import fixed |
| `src/components/StrategySection.tsx` | `tvlPct` bigint arithmetic; testnet text removed |
| `src/components/YieldSection.tsx` | `formatUnits` fix; `Simulated data` label; `Mgmt Fee Rebate` |
| `src/components/RwtRulesSection.tsx` | `formatUnits` fix; `issuedPct` bigint arithmetic; `YRPTS` removed |
| `src/components/FeeRulesSection.tsx` | `Mgmt Fee Discount` → `Mgmt Fee Rebate`; `YRPTS` removed; rebate risk note |
| `src/components/StateSection.tsx` | `YRPTS` removed |
| `src/components/IncentiveSection.tsx` | `YRPTS` removed (2 occurrences) |
| `src/components/DaoBridgeSection.tsx` | `Fee Discount Signal` → `Rebate Signal` |
| `src/components/LimitationsPanel.tsx` | Multisig inaccuracy fixed; Treasury boundary note; closed beta accuracy |
| `src/components/MetricsBar.tsx` | `MockUSDC_ABI` → `USDC_ABI` |
| `src/pages/Dashboard.tsx` | `convertToAssets`, `totalSupply`, estimated value; risk note updated |
| `src/pages/DepositRedeem.tsx` | Yellow risk banner added at top |
| `src/pages/Lock.tsx` | `Rebate` terminology; `Points` terminology; risk disclosures |
| `src/pages/Positions.tsx` | `YRPTS` removed; early exit warning updated; rebate/points risk note |
| `src/pages/Admin.tsx` | **New file** — Admin page wrapping AdminConsole |
| `index.html` | **Replaced** — old version-router overwritten with Closed Beta SPA root; title updated to "YearRing Fund — Closed Beta" |
| `vite.config.ts` | `input` changed `step4.html` → `index.html`; `server.open` changed `/step4.html` → `/` |

---

## 4. Mainnet Safety Fixes

| Issue | Fix | Verification |
|---|---|---|
| `MockUSDC` mint button in VaultSection | Removed entirely | `grep -R "MockUSDC"` → 0 results in src |
| `Mint Mock` UI entry | Removed | `grep -R "Mint Mock"` → 0 results |
| `Base Sepolia` text | Removed | `grep -R "Base Sepolia"` → 0 results |
| `Testnet` / `testnet` text | Removed | `grep -R "testnet"` → 0 results |
| `Aave-based Demo` strategy description | Changed to `AaveV3StrategyV01` | `grep -R "Aave-based Demo"` → 0 results |
| Banner `STEP 4 · INVITED USER ACCESS` | → `Closed Beta · Base Mainnet · Invite-only · Early-stage · Unaudited` | Visible in App.tsx |

---

## 5. BigInt / Formatting Fixes

| Formatter / Usage | Old Behavior | New Behavior | File |
|---|---|---|---|
| `fmtUsdc` | `Number(n) / 1e6 + ' USDC'` | `formatUnits(n, 6)` | `utils.ts` |
| `fmtShares` | `Number(n) / 1e18 + ' yrCORE'` | `formatUnits(n, 18)` | `utils.ts` |
| `fmtPoints` | `Number(n) / 1e18 + ' Points'` | `formatUnits(n, 18)` | `utils.ts` |
| `fmtPps` | `Number(n) / 1e6 + ' USDC/share'` | `formatUnits(n, 6)` | `utils.ts` |
| `tvlPct` in StrategySection | `Number(managed) / Number(total) * 100` | `(managed * 10000n) / total` bigint BPS | `StrategySection.tsx` |
| `issuedPct` in RwtRulesSection | `Number(issued) / Number(supply) * 100` | bigint BPS arithmetic | `RwtRulesSection.tsx` |
| `currentNav` in YieldSection | `Number(pps) / 1e6 * shares` | `formatUnits(pps, 6)` + float | `YieldSection.tsx` |
| Transfer placeholder in AdminConsole | `Number(av) / 1e6` | `formatUnits(av, 6)` | `AdminConsole.tsx` |
| `fmtUnits(undefined)` | returned `"0"` | returns `"–"` (Decision 4) | `utils.ts` |

**Remaining `Number()` calls — all safe (not financial amounts):**

| Location | Value type | Max value | Safe? |
|---|---|---|---|
| `utils.ts:59` `fmtBps` | BPS (uint16) | 10 000 | ✅ |
| `utils.ts:64` `fmtTs` | Unix timestamp | ~2³² | ✅ |
| `AdminConsole.tsx:82` | `systemMode` uint8 | 2 | ✅ |
| `AdminConsole.tsx:165` | `reserveRatioBps` | 10 000 | ✅ |
| `VaultSection.tsx:54` | `systemMode` uint8 | 2 | ✅ |
| `DaoBridgeSection.tsx:51-52` | `forVotes * 100n / totalVotes` (bigint-first) | 100 | ✅ |
| `DaoBridgeSection.tsx:142` | proposal count | small | ✅ |
| `FeeRulesSection.tsx:13-14` | `mgmtFeeBpsPerMonth` | 10 000 | ✅ |
| `DemoStateSection.tsx:79` | state enum | 3 | ✅ |
| `StrategySection.tsx:39` | `systemMode` uint8 | 2 | ✅ |
| `LockSection.tsx:121` | `e.target.value` (DOM string) | N/A | ✅ |
| `StateSection.tsx:39` | state enum | 3 | ✅ |
| `MetricsBar.tsx:81` | `reserveRatioBps` | 10 000 | ✅ |
| `Lock.tsx:97,166,258` | `activeLockCount` | 5 | ✅ |
| `Positions.tsx:98` | `lock.unlockAt` timestamp | ~2³² | ✅ |
| `Governance.tsx:67-68` | `forVotes * 1000n / totalVotes` (bigint-first) | 100 | ✅ |
| `Governance.tsx:175` | `nextProposalId` | small | ✅ |

No `/1e18` or `/1e6` patterns remain in src.

---

## 6. Address / ABI Updates

| Item | Status | Source |
|---|---|---|
| `USDC` | ✅ Configured | `deployments/closed_beta_base.json` |
| `YearRingCoreVaultV01` | ✅ Configured | `deployments/closed_beta_base.json` |
| `StrategyManagerV01` | ✅ Added Phase 3 | `deployments/closed_beta_base.json` |
| `AaveV3StrategyV01` | ✅ Added Phase 3 | `deployments/closed_beta_base.json` |
| `ProtocolTimelockV02` | ✅ Added Phase 3 | `deployments/base.json` + `docs/CONTRACT_ADDRESSES.md` |
| `Guardian` | ✅ Added Phase 3 | `deployments/closed_beta_base.json` → `config.guardian` |
| `Safe / Multisig` | ✅ Displayed "Not configured" | Confirmed: no multisig in closed beta |
| `FundVault_ABI` — `totalSupply` | ✅ Added | Vault standard |
| `FundVault_ABI` — `convertToAssets` | ✅ Added | Vault standard |
| `FundVault_ABI` — `addToAllowlist` | ✅ Added | Contract source |
| `FundVault_ABI` — `removeFromAllowlist` | ✅ Added | Contract source |
| `StrategyManager_ABI` | ✅ New | `contracts/StrategyManagerV01.sol` |
| `AaveV3Strategy_ABI` | ✅ New | `contracts/strategies/AaveV3StrategyV01.sol` |
| `Treasury_ABI` | ✅ New (basic) | `contracts/TreasuryV02.sol` |
| `USDC_ABI` (was `MockUSDC_ABI`) | ✅ Renamed, mint removed | Real USDC on Base |
| No hardcoded addresses in components | ✅ All from `ADDRESSES` | — |

---

## 7. Vault / Portfolio Readout

| Item | Status | Notes |
|---|---|---|
| User yrCORE shares | ✅ Displayed | Dashboard + VaultSection |
| `convertToAssets(userShares)` | ✅ Displayed | "Estimated Asset Value" with note |
| `totalSupply` | ✅ Displayed | Dashboard Protocol section + VaultSection |
| `pricePerShare` (PPS) | ✅ Displayed | With "may reflect strategy reporting delay" note |
| `previewDeposit` | ✅ Preserved | DepositRedeem page unchanged |
| `previewRedeem` | ✅ Preserved | DepositRedeem page unchanged |
| All amounts use safe formatter | ✅ | `formatUnits` via `fmtUsdc`, `fmtShares`, etc. |

---

## 8. Points / Rebate Wording

| Old Term | New Term | Files |
|---|---|---|
| `fee discount` / `Fee Discount` | `Rebate` / `Management fee rebate` | `Lock.tsx`, `FeeRulesSection.tsx`, `YieldSection.tsx`, `DaoBridgeSection.tsx` |
| `Mgmt Fee Discount` | `Mgmt Fee Rebate` | `YieldSection.tsx`, `FeeRulesSection.tsx` |
| `YRPTS` (user-visible) | `Points` | All pages/components |
| `fee discounts` (plural) | `management fee rebates` | `Lock.tsx` |
| `Fee Discount Signal` | `Rebate Signal` | `DaoBridgeSection.tsx` |

Post-fix grep: `grep -R "fee discount\|YRPTS\|RWT\|RewardToken"` → **0 results** in src.

---

## 9. Risk Disclosure

| Disclosure | Location | Status |
|---|---|---|
| `Closed Beta · Base Mainnet · Invite-only · Early-stage · Unaudited` | App top banner (always visible) | ✅ |
| `Early-stage, unaudited, real USDC, use small amounts only` | DepositRedeem yellow banner | ✅ |
| `Strategy yield is variable and not guaranteed` | Dashboard bottom note, YieldSection | ✅ |
| `Points are not a live tradable token` | Lock page, Positions page | ✅ |
| `Rebate is not guaranteed yield` | Lock page, Positions page, FeeRulesSection | ✅ |
| `Early exit may remove the Points associated with this lock` | Lock preview, Positions PositionCard | ✅ |
| `Treasury does not control user principal` | LimitationsPanel, AdminConsole Treasury card | ✅ |
| `Governance votes are signal-layer only — do not auto-execute` | LimitationsPanel | ✅ |
| `DEFAULT_ADMIN_ROLE held by ProtocolTimelockV02` | LimitationsPanel, AdminConsole | ✅ |
| `This is not a public token sale` | LimitationsPanel | ✅ |

---

## 10. Admin / Timelock Handling

| Action / Status | UI Behavior | Reason |
|---|---|---|
| `pauseDeposits` | Enabled for EMERGENCY_ROLE (Guardian); disabled + tooltip for others | Callable by EMERGENCY_ROLE per contract |
| `pauseRedeems` | Enabled for EMERGENCY_ROLE (Guardian); disabled + tooltip for others | Callable by EMERGENCY_ROLE per contract |
| `unpauseDeposits` | Hard-disabled, `title="Unpause requires Timelock execution"` | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `unpauseRedeems` | Hard-disabled | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `setMode(0=Normal)` | Hard-disabled with label `"Normal (Timelock)"` | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `setMode(1=Paused)` | Enabled for EMERGENCY_ROLE (Guardian) | Callable by EMERGENCY_ROLE per contract |
| `setMode(2=EmergencyExit)` | Hard-disabled with label `"EmergencyExit (Timelock)"` | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `openExitModeRound` | Hard-disabled, note added | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `closeExitModeRound` | Hard-disabled, note added | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `transferToStrategyManager` | Hard-disabled, input disabled | Requires DEFAULT_ADMIN_ROLE via Timelock |
| `accrueManagementFee` | Enabled for anyone | Permissionless function |
| Admin visibility gate | Removed — all connected wallets see console | No EOA holds DEFAULT_ADMIN_ROLE; read-only for non-guardians |
| Role badge | Shows EMERGENCY_ROLE / DEFAULT_ADMIN / Read-only | Based on live `hasRole()` reads |

---

## 11. Commands Run

### git status (abbreviated)
```
M src/App.tsx
M src/components/AdminConsole.tsx
M src/components/BeneficiarySection.tsx
M src/components/DaoBridgeSection.tsx
M src/components/DemoStateSection.tsx
M src/components/FeeRulesSection.tsx
M src/components/IncentiveSection.tsx
M src/components/LimitationsPanel.tsx
M src/components/LockRow.tsx
M src/components/LockSection.tsx
M src/components/MetricsBar.tsx
M src/components/RwtRulesSection.tsx
M src/components/StateSection.tsx
M src/components/StrategySection.tsx
M src/components/VaultSection.tsx
M src/components/YieldSection.tsx
M src/contracts/abis.ts
M src/contracts/addresses.ts
M src/pages/Claim.tsx
M src/pages/Dashboard.tsx
M src/pages/DepositRedeem.tsx
M src/pages/Governance.tsx
M src/pages/Lock.tsx
M src/pages/Positions.tsx
M src/utils.ts
?? src/pages/Admin.tsx   ← new
```
Contracts / deployments / scripts: untouched by this session.

### npm run build
```
tsc && vite build
✓ 4662 modules transformed
✓ built in 4.17s   — PASS
```
TypeScript typecheck embedded in build step (`tsc` runs first). No type errors.

### npm run lint
```
Script not available in package.json.
```

### npm run typecheck
```
No dedicated typecheck script. TypeScript checked via tsc as part of build — PASS.
```

### Grep checks
```bash
grep -R "MockUSDC|Mint Mock|Base Sepolia|Testnet|testnet|Aave-based Demo" src
→ 0 results

grep -R "RWT|RewardToken|fee discount|Fee Discount|Mgmt Fee Discount|YRPTS" src
→ 0 results

grep -R "/1e18|/ 1e18|/1e6|/ 1e6" src
→ 0 results

grep -R "import.meta.env|VITE_" src
→ 0 results (no custom env vars required)
```

---

## 12. Remaining Blockers

| Item | Severity | Detail |
|---|---|---|
| Safe / Multisig not configured | Non-blocking (expected) | Closed beta design decision — displayed as "Not configured" in Admin UI |
| Full Timelock schedule/execute UI not implemented | Non-blocking (by design) | Phase 7 explicitly deferred this; Timelock-gated buttons are disabled with clear notes |
| No custom RPC env configured | Non-blocking | Currently uses wagmi default public RPC for Base; consider adding stable RPC endpoint before public load |
| `npm run lint` not available | Non-blocking | No ESLint configured in this project |
| `ProtocolTimelockV02` address sourced from older `deployments/base.json` | Informational | `closed_beta_base.json` does not include Timelock. Cross-confirmed via `docs/CONTRACT_ADDRESSES.md`. Address: `0x054Cb2c32D6062B291420584dE2e5952C372cDD6`. Recommend human confirmation before mainnet deployment. |

No true build-blocking issues.

---

## 13. Deployment Readiness

**READY FOR FRONTEND DEPLOYMENT**

All P0 issues resolved. Build passes. No banned terms remain. Risk disclosures in place. Admin panel visible with accurate Timelock/Guardian gating.

Recommended human confirmation before deploy:
1. Verify `ProtocolTimelockV02` address `0x054Cb2c32D6062B291420584dE2e5952C372cDD6` matches on-chain state
2. Verify Guardian address `0xC8052cF447d429f63E890385a6924464B85c5834` matches `EMERGENCY_ROLE` holder on-chain
3. Confirm no custom RPC is needed; if a stable endpoint is required later, modify `wagmiConfig.ts`: `http('https://your-rpc-url')` (no env var — project has no `import.meta.env` support)

---

## 14. Deployment Configuration

```
Root directory:   frontend
Install command:  npm install
Build command:    npm run build
Output directory: dist/step4
Entry point:      index.html  (root path / serves dist/step4/index.html)
Network:          Base Mainnet (Chain ID 8453)
```

From repo root:
```bash
Build command:    cd frontend && npm install && npm run build
Output directory: frontend/dist/step4
```

**Entry point:** `dist/step4/index.html` — standard root entry, no platform-level redirect needed.

**No environment variables required.** `.env` file exists but is empty (0 bytes). No `VITE_*` or `import.meta.env` usage in source.

**RPC:** `wagmiConfig.ts` uses `http()` with no URL — wagmi default public Base Mainnet RPC. No custom RPC endpoint configured. Suitable for small closed beta; add `VITE_RPC_URL` if stable endpoint is required later.

**Wallet connectors:** `injected()` only — supports MetaMask and other browser-extension wallets. No WalletConnect or Coinbase Wallet SDK.

**`frontend/step4.html`:** Old entry file, now superseded by `index.html`. No longer referenced by vite.config. Can be deleted at next commit cleanup.

`org-setup/yearring-app/` is intentionally not deployed for closed beta.

---

## 15. Recommended Manual Mainnet Test (Post-Deploy)

> All steps below are human-executed post-deployment. Claude Code does not execute any mainnet transactions.
> Use a **browser-extension wallet** (MetaMask or compatible). WalletConnect is not supported in this build.
> Use **very small amounts only** — this is an early-stage, unaudited protocol on Base Mainnet.

### A — Entry & Basic Connectivity

1. Open deployed URL — confirm root path `/` loads the app (no redirect, no 404)
2. Confirm browser tab title shows **"YearRing Fund — Closed Beta"**
3. Confirm top banner shows **"Closed Beta · Base Mainnet · Invite-only · Early-stage · Unaudited"**
4. Connect wallet — confirm Base Mainnet (Chain ID 8453) is active
5. Confirm no MockUSDC / Testnet / Mint button appears anywhere in the UI

### B — Vault & Portfolio Readout

6. Confirm USDC balance displays correctly (non-zero if wallet holds USDC)
7. Approve a very small USDC amount (e.g. 1 USDC)
8. Deposit a very small amount — confirm yrCORE vault shares increase
9. Confirm **"Estimated Asset Value"** displays via `convertToAssets(userShares)`
10. Confirm PPS displays with **"may reflect strategy reporting delay"** note
11. Confirm `totalSupply` of yrCORE is shown in Dashboard / VaultSection

### C — Lock, Points & Rebate

12. Create a small lock — confirm Points issued and Positions page shows lock
13. Confirm Positions page shows **"Claim Rebate"** (not "fee discount" or "YRPTS")
14. Confirm Early Exit warning explicitly mentions **Points clawback**
15. Confirm Points labelled as **"Points"**, not "YRPTS" or "RWT"

### D — Admin Console

16. Navigate to `/admin` — confirm page loads without error
17. Confirm all infrastructure addresses are visible:
    - Vault, StrategyManagerV01, AaveV3StrategyV01, TreasuryV02
    - ProtocolTimelockV02 (`0x054Cb2c32D6062B291420584dE2e5952C372cDD6`)
    - Guardian (`0xC8052cF447d429f63E890385a6924464B85c5834`)
18. Confirm **Safe/Multisig shows "Not configured"**
19. Confirm Timelock-gated buttons are hard-disabled: unpause deposits/redeems, setMode Normal, setMode EmergencyExit, transferToStrategyManager
20. Confirm **"Accrue Fee"** button is enabled (permissionless)
21. As a non-Guardian wallet: confirm Pause Deposits / Pause Redeems show disabled tooltip "Requires EMERGENCY_ROLE (Guardian)"

### E — Transaction Integrity

22. Confirm all transaction hashes link correctly to **`https://basescan.org/tx/<hash>`**
23. Confirm no transaction is submitted without wallet confirmation prompt
