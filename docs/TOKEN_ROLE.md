# TOKEN_ROLE — The Role of the Protocol Token

> The token does not create yield. The vault creates yield. The token rewards commitment to that yield.

---

## The Token Is Not Used to Fabricate Baseline Returns

The most common failure mode in DeFi is a protocol that appears to offer high yield, but the yield is paid in its own token — a circular system where the token's value depends entirely on new inflows sustaining the emission rate.

FinancialBase does not do this.

The underlying yield comes from the vault's strategy layer (currently Aave V3 on Base). This yield exists regardless of whether the protocol token exists, and regardless of its price. If the reward token goes to zero, users still earn real yield on their deposited USDC through `pricePerShare` appreciation.

The token is issued on top of real yield, not instead of it.

---

## How the Token Carries Long-Term Commitment and Governance

The protocol token serves two roles, both tied to actual user behavior rather than speculation:

### Role 1 — Commitment Signal

Tokens are issued upfront when a user locks their vault shares. The amount is proportional to:
- Principal (USDC value of locked shares)
- Duration (longer lock = more tokens, non-linearly)
- Tier multiplier (under the current parameter set, Gold earns 10.8× more reward tokens than Bronze for the same principal)

To exit early, the user must return the full issued amount. This means holding the token is evidence of a standing commitment. A user who sold or lost their tokens cannot exit early without acquiring them back at market price — a real economic cost.

This mechanism can create protocol-native demand for the token without any inflationary emission loop: demand is driven by users who need tokens to exit, or who want to demonstrate commitment depth.

### Role 2 — Future Governance Weight

The same token is intended to carry governance weight in a future on-chain parameter governance module. Note: the current governance signaling module depends on a snapshot-capable RWT — `RewardToken` extends `ERC20Snapshot` (OZ v4) so that voting power is frozen at proposal-creation time rather than read at vote time. Governable parameters include management fee rate, tier thresholds, lock duration bounds, and strategy allocation limits. Current status: governance is not yet live in the current build.

The design rationale: governance weight should be held by participants who have skin in the game, not by speculators. Because the token is earned by locking capital — not by purchasing it on the open market — the token distribution naturally skews toward long-term protocol participants.

This structure may be more resistant to hostile takeover than a purely freely distributed governance token, though secondary market trading remains possible and early holders may sell.

---

## Two Layers, Two Dependencies

The protocol has two distinct dependency profiles. Conflating them produces a false picture.

**The vault layer is token-independent.** If the reward token is removed entirely, the vault still earns yield from the strategy, `pricePerShare` still appreciates, and users can still deposit and redeem. The vault accounting model does not depend on the token in any way.

**The current commitment layer is token-dependent.** Upfront reward token issuance and the early-exit return mechanism are core to how `LockRewardManagerV02` works in V2. The commitment incentive exists because of the token — removing it would require redesigning the commitment structure, not just toggling a flag.

So the correct statement is not that "the whole system works without the token." The correct statement is:

**yield does not depend on the token; the current commitment mechanism does.**

This distinction matters because it clarifies the token's actual role:
- The token does not create the base yield.
- The token does not define the vault's accounting model.
- But the token does power the current commitment incentive and early-exit discipline.

The vault can be presented independently of the token layer. The full commitment layer narrative requires the token to be present.

---

## Summary

| Question | Answer |
|---|---|
| Where does baseline yield come from? | Vault strategy (Aave V3) — independent of token |
| Why would anyone hold the token? | Issued for commitment; required to exit early without penalty |
| What constrains pure speculation? | Initial token distribution is tied to lock commitment rather than open-market purchase |
| What is the token's long-term role? | Governance weight — held by committed participants, not passive speculators |
| Can the vault survive without the token? | Yes — yield, fee rebate, and beneficiary continuity all function independently |
| Can the commitment layer survive without the token? | No — upfront issuance and early-exit return are token-dependent in the current V2 design |
