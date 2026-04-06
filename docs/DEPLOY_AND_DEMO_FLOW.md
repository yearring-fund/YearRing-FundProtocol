# Deploy and Demo Flow

> Complete guide for local demo, testnet deployment, and public demo state.

---

## Quick Start — Local Full Demo (Recommended)

One command runs all three scenes end-to-end with time-skip:

```bash
npx hardhat run scripts/v2/run_demo.ts
```

Output covers:
- Scene A: passive deposit → yield → redeem
- Scene B: 180d Gold lock → upfront RWT + fee rebate → maturity → unlock
- Scene C: 90d Silver lock → beneficiary claim → inherited unlock

No `.env` required for local demo.

---

## Reviewer Self-Serve — Single Wallet

A reviewer with one wallet can verify the protocol on Base Sepolia without running the full deploy/seed flow.

**Reviewer path (no admin keys needed):**

1. Open the frontend → connect wallet → switch to Base Sepolia
2. Mint MockUSDC → Approve USDC → Deposit → observe fbUSDC received
3. Lock fbUSDC → observe RWT issued immediately; check rebate preview
4. Inspect the pre-seeded Demo State panel (Alice / Bob / Carol) — read-only, no wallet needed for those addresses

To inspect the seeded state from the command line:

```bash
npx hardhat run scripts/v2/run_demo.ts --network baseSepolia
```

No transactions are submitted. Displays lock positions, tiers, states, and what is / is not demonstrable on-chain vs local demo.

> Scene B maturity/unlock and the full Carol → Bob claim path require the local script demo or the relevant persona private keys. These are **operator/guided demo paths**, not single-wallet reviewer paths.

---

## Testnet Deployment (Base Sepolia)

### Prerequisites

`.env` file in project root:

```env
# Required
PRIVATE_KEY=0x...          # deployer / admin / treasury (same key for testnet demo)

# Required for seed — demo personas must be distinct from deployer
ALICE_PRIVATE_KEY=0x...    # Scene B: long-term committed user
BOB_PRIVATE_KEY=0x...      # Scene A/C: free holder / beneficiary recipient
CAROL_PRIVATE_KEY=0x...    # Scene C: beneficiary origin

BASE_SEPOLIA_RPC_URL=https://sepolia.base.org  # or Alchemy/Infura
BASESCAN_API_KEY=...        # optional, for contract verification
```

Fund each account with:
- ETH for gas (~0.05 ETH per account is enough for the full seed)
- No USDC needed — `seed_v2.ts` deploys MockUSDC and mints automatically

### Step 1 — Deploy V01 base layer

```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
```

Deploys: MockUSDC, FundVaultV01, StrategyManagerV01, DummyStrategy.
Saves addresses to `deployments/baseSepolia.json`.

### Step 2 — Deploy V2 commitment layer (minimal demo build)

```bash
npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia
```

Default deploys: RewardToken, LockLedgerV02, LockBenefitV02, LockRewardManagerV02,
BeneficiaryModuleV02, UserStateEngineV02, MetricsLayerV02.

Optional modules (LockPointsV02, GovernanceSignalV02):

```bash
DEPLOY_OPTIONAL_MODULES=true npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia
```

Idempotent — re-running skips already-deployed modules unless `FORCE_REDEPLOY=true`.

### Step 3 — Configure roles and approvals

```bash
npx hardhat run scripts/v2/setup_v2.ts --network baseSepolia
```

- Grants OPERATOR_ROLE to LockRewardManager and BeneficiaryModule
- Treasury approves LockRewardManager for fbUSDC and RWT (MaxUint256)
- Sets vault management fee to exactly 100 bps/month
- Fails fast if signer does not match deployment admin address

### Step 4 — Seed demo positions

```bash
npx hardhat run scripts/v2/seed_v2.ts --network baseSepolia
```

Requires ALICE/BOB/CAROL_PRIVATE_KEY to be distinct from deployer.
Idempotent — fails if seed already exists unless `FORCE_RESEED=true`.

Creates observable on-chain state:

| Account | Action | Result |
|---|---|---|
| Alice | deposit 1000 USDC + lock 180d Gold | LockedAccumulating, RWT issued |
| Bob | deposit 200 USDC (no lock) | Free fbUSDC balance |
| Carol | deposit 500 USDC + lock 90d Silver + set Bob as beneficiary + admin marks inactive | Scene C demo-ready: Bob can execute claim |

Seed state (addresses + lock IDs) saved to `deployments/baseSepolia.json`.

### Step 5 — Inspect on-chain state

```bash
npx hardhat run scripts/v2/run_demo.ts --network baseSepolia
```

Inspection-only snapshot of all three pre-seeded positions. No transactions submitted.
Includes reviewer footer explaining what is/is not live-demonstrable.

### Step 6 — Reset (if needed)

```bash
npx hardhat run scripts/v2/reset_v2.ts --network baseSepolia
```

Archives old V2 addresses to `archivedV2[]` in JSON, cleans demo metadata,
then automatically runs `deploy_v2 → setup_v2 → seed_v2` in sequence.
V01 contracts (FundVaultV01, StrategyManager) are always preserved.

---

