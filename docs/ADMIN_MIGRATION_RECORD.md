# Admin Migration Record — YearRing Fund Protocol

## Summary

Admin migration completed on Base mainnet.

All core AccessControl contracts now use `ProtocolTimelockV02` as `DEFAULT_ADMIN_ROLE` holder.
The original deployer EOA no longer holds `DEFAULT_ADMIN_ROLE` on any protocol contract.

---

## Migration Status

| Contract | Address | Timelock is Admin | Deployer Revoked |
|---|---|---|---|
| FundVaultV01 | `0x9dD61ee543a9C51aBe7B26A89687C9aEeea98a54` | ✅ | ✅ |
| StrategyManagerV01 | `0xa44d3b9b0ECD6fFa4bD646957468c0B5Bfa64A54` | ✅ | ✅ |
| LockLedgerV02 | `0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF` | ✅ | ✅ |
| LockRewardManagerV02 | `0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a` | ✅ | ✅ |
| BeneficiaryModuleV02 | `0x6d463f7d78Ca3a1809971D5A43E5F57066d325cF` | ✅ | ✅ |
| GovernanceSignalV02 | `0x9BE5636943d7BfF57ACA6047Cf945FD770CcC7d0` | ✅ | ✅ |
| ClaimLedger | `0x5CF9b8EC75314115EDDE5Dd332C193995Dd55234` | ✅ | ✅ |

**ProtocolTimelockV02:** `0x054Cb2c32D6062B291420584dE2e5952C372cDD6`
**MIN_DELAY:** 24 hours

---

## Verification

Verified on-chain using:

```bash
EXECUTE=true npx hardhat run scripts/transfer_admin_to_timelock.ts --network base
```

All 7 contracts confirmed:
- Step 2: Timelock already has DEFAULT_ADMIN_ROLE on all contracts
- Step 3: Live verification passed (all ✅)
- Step 4: Deployer already lacks DEFAULT_ADMIN_ROLE on all contracts — nothing to revoke

No transactions were sent; migration was already complete on-chain prior to this verification run.

---

## Governance State

- `DEFAULT_ADMIN_ROLE` → `ProtocolTimelockV02` (all core contracts)
- `PROPOSER_ROLE` on Timelock → deployer/admin EOA (can schedule operations)
- `EMERGENCY_ROLE` → guardian (can pause without Timelock delay)
- `TIMELOCK_ADMIN_ROLE` → deployer (intentionally retained)

**TIMELOCK_ADMIN_ROLE renounce is intentionally deferred.**
Rationale: no multisig yet. Renouncing before a multisig holds PROPOSER_ROLE would leave
Timelock role management permanently locked. This will be revisited when a multisig is introduced.

---

## Canonical Address Correction

ADDRESSES.md was updated to reflect canonical V02 addresses verified on-chain.
Prior entries pointed to an earlier deployment that referenced a deprecated vault address.

| Contract | Old (stale) | Canonical (active) |
|---|---|---|
| LockRewardManagerV02 | `0xb29DeFCF75f71bc4DaFaA353cE294C284F5e07cB` | `0x129aEce0C7659575Ae7aB4e78bfe4ca8946B962a` |
| LockLedgerV02 | `0x2D95517Cc375ab2dc6433fd44A8706462A418a89` | `0x2FC1d315c67AE3Df2a062f7130d58FaA6c0ce9EF` |
