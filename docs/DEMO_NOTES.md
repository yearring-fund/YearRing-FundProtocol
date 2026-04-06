# Demo Notes — FinancialBase V2

## How to Run

```bash
npx hardhat run scripts/demo_a.ts   # Scene A: Regular User
npx hardhat run scripts/demo_b.ts   # Scene B: Long-Term User
npx hardhat run scripts/demo_c.ts   # Scene C: Beneficiary
```

Each script is self-contained and can be run independently.
All scripts use a local Hardhat network (no external RPC needed).

---

## Scene A — Regular User Path

**File**: `scripts/demo_a.ts`

**Flow**: deposit → strategy yields → withdraw

**Product narrative**:
Shows that fbUSDC is not a fixed-rate stablecoin. The underlying USDC is deployed
to a strategy (e.g., Aave). When strategy yields, `pricePerShare` rises and every
holder benefits proportionally — no action required.

**Key outputs**:
- `pricePerShare` before and after yield
- USDC received on withdrawal > amount deposited
- Net gain displayed explicitly

**What differentiates this from a normal vault**:
100% reserve model means no liquidity risk. Strategy layer is governed separately
from the vault. Users can withdraw at any time (when reserve allows).

---

## Scene B — Long-Term Committed User Path

**File**: `scripts/demo_b.ts`

**Flow**: deposit → lock 180d (Gold) → yield accrues → matured → unlock → redeem

**Product narrative**:
Committed users receive upfront reward tokens at lock time proportional to
principal × duration × tier multiplier. Points accumulate continuously during
the lock period. Fee discount (60% for Gold) reduces management fee drag.
After 180 days the lock matures — user unlocks and redeems with full yield.

**Key outputs**:
- Reward tokens issued immediately on lock (6480 RWT for 1000 USDC × 180d)
- Fee discount percentage (Gold: 60%)
- Points accrued at maturity
- Final USDC with yield

**What differentiates this**:
Three stacked incentives for locking (reward token + points + fee discount) vs.
passive holding. Incentives are deterministic and on-chain — no off-chain
promises.

---

## Scene C — Beneficiary Path

**File**: `scripts/demo_c.ts`

**Flow**: deposit → lock → set beneficiary → admin triggers → claim → unlock → redeem

**Product narrative**:
Users with long-term locked capital can designate a beneficiary. If the user
becomes inactive (365-day heartbeat threshold, or oracle/admin trigger), the
beneficiary can claim the lock position with state fully preserved — same
duration, same unlockAt. No forced early exit. Points remain with the original
owner.

**Key outputs**:
- Lock ownership transfers from alice → bob
- `unlockAt` unchanged after claim (lock integrity demonstrated)
- State remains `LockedAccumulating` through the transfer
- Bob can unlock normally at maturity and redeem USDC

**What differentiates this**:
On-chain long-term asset protection. Lock positions are transferable via
governance-controlled inheritance — not lost if the original holder becomes
unreachable. Demonstrates that FinancialBase is designed for multi-decade
capital commitments.

---

## Known Display Notes

- **RWT amounts**: displayed as `rawValue / 10^6` for readability. The reward
  token has 18 decimals; formula output uses USDC scale (6 dec). A V3 formula
  update will align units. See `docs/V3_KNOWN_ISSUES.md`.
- **pricePerShare after full redemption**: not shown (meaningless when totalSupply = 0).

---

## Demo Sequence Recommendation

For a recorded demo or presentation, run in order A → B → C to build the narrative:

1. **A**: "Anyone can earn yield — here's the baseline"
2. **B**: "Committed users earn more — upfront tokens, points, fee discount"
3. **C**: "Long-term capital is protected — beneficiary mechanism preserves the lock"
