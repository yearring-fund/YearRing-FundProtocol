// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ILockPointsRebateManagerV02
/// @notice Interface for the closed beta lock / Points / rebate manager.
///         Coordinates lock creation, upfront Points issuance, rebate claims, and early exit.
///
/// Two benefit layers:
///   Layer 1 — Rebate (yrCORE shares): accrues linearly over lock duration, claimable anytime.
///   Layer 2 — Points (YRPTS): issued upfront at lock time. Must be returned in full on earlyExit.
interface ILockPointsRebateManagerV02 {

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a lock is created and Points are issued upfront
    event LockedWithPoints(
        uint256 indexed lockId,
        address indexed owner,
        uint256 shares,
        uint256 pointsIssued
    );

    /// @notice Emitted when a rebate is claimed or auto-settled during early exit
    event RebateClaimed(
        uint256 indexed lockId,
        address indexed owner,
        uint256 rebateShares
    );

    /// @notice Emitted when a user performs an early exit
    /// @param pointsDeducted Points returned by user to TreasuryV02
    event EarlyExitExecuted(
        uint256 indexed lockId,
        address indexed owner,
        uint256 pointsDeducted
    );

    /// @notice Guardian approved a forced exit for a specific lock
    event ForceExitApproved(uint256 indexed lockId, address indexed approver);

    /// @notice Admin executed a forced exit (bypasses rebate settlement and Points deduction)
    event ForceExitExecuted(
        uint256 indexed lockId,
        address indexed owner,
        address indexed executor,
        string  reason
    );

    // -------------------------------------------------------------------------
    // User operations
    // -------------------------------------------------------------------------

    /// @notice Lock yrCORE shares and receive Points upfront.
    ///         Points amount = lockedUSDCValue × 1e12 × durationDays × multiplierBps / (10000 × 500)
    /// @dev Owner must approve yrCORE shares to LockLedger before calling.
    ///      Points are transferred from TreasuryV02 to the owner immediately.
    /// @param shares   Amount of yrCORE shares to lock (18 decimals)
    /// @param duration Lock duration in seconds (must match a valid tier range)
    /// @return lockId  New lock position ID
    function lockWithPoints(uint256 shares, uint64 duration) external returns (uint256 lockId);

    /// @notice Claim accrued management fee rebate for a lock position.
    ///         Rebate = shares × mgmtFeeBps × discountBps × elapsed / (BPS² × 30days)
    /// @param lockId Lock position ID
    /// @return rebateShares yrCORE shares transferred from TreasuryV02 to caller
    function claimRebate(uint256 lockId) external returns (uint256 rebateShares);

    /// @notice Exit a lock before maturity.
    ///         Auto-settles pending rebate, then deducts (returns) all issued Points to TreasuryV02,
    ///         then releases yrCORE shares back to the owner.
    /// @dev Owner must approve issuedPoints[lockId] YRPTS to this contract before calling.
    ///      Early exit flow: settle rebate → return Points → release yrCORE shares.
    /// @param lockId Lock position ID
    function earlyExit(uint256 lockId) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Points issued at lock time for a position
    function issuedPoints(uint256 lockId) external view returns (uint256);

    /// @notice Timestamp of last rebate settlement for a position
    function lastRebateClaimedAt(uint256 lockId) external view returns (uint256);

    /// @notice Whether a forced exit has been approved by guardian for this lockId
    function forceExitApproved(uint256 lockId) external view returns (bool);

    /// @notice Preview pending rebate shares for a lock position (does not settle)
    function previewRebate(uint256 lockId) external view returns (uint256 rebateShares);

    /// @notice Pre-flight check for claimRebate — returns amounts frontend needs to verify feasibility.
    ///         Returns all zeros if the lock is inactive or does not exist.
    /// @return rebateShares        yrCORE shares that would transfer from TreasuryV02
    /// @return treasuryBalance     vaultShares.balanceOf(treasury)
    /// @return treasuryAllowance   vaultShares.allowance(treasury, this)
    /// @return remainingBudget     TreasuryV02 remaining rebate budget for yrCORE
    function checkClaimRebate(uint256 lockId) external view returns (
        uint256 rebateShares,
        uint256 treasuryBalance,
        uint256 treasuryAllowance,
        uint256 remainingBudget
    );

    /// @notice Pre-flight check for earlyExit — returns amounts frontend needs to verify feasibility.
    ///         Returns all zeros if inactive, already exited, or mature.
    ///         No Points allowance check needed — PointsLedgerV01 debit requires no user approval.
    /// @return rebateShares           yrCORE shares from rebate auto-settlement
    /// @return pointsToReturn         Points that will be deducted from owner balance
    /// @return treasuryShareBalance   vaultShares.balanceOf(treasury)
    /// @return treasuryShareAllowance vaultShares.allowance(treasury, this)
    /// @return userPointsBalance      pointsLedger.balanceOf(lock owner)
    function checkEarlyExit(uint256 lockId) external view returns (
        uint256 rebateShares,
        uint256 pointsToReturn,
        uint256 treasuryShareBalance,
        uint256 treasuryShareAllowance,
        uint256 userPointsBalance
    );

    /// @notice Guardian pre-approves a forced exit for a lock (EMERGENCY_ROLE)
    function approveForceExit(uint256 lockId) external;

    /// @notice Admin executes a forced early exit — bypasses rebate settlement and Points deduction.
    ///         Owner receives their shares. Points remain with owner; treasury absorbs the loss.
    ///         forceExit does NOT settle rebate or deduct Points — documented omission for emergency use.
    ///         Reason must be recorded on-chain for post-hoc auditability.
    function executeForceExit(uint256 lockId, string calldata reason) external;
}
