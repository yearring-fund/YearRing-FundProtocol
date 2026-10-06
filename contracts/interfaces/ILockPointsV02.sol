// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILockPointsV02
/// @notice Read-only interface for lock points queries
/// @dev Points are derived purely from lock state — no storage, no transfers.
///      Not exposed in V2 frontend; reserved for V3+ governance / reward boost.
interface ILockPointsV02 {
    /// @notice Points accumulated by a single lock position
    /// @dev Stops growing after unlock. Returns 0 for non-existent positions.
    /// @param lockId Lock position ID in LockLedgerV02
    /// @return points Accumulated points (18 decimals, same as RewardToken formula)
    function pointsOf(uint256 lockId) external view returns (uint256 points);

    /// @notice Total points across all lock positions ever created by owner
    /// @dev Includes unlocked positions (their points are frozen at unlock time).
    /// @param owner Wallet address
    /// @return points Sum of pointsOf across all lockIds for owner
    function totalPointsOf(address owner) external view returns (uint256 points);
}
