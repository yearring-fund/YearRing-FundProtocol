# Demo Script Summary

Three demo scripts cover the full product narrative in sequence. Each script is self-contained, runs on a local Hardhat network, and produces formatted console output with explicit before/after values.

Run order for a recorded demo or presentation: **A → B → C**

```bash
npx hardhat run scripts/demo_a.ts   # Scene A: Regular User
npx hardhat run scripts/demo_b.ts   # Scene B: Long-Term Committed User
npx hardhat run scripts/demo_c.ts   # Scene C: Beneficiary
```

---

## Scene A — Regular User Path

**Flow**: deposit → strategy yields → withdraw

**What this proves**:

The vault is a real yield product, not a points farm. USDC deposited into the vault is deployed to an external strategy. When the strategy earns, `pricePerShare` rises — every holder benefits proportionally without taking any action. Withdrawal returns more USDC than was deposited.

This scene establishes the baseline: FinancialBase works as a yield product first. Everything else is built on top of that foundation.

**Key numbers shown**:
- `pricePerShare` before and after strategy yield
- USDC received on withdrawal vs. amount deposited
- Net gain displayed explicitly

**Narrative anchor**: "Here is the floor — real yield from a real strategy. No token required to earn this."

---

## Scene B — Long-Term Committed User Path

**Flow**: deposit → lock 180d (Gold tier) → yield accrues → maturity → unlock → redeem

**What this proves**:

Committed users receive a qualitatively different experience, not just a higher APY number. Two distinct incentives stack on top of the baseline yield:

1. **Upfront reward tokens (RWT)** — issued immediately at lock time, before any yield has accrued. Under the current demo parameters, locking 1000 USDC at Gold tier for 180 days issues RWT upfront proportional to principal × duration × tier multiplier.
2. **Management fee rebate** — 60% of management fees returned as fbUSDC shares over the lock duration. Claimable at any time. Reduces the net cost of holding long-term.

The combination means the effective return for a Gold-tier committed user is materially higher than a passive holder, and both incentives are deterministic — no off-chain discretion, no season resets.

**Key numbers shown**:
- RWT issued at lock time (amount shown under current demo parameters)
- Fee rebate accrued over lock duration (Gold: 60% discount rate)
- Final USDC redeemed including full yield

**Narrative anchor**: "Commitment is rewarded immediately and on-chain. Two incentives, neither of which requires trusting a team."

---

## Scene C — Beneficiary Path

**Flow**: deposit → lock → set beneficiary → inactivity trigger → beneficiary claims → unlock → redeem

**What this proves**:

A committed lock position has a defined maturity date — but the original holder may become inactive before that date arrives. Most protocols have no mechanism for this. The position sits locked, inaccessible until the holder returns or the lock expires.

FinancialBase has an on-chain answer. The original holder designates a beneficiary address. Once a predefined inactivity condition is satisfied, the beneficiary can continue the position under the predefined claim path, without shortening the lock duration:
- Same `unlockAt` — the lock duration is never shortened
- Same shares — no penalty applied
- **Not inherited:** fee rebate entitlement (accrues to the original lock owner only); free fbUSDC wallet balance (recorded via event, not transferred on-chain)

At maturity, the beneficiary unlocks and redeems normally. The demo shows the lock position continuity path; fee rebate and free balance transfer are out of scope for this scene.

This scene demonstrates that FinancialBase is designed for capital with a genuine time horizon — not capital that needs to be able to exit tomorrow.

**Key numbers shown**:
- Lock position claimed by beneficiary (lock duration and shares preserved; `unlockAt` unchanged)
- `unlockAt` before and after claim (unchanged)
- State at each step: Deposited → LockedAccumulating → Claimed → Unlocked → Redeemed
- Final USDC redeemed by beneficiary

**Narrative anchor**: "A committed position should be completable — not stranded. The beneficiary mechanism ensures that lock positions can reach maturity even when the original holder cannot act."

---

## Demo Sequence Logic

*This sequence reflects the current local V2 demo build, not a completed testnet deployment.*

| Scene | Establishes | Sets up |
|---|---|---|
| A | The floor: real yield exists without any commitment | Why commitment adds value on top |
| B | Commitment is rewarded with two stacked on-chain incentives (RWT + fee rebate) | Why the system needs to protect long-term positions |
| C | Committed positions have an on-chain continuity guarantee — locks can reach maturity | The complete picture: yield + commitment + continuity |
