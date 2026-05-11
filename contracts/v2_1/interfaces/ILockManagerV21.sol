// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title ILockManagerV21
/// @notice Interface for the V2.1 lock contract.
///
/// Lock lifecycle
/// --------------
/// createLock → Active (YR_USDC)
///   → splitLock        → two Active locks (YR_USDC)
///   → enterAccessStrategyManager (Phase 3) → Active (MANAGER_UNITS)
///     → exitToLock (Phase 3)         → Active (YR_USDC)
///   → unlock           → Exited
///   → earlyExit        → EarlyExited
interface ILockManagerV21 {

    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Asset held inside the lock
    enum LockAssetType {
        None,
        YR_USDC,        // Lock holds yrUSDC; user earns Core-path rebate and Points
        MANAGER_UNITS   // Lock holds Access Manager units; user earns Access-path rebate
    }

    /// @notice Lifecycle stage of the lock
    enum LockStatus {
        None,
        Active,
        Exited,
        EarlyExited
    }

    /// @notice Set during atomic HT enter / exit to prevent re-entrancy on the same lockId
    enum LockTransition {
        None,
        EnteringManager,
        ExitingManager
    }

    // -------------------------------------------------------------------------
    // Struct
    // -------------------------------------------------------------------------

    struct LockInfo {
        address owner;

        /// @notice yrUSDC held in the lock (18 dec). Zero when assetType == MANAGER_UNITS.
        uint256 yrUSDCAmount;

        /// @notice USDC 6-decimal value at lock creation; updated on split and on exitToLock.
        ///         Used as the base for rebate calculations.
        uint256 principalAssetsUSDC;

        uint64 startTime;          // Lock creation timestamp
        uint64 minUnlockTime;      // Earliest unlock timestamp (= startTime + committedDuration)
        uint64 committedDuration;  // Chosen duration in seconds

        /// @notice Base Points issued once at createLock (18 dec)
        uint256 basePointsIssued;

        /// @notice Cumulative retention bonus Points credited so far (18 dec)
        uint256 bonusPointsIssued;

        /// @notice Timestamp of the last bonus Points checkpoint
        uint64 lastBonusPointsCheckpoint;

        /// @notice Timestamp of the last rebate checkpoint
        uint64 lastRebateCheckpoint;

        /// @notice Accumulated rebate not yet claimed, denominated in USDC 6 decimals
        uint256 claimableRebateUSDC;

        /// @notice HT Manager address — only valid when assetType == MANAGER_UNITS
        address manager;

        /// @notice Units held in the HT Manager — only valid when assetType == MANAGER_UNITS
        uint256 managerUnits;

        LockAssetType  assetType;
        LockStatus     status;
        LockTransition transition;
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    function getLock(uint256 lockId) external view returns (LockInfo memory);
    function ownerOf(uint256 lockId) external view returns (address);

    /// @notice Total Points attributed to a lock: basePointsIssued + bonusPointsIssued
    function totalPoints(uint256 lockId) external view returns (uint256);

    /// @notice Next lockId that will be assigned (locks start at 1)
    function nextLockId() external view returns (uint256);

    /// @notice Annual Core SM fee bps used for YR_USDC rebate calculation.
    ///         Mirrors CoreStrategyManagerV21.FEE_BPS; admin-configurable.
    function coreSMFeeBpsPerYear() external view returns (uint256);

    /// @notice Paginated lock enumeration for a user.
    ///         Returns a slice of the user's lock list [offset, offset+limit) and the total count.
    /// @param user    Address to query
    /// @param offset  Zero-based index of the first lock to return
    /// @param limit   Maximum number of lock IDs to return (0 returns empty array)
    /// @return lockIds  Slice of lock IDs
    /// @return total    Total number of locks owned by this user
    function getUserLockIds(address user, uint256 offset, uint256 limit)
        external view returns (uint256[] memory lockIds, uint256 total);

    // -------------------------------------------------------------------------
    // Core operations
    // -------------------------------------------------------------------------

    /// @notice Create a new lock by transferring yrUSDC from caller.
    ///         Requires yrUSDC approval first.
    /// @param yrUSDCAmount    Amount of yrUSDC to lock (18 dec)
    /// @param committedDuration  Minimum lock duration in seconds (>= 7 days)
    /// @return lockId  Newly created lock ID (>= 1)
    function createLock(uint256 yrUSDCAmount, uint64 committedDuration)
        external returns (uint256 lockId);

    /// @notice Split a YR_USDC lock into two locks; time fields are inherited.
    ///         Points and rebate are divided proportionally; dust stays in original.
    /// @param lockId      Lock to split (must be Active YR_USDC, transition None)
    /// @param splitYrUSDC Amount of yrUSDC to move into the new lock
    /// @return newLockId  ID of the newly created child lock
    function splitLock(uint256 lockId, uint256 splitYrUSDC)
        external returns (uint256 newLockId);

    /// @notice Unlock a matured lock and return yrUSDC to owner.
    ///         Requires assetType == YR_USDC and block.timestamp >= minUnlockTime.
    function unlock(uint256 lockId) external returns (uint256 returnedYrUSDC);

    /// @notice Early exit before minUnlockTime.
    ///         All Points are forfeited; unclaimed rebate is cleared; yrUSDC is returned.
    ///         assetType must be YR_USDC (call exitToLock first if in MANAGER_UNITS state).
    function earlyExit(uint256 lockId) external returns (uint256 returnedYrUSDC);

    // -------------------------------------------------------------------------
    // Phase 3 stubs — revert NotImplemented() in Phase 2
    // -------------------------------------------------------------------------

    /// @notice Atomically migrate lock assets into an Access Strategy Manager.
    ///         Phase 3 implementation: transfers yrUSDC to manager, redeems for USDC,
    ///         invests in manager strategy, records managerUnits.
    function enterAccessStrategyManager(uint256 lockId, address manager)
        external returns (uint256 managerUnits);

    /// @notice Atomically exit from an Access Strategy Manager back to YR_USDC state.
    ///         Phase 3 implementation: divests from manager, deposits USDC to Core Vault,
    ///         receives yrUSDC, restores lock to YR_USDC state.
    function exitToLock(uint256 lockId) external returns (uint256 returnedYrUSDC);

    // -------------------------------------------------------------------------
    // Public checkpoints (anyone may call)
    // -------------------------------------------------------------------------

    /// @notice Checkpoint bonus Points for an active lock.
    ///         Computes accrued bonus by time segment; credits to PointsLedger.
    function checkpointBonusPoints(uint256 lockId) external;

    /// @notice Checkpoint claimable rebate for an active lock.
    ///         Computes USDC rebate by time segment; accumulates in lock.claimableRebateUSDC.
    function checkpointRebate(uint256 lockId) external;

    // -------------------------------------------------------------------------
    // RebateManager — rebate settlement
    // -------------------------------------------------------------------------

    /// @notice Called exclusively by RebateManagerV21 (REBATE_MANAGER_ROLE).
    ///         Auto-checkpoints bonus Points + rebate, zeroes lock.claimableRebateUSDC,
    ///         and returns the claimed amount.
    ///         Eligible statuses: Active, Exited. EarlyExited and None revert.
    function claimRebateOf(uint256 lockId) external returns (uint256 claimedUSDC);
}
