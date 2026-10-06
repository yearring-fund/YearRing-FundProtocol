# Known Limitations

> This document covers V2 demo build limitations across three categories:
> demo-specific parameters, unfinished modules, and testnet-only mechanics.
>
> For contract-level V2 limitations and recommended V3 fixes, see
> [`V2_LIMITATIONS_AND_V3_NOTES.md`](V2_LIMITATIONS_AND_V3_NOTES.md).

---

## 1. Demo Parameters (Not Production Values)

These are deliberate simplifications for a demo build — not production-ready values.

| Parameter | Demo Value | Production Consideration |
|---|---|---|
| MockUSDC | Publicly mintable — no role or faucet needed | Real asset with access controls |
| DummyStrategy | No autonomous yield — admin manually simulates | Live Aave V3 or equivalent yield source |
| `mgmtFeeBpsPerMonth` | 9 bps/month (~1.08%/year) | Subject to governance and market rate; contract cap 200 bps/month |
| `reserveRatioBps` | 3,000 bps (30%) | Optimized per strategy liquidity profile |
| RWT total supply | 1,000,000 RWT fixed at deploy | Token design and emission schedule TBD |
| Tier durations | 30 / 90 / 180 days | Could support arbitrary durations in V3 |
| Max active locks | 5 per address | Arbitrary cap for demo simplicity |

---

## 2. Modules Not in Current Demo Scope

These contracts exist in the codebase but are not part of the current demo-facing frontend or scripts.

| Module | Status | Note |
|---|---|---|
| `LockPointsV02` | Deployed but not demo-facing | On-read computation only; no separate points incentive layer |
| `GovernanceSignalV02` | Deployed but not demo-facing | Signal-only; no execution path or voting UI |
| `MerkleRewardsDistributorV01` | V01 only; not wired into V2 demo | Epoch-based claims; would require off-chain Merkle tree |
| `AaveV3StrategyV01` | Not wired in demo | Requires live Aave V3 pool and liquidity; replaced by DummyStrategy |

**Why no independent points system:** The current incentive stack (RWT + fee rebate) is the user-facing reward layer. `LockPointsV02` exists as an on-read weight computation module only — it does not constitute a third independent reward layer and is not exposed to users in this build.

---

## 3. Testnet-Only Mechanics

These behaviors differ from what a production deployment would look like.

**Lock maturity on testnet:**
Fresh locks on Base Sepolia will not mature for 30–180 days depending on tier. The full lifecycle (lock → mature → unlock) requires a local Hardhat node with `evm_increaseTime`. See [`DEMO_GUIDE.md`](DEMO_GUIDE.md) for the local setup steps.

**Strategy yield is admin-simulated:**
`pricePerShare` does not change automatically. An admin must mint MockUSDC to the strategy contract to simulate yield. This is intentional for demo reproducibility — a live Aave V3 strategy would provide autonomous yield.

**Beneficiary inactivity trigger:**
The 365-day inactivity threshold cannot be demonstrated passively on testnet. The admin uses `adminMarkInactive(address)` via Hardhat script to trigger the condition for demo purposes.

**No auto-refresh:**
The frontend does not poll for state changes. Click ↻ on each section to read the latest on-chain state.

---

## 4. Beneficiary Edge Cases (V2 Scope Boundary)

These are known design boundaries in the current V2 implementation. See [`V2_LIMITATIONS_AND_V3_NOTES.md`](V2_LIMITATIONS_AND_V3_NOTES.md) for full V3 fix proposals.

| Limitation | Detail |
|---|---|
| Free fbUSDC not transferred | `executeClaim` transfers lock ownership only. The original owner's free fbUSDC wallet balance is not touched on-chain. |
| Rebate rights not inherited | Fee rebate entitlement stays with the original lock owner after `executeClaim`. |
| `userStateOf` stale after claim | `UserStateEngineV02` may still show `LockedAccumulating` for the original owner after lock ownership transfer. Does not affect asset accounting. |
| Merkle reward forwarding | If the original owner had pending Merkle epoch rewards, these cannot be claimed by the beneficiary without admin intervention or a new epoch snapshot. |

---

## 5. What Is Not Implemented (By Design)

| Feature | Reason |
|---|---|
| DAO / governance execution | GovernanceSignalV02 is signal-only; no on-chain execution path in V2 |
| Multi-strategy parallel routing | Single active strategy per vault in V2 |
| Multiple simultaneous beneficiaries | Single beneficiary per user; no split-distribution |
| Full pension/annuity payout engine | Out of scope for this demo build |
| Multi-asset pools | Single USDC vault in this build |
