// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILockLedgerV02
/// @notice Interface for the V02 lock ledger module
interface ILockLedgerV02 {
    // -------------------------------------------------------------------------
    // Data
    // -------------------------------------------------------------------------

    struct LockPosition {
        address owner;
        uint256 shares;       // fbUSDC locked
        uint64  lockedAt;     // timestamp of lock creation
        uint64  unlockAt;     // timestamp when normal unlock is allowed
        uint64  endedAt;      // timestamp when position ended (unlock or earlyExit); 0 = still active
        bool    unlocked;     // true = shares already returned (normal or early)
        bool    earlyExited;  // true = exited before maturity; points forfeited
    }

    // -------------------------------------------------------------------------
    // User operations
    // -------------------------------------------------------------------------

    /// @notice Withdraw locked shares after unlock time has passed
    /// @param lockId The lock position to unlock
    function unlock(uint256 lockId) external;

    /// @notice Lock shares on behalf of owner — only OPERATOR_ROLE
    /// @dev Called by LockRewardManagerV02; owner must have approved shares to this contract
    /// @param owner  Address that will own the lock position
    /// @param shares Amount of vault shares to lock
    /// @param duration Lock duration in seconds
    /// @return lockId Unique identifier for this lock position
    function lockFor(address owner, uint256 shares, uint64 duration) external returns (uint256 lockId);

    /// @notice Exit a lock on behalf of owner — only OPERATOR_ROLE
    /// @dev Called by LockRewardManagerV02 after token return is verified
    /// @param lockId The lock position to exit early
    /// @param owner  Expected owner of the position (validated inside)
    function earlyExitFor(uint256 lockId, address owner) external;

    /// @notice Transfer lock ownership to a new address — only OPERATOR_ROLE
    /// @dev Used by BeneficiaryModuleV02 for inheritance.
    ///      Updates both activeLockCount and _userLockIds for old and new owner.
    ///      Reverts if newOwner would exceed MAX_ACTIVE_LOCKS_PER_USER.
    ///      Emits LockOwnershipTransferred(lockId, oldOwner, newOwner, timestamp) for off-chain history.
    /// @param lockId   The active lock position to transfer
    /// @param newOwner Address that will become the new owner
    function transferLockOwnership(uint256 lockId, address newOwner) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Get full details of a lock position
    function getLock(uint256 lockId) external view returns (LockPosition memory);

    /// @notice All lock IDs belonging to `owner` (includes unlocked positions)
    function userLockIds(address owner) external view returns (uint256[] memory);

    /// @notice Total number of lock positions ever created by `owner`
    function userLockCount(address owner) external view returns (uint256);

    /// @notice Number of currently active (not yet unlocked) positions for `owner`
    /// @dev Always <= MAX_ACTIVE_LOCKS_PER_USER
    function activeLockCount(address owner) external view returns (uint256);

    /// @notice Total vault shares currently held in the contract
    function totalLockedShares() external view returns (uint256);

    /// @notice Sum of shares across all active (not yet unlocked) lock positions owned by `owner`.
    /// @dev Iterates _userLockIds; gas cost scales with total lock count (ever), not just active count.
    ///      Recommended for frontend balance display — avoids client-side aggregation loop.
    function userLockedSharesOf(address owner) external view returns (uint256);

    /// @notice Historical locked shares for `owner` at a given point in time.
    /// @dev Iterates all lock positions for owner; counts a position as active at `timestamp` if
    ///      lockedAt <= timestamp && (endedAt == 0 || endedAt > timestamp).
    ///      Caveat: after transferLockOwnership() the transferred lock is removed from oldOwner's
    ///      index. Queries for oldOwner at t < transfer time will undercount. Use
    ///      LockOwnershipTransferred events for precise off-chain reconstruction.
    function lockedSharesOfAt(address owner, uint256 timestamp) external view returns (uint256);
}