## Run Order Summary

```
Local (fresh EVM, full lifecycle):
  npx hardhat run scripts/v2/run_demo.ts

Testnet (persistent, observable state):
  deploy.ts        → V01 core
  deploy_v2.ts     → V2 modules (minimal by default)
  setup_v2.ts      → roles + approvals + fee config
  seed_v2.ts       → demo positions (alice / bob / carol, distinct keys required)
  run_demo.ts      → inspection-only state snapshot
  reset_v2.ts      → archive + auto-redeploy (if needed)
```

---

## Demo Accounts

### Local Hardhat (in-process, `--network hardhat`)
Uses Hardhat default signers in fixed index positions:

| Index | Role |
|---|---|
| 0 | (unused) |
| 1 | admin / guardian |
| 2 | guardian |
| 3 | treasury |
| 4 | alice |
| 5 | bob |
| 6 | carol |

### Testnet / localhost (external network)
Configured via `.env`. Deployer (index 0) is admin + treasury.
Alice, Bob, Carol are index 1–3, from `ALICE_PRIVATE_KEY` / `BOB_PRIVATE_KEY` / `CAROL_PRIVATE_KEY`.
Personas must be distinct from deployer — no silent fallback.

### localhost note
`localhost` is treated as an external network (not in-process Hardhat).
`run_demo.ts --network localhost` shows state snapshot, not full lifecycle demo.
Use `npx hardhat run scripts/v2/run_demo.ts` (no flag) for full lifecycle.

---

## What Testnet Shows vs What Local Demo Shows

| Capability | Testnet | Local |
|---|---|---|
| Contract deployment | ✅ Full V01 + V2 stack | ✅ Fresh per run |
| Lock creation (LockedAccumulating) | ✅ Pre-seeded | ✅ Live |
| RWT issued at lock time | ✅ Observable | ✅ Live |
| Fee rebate claim | ❌ Needs time elapsed | ✅ Time-skipped |
| Lock maturity (Matured state) | ❌ Needs real time | ✅ Time-skipped |
| Beneficiary claim (executeClaim) | ✅ Bob can execute | ✅ Live |
| Unlock + redeem | ❌ Needs maturity | ✅ After time-skip |
| pricePerShare after yield | ✅ DummyStrategy callable | ✅ Live |
| MetricsLayer snapshot | ✅ Observable | ✅ Live |

**On testnet**: Scene B maturity and Scene C unlock require real time.
The pre-seeded positions will become unlockable on their natural `unlockAt` dates.
For full lifecycle demonstration, use the local demo.

---

## Deployment Artifacts

All deployed addresses are stored in:

```
deployments/
  baseSepolia.json  # testnet — committed to repo after deployment
```

The JSON structure:

```json
{
  "network": "baseSepolia",
  "contracts": {
    "MockUSDC": "0x...",
    "FundVaultV01": "0x...",
    "StrategyManagerV01": "0x...",
    "DummyStrategy": "0x...",
    "RewardToken": "0x...",
    "LockLedgerV02": "0x...",
    "LockBenefitV02": "0x...",
    "LockRewardManagerV02": "0x...",
    "BeneficiaryModuleV02": "0x...",
    "UserStateEngineV02": "0x...",
    "MetricsLayerV02": "0x..."
  },
  "config": { "admin": "0x...", "treasury": "0x...", "guardian": "0x..." },
  "v2": {
    "mode": "demo-minimal",
    "optionalModulesDeployed": false,
    "deployedAt": "...",
    "deployedBy": "0x..."
  },
  "v2Setup": {
    "completedAt": "...",
    "completedBy": "0x...",
    "fbUSDCApproved": true,
    "rwtApproved": true,
    "mgmtFeeBpsPerMonth": 100
  },
  "seed": {
    "seededAt": "...",
    "alice": { "address": "0x...", "lockId": "0", "scenario": "B - Gold 180d" },
    "bob":   { "address": "0x...", "lockId": null, "scenario": "A - free holder / C beneficiary" },
    "carol": { "address": "0x...", "lockId": "1", "scenario": "C - Silver 90d + beneficiary" }
  },
  "archivedV2": [
    { "archivedAt": "...", "contracts": { "LockLedgerV02": "0x...", "..." : "0x..." } }
  ]
}
```

---

## Known Demo Limitations

See `docs/V2_LIMITATIONS_AND_V3_NOTES.md` for full list. Key points:

1. **Testnet maturity**: Lock positions seeded at deploy cannot reach maturity without real time passing (30–180 days depending on tier). Full lifecycle is demonstrated via local demo with `evm_increaseTime`.

2. **Free fbUSDC not transferred in beneficiary claim**: `executeClaim` transfers locked positions only. Carol's free balance stays in Carol's wallet.

3. **Fee rebate on inherited lock**: Rebate entitlement stays with the original lock owner (Carol). Bob inherits the lock position but not the rebate rights.

4. **DummyStrategy on testnet**: Yield is simulated via `usdc.mint()` to the strategy contract. No real Aave integration in demo build.

5. **MockUSDC is the canonical demo asset**: All demo builds use MockUSDC (mintable). Circle USDC not used in demo flow.
