# Current Security Posture

> Last updated: 2026-04-27
> For deployed contract addresses, see [`CONTRACT_ADDRESSES.md`](CONTRACT_ADDRESSES.md) and [`../ADDRESSES.md`](../ADDRESSES.md).

---

## Current Stage

YearRing Fund Protocol is currently in **internal validation / invited whitelist testing**.

No broad public user launch has started. External users are onboarded only through an explicit invitation process. Step 3 (internal mainnet readiness) is complete. Step 4 (controlled external-user pilot) is in preparation.

---

## Governance and Admin Control

Core protocol admin roles have been migrated to `ProtocolTimelockV02`.

**The deployer EOA no longer directly controls core contract `DEFAULT_ADMIN_ROLE`.**

| Contract | DEFAULT_ADMIN_ROLE holder |
|---|---|
| FundVaultV01 | `ProtocolTimelockV02` (`0x054Cb2c32D6062B291420584dE2e5952C372cDD6`) |
| StrategyManagerV01 | `ProtocolTimelockV02` |
| LockLedgerV02 | `ProtocolTimelockV02` |
| LockRewardManagerV02 | `ProtocolTimelockV02` |
| BeneficiaryModuleV02 | `ProtocolTimelockV02` |
| GovernanceSignalV02 | `ProtocolTimelockV02` |
| ClaimLedger | `ProtocolTimelockV02` |

Non-emergency governance changes (parameter updates, role grants, module configuration) are subject to a **24-hour timelock delay** enforced by `ProtocolTimelockV02`.

The deployer EOA retains `PROPOSER_ROLE` on the Timelock, allowing it to schedule governance operations. `TIMELOCK_ADMIN_ROLE` is intentionally retained by the deployer until a multisig is introduced.

---

## Emergency Controls

`EMERGENCY_ROLE` is held by the guardian address. Emergency controls are limited to:

- `pause()` — suspends deposits or invests
- `setMode(Paused)` — sets protocol to paused state

Emergency role **cannot** redirect funds, modify parameters, or bypass the strategy manager layer. Only `DEFAULT_ADMIN_ROLE` (held by the Timelock) can set `EmergencyExit` mode or unpause.

---

## Fund Safety Boundary

User assets remain non-custodial within the protocol contracts.

- USDC deposits are held in `FundVaultV01` or deployed to `AaveV3StrategyV01` via `StrategyManagerV01`.
- Strategy allocation is capped on-chain (max 70% deployable; reserve ratio enforced).
- Users can redeem `fbUSDC` shares at any time (subject to available liquidity). Emergency claim paths exist for `EmergencyExit` mode.
- The commitment layer (`LockRewardManagerV02`) holds no user USDC directly — only vault shares locked by user action.

---

## Audit Status

**Formal third-party audit: Pending.**

The current deployment should be treated as an **internal validation deployment**, not a fully audited public release.

Security model currently includes:
- Role-based access control (`DEFAULT_ADMIN_ROLE`, `EMERGENCY_ROLE`, `PROPOSER_ROLE`)
- 24-hour `ProtocolTimelockV02` for all non-emergency governance operations
- Separated vault and strategy manager (no direct access between layers)
- Reserve and strategy exposure hard caps (on-chain constants)
- Mainnet transaction traceability through BaseScan

See [`../SECURITY.md`](../SECURITY.md) for responsible disclosure policy.

---

## Public Expansion Preconditions

Before broader public onboarding, the protocol should complete:

- [ ] Formal external security audit
- [ ] Updated security review and audit plan
- [ ] Final role and timelock verification (post-multisig introduction)
- [ ] Public risk disclosure documentation
- [ ] Documented incident response and emergency procedures
- [ ] Removal of invited-only access controls
