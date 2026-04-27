# Documentation Index

---

## External Review (Start Here)

Documents intended for OV reviewers, investors, and external technical evaluators.

| Document | Description |
|---|---|
| [`ONE_PAGER.md`](ONE_PAGER.md) | Protocol overview: problem, solution, differentiators, traction |
| [`PRODUCT_ARCHITECTURE.md`](PRODUCT_ARCHITECTURE.md) | Layer-by-layer architecture — capital layer, commitment layer, user-facing modules |
| [`CONTRACT_ADDRESSES.md`](CONTRACT_ADDRESSES.md) | Deployed contract addresses, governance migration status, BaseScan links |
| [`CURRENT_SECURITY_POSTURE.md`](CURRENT_SECURITY_POSTURE.md) | Current governance state, admin migration, emergency controls, audit status |
| [`DEMO_GUIDE.md`](DEMO_GUIDE.md) | Three demo paths — steps, actions, expected results |

---

## Application Materials

Documents intended for accelerator and investor applications.

| Document | Description |
|---|---|
| [`TOKEN_ROLE.md`](TOKEN_ROLE.md) | Token dependency model: vault layer is token-independent; commitment layer is token-dependent |
| [`DEMO_SCRIPT_SUMMARY.md`](DEMO_SCRIPT_SUMMARY.md) | What each of the three demo scripts demonstrates and why |

---

## Technical Reference

Internal design documents for protocol mechanics and accounting.

| Document | Description |
|---|---|
| [`V2_DEMO_SCOPE.md`](V2_DEMO_SCOPE.md) | Current demo build scope: what's in, what's not, three demo paths, incentive layer definition |
| [`V2_SCOPE.md`](V2_SCOPE.md) | V02 module responsibilities, reward formula, development boundaries |
| [`V2_LIMITATIONS_AND_V3_NOTES.md`](V2_LIMITATIONS_AND_V3_NOTES.md) | Known limitations — demo params, unfinished modules, testnet-only mechanics, V3 fix notes |
| [`ACCOUNTING_NOTES.md`](ACCOUNTING_NOTES.md) | Audit of three V2 accounting paths (lockWithReward / claimRebate / earlyExitWithReturn) and their vault impact |
| [`POINTS_MODEL.md`](POINTS_MODEL.md) | Points accrual formula, tier multipliers, on-read computation model |
| [`BENEFICIARY_MODEL.md`](BENEFICIARY_MODEL.md) | Beneficiary designation, inactivity conditions, and continuity path design |
| [`STATE_MACHINE.md`](STATE_MACHINE.md) | Lock position lifecycle state machine |
| [`METRICS.md`](METRICS.md) | On-chain MetricsLayerV02 fields and off-chain aggregation logic for tier/lifecycle analytics |
| [`PARAMETERS.md`](PARAMETERS.md) | Tier durations, RWT formula, fee rates, early exit and beneficiary rules |

---

## Data Artifacts

| File | Description |
|---|---|
| [`metrics_output.json`](metrics_output.json) | Pre-generated protocol metrics snapshot from `scripts/metrics.ts` (TVL, locked ratio, tier breakdown, lifecycle stats) |

---

## Operator / Internal Reference

Historical and internal operation documents. Not the current authority for governance or security state.

| Document | Description |
|---|---|
| [`GO_NO_GO_CHECKLIST.md`](GO_NO_GO_CHECKLIST.md) | Historical Step 3 whitelist validation checklist — role assumptions superseded by 2026-04-27 governance migration |
| [`DEPLOY_AND_DEMO_FLOW.md`](DEPLOY_AND_DEMO_FLOW.md) | Full deploy/setup/seed/reset flow, testnet and local modes, demo account setup |
| [`ACCOUNTING_AND_DEMO_NOTES.md`](ACCOUNTING_AND_DEMO_NOTES.md) | Internal accounting notes for demo correctness verification |
| [`FRONTEND_DEMO_GUIDE.md`](FRONTEND_DEMO_GUIDE.md) | Full frontend walkthrough — all 7 sections, local node setup |
