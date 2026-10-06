// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title IRebateManagerV21
/// @notice Orchestrates yrUSDC rebate payouts for YearRing V2.1 lock holders.
///
/// Claim flow (single transaction)
/// --------------------------------
/// 1. Verify caller is lock owner.
/// 2. Call LockManager.claimRebateOf(lockId):
///      - auto-checkpoints bonus Points and rebate
///      - zeroes lock.claimableRebateUSDC
///      - returns claimedUSDC (6-dec)
/// 3. Convert claimedUSDC → yrUSDCAmount via CoreVault.convertToShares().
/// 4. Call Treasury.ensureLiquidity(yrUSDCAmount) — attempts to settle fee units
///    from CoreSM / HT Managers into yrUSDC if reserve is low.
/// 5. Verify Treasury.yrUSDCBalance() >= yrUSDCAmount.
///    Reverts InsufficientRebateReserve if still insufficient.
/// 6. Call Treasury.withdrawRebate(owner, yrUSDCAmount).
///
/// Note: all state changes (LockManager + Treasury) revert atomically if any step fails.
interface IRebateManagerV21 {

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @notice LockManagerV21 address
    function lockManager() external view returns (address);

    /// @notice YearRingCoreVaultV21 address (used for convertToShares)
    function coreVault() external view returns (address);

    /// @notice TreasuryV21 address
    function treasury() external view returns (address);

    // -------------------------------------------------------------------------
    // Claim
    // -------------------------------------------------------------------------

    /// @notice Claim all accumulated yrUSDC rebate for `lockId`.
    ///         Caller must be the lock owner.
    ///         Internally checkpoints bonus Points + rebate before payout.
    ///         Eligible lock statuses: Active, Exited.
    ///         EarlyExited locks: not claimable (rebate already forfeited).
    function claimRebate(uint256 lockId) external;
}
