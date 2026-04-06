// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILockRewardManagerV02
/// @notice Interface for the V02 lock reward manager
/// @dev Coordinates lock creation, reward token issuance, rebate claims, and early exit
interface ILockRewardManagerV02 {

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event LockedWithReward(
        uint256 indexed lockId,
        address indexed owner,
        uint256 shares,
        uint256 rewardTokensIssued
    );

    event RebateClaimed(
        uint256 indexed lockId,
        address indexed owner,
        uint256 rebateShares
    );

    event EarlyExitExecuted(
        uint256 indexed lockId,
        address indexed owner,
        uint256 rewardTokensReturned
    );

    // -------------------------------------------------------------------------
    // User operations
    // -------------------------------------------------------------------------

    /// @notice Lock shares and receive reward tokens upfront
    /// @dev Owner must approve vault shares to LockLedgerV02 before calling.
    ///      Reward tokens are issued immediately based on full lock duration + tier.
    /// @param shares   Amount of fbUSDC shares to lock
    /// @param duration Lock duration in seconds (must match a valid tier range)
    /// @return lockId  New lock position ID
    function lockWithReward(uint256 shares, uint64 duration) external returns (uint256 lockId);

    /// @notice Claim accrued management fee rebate for a lock position
    /// @dev Settles elapsed time since last claim. Can be called multiple times.
    /// @param lockId Lock position ID
    /// @return rebateShares Amount of fbUSDC shares returned from treasury
    function claimRebate(uint256 lockId) external returns (uint256 rebateShares);

    /// @notice Exit a lock before maturity — returns principal, forfeits unclaimed reward tokens
    /// @dev Owner must approve issuedRewardTokens[lockId] to this contract before calling.
    ///      Auto-settles any pending rebate before exiting.
    /// @param lockId Lock position ID
    function earlyExitWithReturn(uint256 lockId) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Reward tokens issued at lock time for a position
    function issuedRewardTokens(uint256 lockId) external view returns (uint256);

    /// @notice Timestamp of last rebate settlement for a position
    function lastRebateClaimedAt(uint256 lockId) external view returns (uint256);

    /// @notice Preview pending rebate shares for a lock position
    function previewRebate(uint256 lockId) external view returns (uint256 rebateShares);

    /// @notice Pre-flight check for claimRebate — returns amounts frontend needs to verify feasibility
    /// @dev Returns all zeros if the lock is inactive or does not exist.
    /// @param lockId Lock position ID
    /// @return rebateShares      Shares that would be transferred from treasury
    /// @return treasuryBalance   vault.balanceOf(treasury) — must be >= rebateShares
    /// @return treasuryAllowance vault.allowance(treasury, this) — must be >= rebateShares
    function checkClaimRebate(uint256 lockId) external view returns (
        uint256 rebateShares,
        uint256 treasuryBalance,
        uint256 treasuryAllowance
    );

    /// @notice Pre-flight check for earlyExitWithReturn — returns amounts frontend needs to verify feasibility
    /// @dev Returns all zeros if the lock is inactive, already exited, or mature.
    /// @param lockId Lock position ID
    /// @return rebateShares           Shares treasury must cover (auto-settled on exit)
    /// @return tokensToReturn         Reward tokens the lock owner must return
    /// @return treasuryShareBalance   vault.balanceOf(treasury)
    /// @return treasuryShareAllowance vault.allowance(treasury, this)
    /// @return userTokenBalance       rewardToken.balanceOf(lock owner)
    /// @return userTokenAllowance     rewardToken.allowance(lock owner, this)
    function checkEarlyExit(uint256 lockId) external view returns (
        uint256 rebateShares,
        uint256 tokensToReturn,
        uint256 treasuryShareBalance,
        uint256 treasuryShareAllowance,
        uint256 userTokenBalance,
        uint256 userTokenAllowance
    );
}
