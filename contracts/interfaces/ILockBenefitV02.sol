// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILockBenefitV02
/// @notice Read-only interface for lock tier and multiplier queries
interface ILockBenefitV02 {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Lock tier derived from lock duration
    /// @dev None = position not found or already unlocked
    enum Tier { None, Bronze, Silver, Gold }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Tier of a lock position, derived from its duration
    /// @param lockId Lock position ID in LockLedgerV02
    /// @return Tier enum value (None if position invalid or unlocked)
    function tierOf(uint256 lockId) external view returns (Tier);

    /// @notice Reward multiplier in bps for a lock position
    /// @param lockId Lock position ID in LockLedgerV02
    /// @return multiplierBps 10000 = 1×, 13000 = 1.3×, 18000 = 1.8×; 0 if None
    function multiplierOf(uint256 lockId) external view returns (uint256 multiplierBps);

    /// @notice Reward multiplier in bps for a given Tier
    /// @param tier Tier enum value
    /// @return multiplierBps 0 if Tier.None
    function multiplierForTier(Tier tier) external pure returns (uint256 multiplierBps);

    /// @notice Derive tier directly from a duration value (seconds)
    /// @dev Useful for unlocked positions where tierOf() returns None
    /// @param duration Lock duration in seconds
    /// @return Tier enum value (None if duration outside [30 days, 365 days])
    function tierFromDuration(uint64 duration) external pure returns (Tier);

    /// @notice Multiplier in bps derived directly from a duration value
    /// @param duration Lock duration in seconds
    /// @return multiplierBps 0 if duration outside valid range
    function multiplierFromDuration(uint64 duration) external pure returns (uint256 multiplierBps);

    /// @notice Management fee discount in bps for a lock position
    /// @param lockId Lock position ID in LockLedgerV02
    /// @return discountBps 0 if Tier.None
    function feeDiscountBpsOf(uint256 lockId) external view returns (uint256 discountBps);

    /// @notice Management fee discount in bps for a given Tier
    /// @param tier Tier enum value
    /// @return discountBps Bronze=2000, Silver=4000, Gold=6000, None=0
    function feeDiscountForTier(Tier tier) external pure returns (uint256 discountBps);

    /// @notice Fee discount in bps derived directly from a duration value
    /// @param duration Lock duration in seconds
    /// @return discountBps 0 if duration outside valid range
    function feeDiscountFromDuration(uint64 duration) external pure returns (uint256 discountBps);
}
