# Frontend Demo Guide

> Single-page testnet demo for YearRing-FundProtocol (V2).
> Vite + React + TypeScript + wagmi v2 + viem.
> Connects to Base Sepolia via MetaMask (or any injected wallet).

---

## Quick Start

### 1. Deploy contracts and seed demo positions

```bash
npx hardhat run scripts/deploy.ts            --network baseSepolia
npx hardhat run scripts/v2/deploy_v2.ts      --network baseSepolia
npx hardhat run scripts/v2/setup_v2.ts       --network baseSepolia
npx hardhat run scripts/v2/seed_v2.ts        --network baseSepolia
```

### 2. Sync contract addresses to frontend

```bash
npx hardhat run scripts/update_frontend_config.ts --network baseSepolia
```

This patches `frontend/src/contracts/addresses.ts` with deployed addresses from
`deployments/baseSepolia.json`.

### 3. Install dependencies and start the dev server

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
# → http://localhost:5173
```

### 4. Connect your wallet

- Open the page in a browser with MetaMask installed
- Click **Connect Wallet** (header)
- If on the wrong network, the page shows a **Switch to Base Sepolia** button
- Network: Base Sepolia (chain ID 84532)

---

## Page Sections

### Header — Wallet
Connect / disconnect your injected wallet. Shows current address and a Base Sepolia badge
when on the correct network.

### Stats Bar
Live on-chain stats — click ↻ to refresh:
| Stat | Source |
|------|--------|
| Total Value Locked | `vault.totalAssets()` |
| Price Per Share | `vault.pricePerShare()` — rises as strategy earns yield |
| Locked Ratio | `snapshot().lockedRatioBps / 100` |
| Total Locks Ever | `snapshot().totalLocksEver` |

### Vault
| Action | Description |
|--------|-------------|
| Mint MockUSDC | `MockUSDC.mint(address, amount)` — no role needed on testnet |
| Deposit | Enter amount. Button auto-switches: **Approve USDC** when allowance is insufficient, then **Deposit** once approved. |
| Redeem | `vault.redeem(shares, receiver, owner)`. **Max** button fills full share balance. |

### Lock
| Action | Description |
|--------|-------------|
| Lock + Earn RWT | Select tier and enter amount. Button auto-switches: **Approve fbUSDC** (targets **LockLedger**, not LockRewardManager) then **Lock + Earn RWT**. RWT issued upfront on lock. |
| Claim Rebate | `LockRewardManager.claimRebate(lockId)` — pays accrued fbUSDC from treasury. Available inline per lock row. |
| Unlock (matured) | `LockLedger.unlock(lockId)` — visible in lock row once `unlockAt` has passed. |
| Early Exit | Approve RWT → `earlyExitWithReturn(lockId)`. Full principal returned; all issued RWT must be returned. |

> On Base Sepolia: lock entry, RWT issuance, and rebate preview are live. Maturity/unlock requires real time (30–180 days). For the full lifecycle, use the local script demo.

Lock tiers (duration → RWT multiplier → fee discount):
| Tier   | Duration  | RWT multiplier | Fee discount |
|--------|-----------|----------------|--------------|
| Bronze | 30 days   | 1.0×           | 20%          |
| Silver | 90 days   | 1.3×           | 40%          |
| Gold   | 180 days  | 1.8×           | 60%          |

### Incentives
- **RWT Balance** — your current Reward Token balance
- **Fee discount and rebate explanation** — tier-based discount reference

Claim Rebate is available inline on each lock row in the Lock section.

### User State
- Derived from `UserStateEngineV02.userStateOf(address)`
- Shows total / locked / free fbUSDC split

| State | Meaning |
|-------|---------|
| Normal | No active lock |
| Locked (Accumulating) | Lock live, rebate accruing |
| Matured | Past unlockAt, ready to unlock |
| Early Exited | Exited before maturity, RWT returned |

### Beneficiary
| Action | What it does |
|--------|-------------|
| Set Beneficiary | `BeneficiaryModule.setBeneficiary(address)` |
| Heartbeat | `heartbeat()` — records last-active timestamp; only this resets the inactivity timer |
| Execute Claim | `executeClaim(originalOwner, lockIds[])` — transfers locked positions to beneficiary |

Inactivity threshold: 365 days. Admin can also mark a user inactive directly
(`adminMarkInactive`) — not exposed in the UI.

### Strategy / Metrics
| Display | Source |
|---------|--------|
| Total assets | `vault.totalAssets()` |
| In vault (liquid) | `USDC.balanceOf(vault)` |
| In strategy manager | `strategyManager.totalManagedAssets()` |
| Deployed to strategy | `totalManagedAssets − idleUnderlying` |
| Idle in manager | `strategyManager.idleUnderlying()` |

Demo uses **DummyStrategy**. Admin simulates yield by minting USDC to the strategy contract.
`pricePerShare` stays flat until the admin triggers a yield event.

### Seeded Demo State
Read-only inspection panel. When persona addresses are configured (via `scripts/update_frontend_config.ts`), Alice / Bob / Carol cards **auto-load** — no manual address entry needed. Manual entry is a fallback for unconfigured deployments. No wallet connection required to inspect these addresses.

---

## Demo Scenarios

### Scene A — Passive Yield User
1. Connect a fresh wallet
2. Mint 1,000 MockUSDC → Vault section
3. Approve USDC → Deposit → receive fbUSDC
4. *(Admin simulates yield in strategy)*
5. ↻ Refresh — observe pricePerShare increase
6. Redeem all fbUSDC → receive more USDC than deposited

**Shows:** ERC4626 share accounting, passive yield without lock commitment.

---

### Scene B — Long-Term Committed User

> **Reviewer (no keys needed):** inspect the pre-seeded Alice position in the Demo State section.
> **Operator path (requires wallet):** follow the steps below.

1. Connect wallet → Vault: mint 1,000 USDC → Approve USDC → Deposit
2. Lock: select Gold (180d) → Approve fbUSDC → Lock + Earn RWT
3. ↻ Observe: RWT issued immediately (lock row shows `issuedRewardTokens`)
4. Claim Fee Rebate → fbUSDC from treasury
5. *(Full lifecycle: use local script demo `npx hardhat run scripts/v2/run_demo.ts`)*
6. Lock reaches Matured → Unlock → shares returned → Redeem

**Shows:** upfront RWT incentive, linear fee rebate, full lock lifecycle.

---

### Scene C — Beneficiary Path

> **Reviewer (no keys needed):** inspect the pre-seeded Carol/Bob positions in the Demo State section. Carol shows inactive + claimed; Bob shows inherited lock.
> **Operator path (requires Carol's and Bob's keys):** follow the steps below.

1. Connect Carol's wallet → Deposit 500 USDC → Lock → Silver (90d) → Set Bob as beneficiary
2. *(Admin calls `adminMarkInactive(carol)` via Hardhat script)*
3. Connect Bob's wallet → Beneficiary section → Enter Carol's address + lock ID → Execute Claim
4. ↻ Observe: Demo State shows Carol claimed=Yes, Bob has lock
5. *(After maturity)* Bob unlocks and redeems

**Shows:** beneficiary designation, admin-triggered inactivity, lock continuity.

---

## Configuration

### After deployment
Addresses live in `frontend/src/contracts/addresses.ts`.
The script `scripts/update_frontend_config.ts` patches them automatically:

```bash
npx hardhat run scripts/update_frontend_config.ts --network baseSepolia
```

### Local Hardhat node (frontend + manual interaction)

To connect the frontend to a local deployment for manual step-through:

```bash
npx hardhat node
# in another terminal:
npx hardhat run scripts/deploy.ts              --network localhost
npx hardhat run scripts/v2/deploy_v2.ts        --network localhost
npx hardhat run scripts/v2/setup_v2.ts         --network localhost
npx hardhat run scripts/v2/seed_v2.ts          --network localhost
npx hardhat run scripts/update_frontend_config.ts --network localhost
```

In `frontend/src/wagmiConfig.ts`, add `localhost` (chain ID 31337) to the chains array
and point the transport to `http://127.0.0.1:8545`.

> For the **full lifecycle script demo** (maturity/unlock via `evm_increaseTime`), use `npx hardhat run scripts/v2/run_demo.ts` (no network flag) instead.

---

## Known Limitations

See `docs/V2_LIMITATIONS_AND_V3_NOTES.md` for the full contract-level list.
Frontend-specific notes:

- **No auto-refresh.** Click ↻ on each section to update on-chain state.
- **Maturity on testnet.** Fresh locks will not mature for 30–180 days depending on tier. Use a local Hardhat node
  with `evm_increaseTime` for the full lifecycle.
- **Admin actions not exposed.** `adminMarkInactive` and yield simulation require the admin wallet and Hardhat scripts.
- **Beneficiary: locked positions only.** `executeClaim` does not transfer free fbUSDC balance.
- **Rebate rights not inherited.** Fee rebate stays with the original lock owner after claim.
- **MAX 5 active locks per address.**
