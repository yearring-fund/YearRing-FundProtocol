# Evidence Index

This folder contains mainnet validation evidence for YearRing Fund Protocol.

The files in this folder are included to show live protocol validation and execution records. They are not a substitute for an external security audit.

## Recommended Review Order

1. `STEP3_GO_NO_GO_RESULT.md` — High-level validation result and go/no-go summary.
2. `user_risk_confirmation_status.md` — Internal user risk confirmation records.
3. `step2_log.json` — Step 2 execution log and protocol interaction evidence.
4. `liverun_snapshot_1775394438108_notes.md` — Live run snapshot with annotations.
5. `liverun_snapshot_1775394438108.json` — Live run state snapshot (Step 3).
6. `liverun_snapshot_1775482668747.json` — Live run state snapshot (Step 3, later).
7. Deposit / invest / divest JSON records — Transaction-level execution evidence.
8. `state_*.json` files — Sequential protocol state captures during live runs.

## File Reference

| File | Description |
|---|---|
| `STEP3_GO_NO_GO_RESULT.md` | Step 3 go/no-go validation summary |
| `step3_go_no_go_working.md` | Working notes for Step 3 go/no-go review |
| `user_risk_confirmation_status.md` | User risk acknowledgment records |
| `step2_log.json` | Step 2 protocol execution log |
| `liverun_snapshot_*.json` | Live protocol state snapshots |
| `liverun_snapshot_*_notes.md` | Annotated live run notes |
| `deposit_*.json` | Deposit transaction evidence |
| `invest_*.json` | Strategy invest transaction evidence |
| `divest_*.json` | Strategy divest transaction evidence |
| `state_*.json` | Sequential vault state captures |
| `daily_deposits.json` | Daily deposit tracking record |

## Notes

- Evidence files may include public transaction hashes and public contract addresses.
- No private keys, API keys, seed phrases, or confidential investor materials are stored in this folder.
- External audit status: pending.
- Current access status: controlled validation / invited access only.
