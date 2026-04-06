// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IBeneficiaryModuleV02
/// @notice Interface for the minimal beneficiary module (V2).
///         Tracks user activity via heartbeat and allows a designated beneficiary
///         to claim individual lock positions when the original owner becomes inactive.
interface IBeneficiaryModuleV02 {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a user sets or updates their beneficiary.
    event BeneficiarySet(address indexed owner, address indexed beneficiary);

    /// @notice Emitted when a user revokes their beneficiary (reset to default = self).
    event BeneficiaryRevoked(address indexed owner);

    /// @notice Emitted when a user calls heartbeat(), proving they are active.
    event HeartbeatRecorded(address indexed owner, uint64 timestamp);

    /// @notice Emitted for each lock position successfully transferred to the beneficiary.
    event LockInherited(address indexed originalOwner, address indexed beneficiary, uint256 indexed lockId);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error SelfBeneficiary();
    error UserNotInactive(address owner);
    error NotBeneficiary(address caller, address expectedBeneficiary);
    error LockAlreadyClaimed(uint256 lockId);
    error LockNotClaimable(uint256 lockId);

    // -------------------------------------------------------------------------
    // User actions
    // -------------------------------------------------------------------------

    /// @notice Set a beneficiary for the caller. Initializes lastActiveAt.
    /// @param beneficiary The address to designate as beneficiary. Cannot be msg.sender.
    function setBeneficiary(address beneficiary) external;

    /// @notice Update an existing beneficiary. Resets lastActiveAt.
    /// @param newBeneficiary New beneficiary address. Cannot be msg.sender.
    function updateBeneficiary(address newBeneficiary) external;

    /// @notice Revoke the caller's beneficiary (resets to default = self). Resets lastActiveAt.
    function revokeBeneficiary() external;

    /// @notice Record caller as active. This is the ONLY way to reset the inactivity timer.
    function heartbeat() external;

    // -------------------------------------------------------------------------
    // Beneficiary action
    // -------------------------------------------------------------------------

    /// @notice Called by the beneficiary to claim individual lock positions from an inactive owner.
    ///         Each lockId is processed independently — partial batches are safe and retriable.
    ///
    ///         Per-lockId requirements:
    ///           - originalOwner is inactive
    ///           - msg.sender == beneficiaryOf(originalOwner)
    ///           - lock is currently owned by originalOwner and still active
    ///           - lock has not already been claimed via this module
    ///
    /// @param originalOwner The inactive user whose locks are being inherited.
    /// @param lockIds       Lock IDs to claim. Use claimableLockIds() to enumerate eligible ones.
    function executeClaim(address originalOwner, uint256[] calldata lockIds) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Returns the beneficiary of `user`. If not set, returns `user` (default = self).
    function beneficiaryOf(address user) external view returns (address);

    /// @notice Returns true if `user` is considered inactive:
    ///         - adminMarked[user] == true, OR
    ///         - lastActiveAt[user] > 0 AND block.timestamp - lastActiveAt[user] >= INACTIVITY_THRESHOLD
    function isInactive(address user) external view returns (bool);

    /// @notice Returns the last recorded active timestamp for `user` (0 if never set).
    function lastActiveAt(address user) external view returns (uint64);

    /// @notice Returns true if `user` has been manually marked inactive by admin.
    function adminMarked(address user) external view returns (bool);

    /// @notice Returns true if the given lockId has already been claimed via this module.
    function isLockClaimed(uint256 lockId) external view returns (bool);

    /// @notice Returns all lockIds currently owned by originalOwner that are eligible for claim:
    ///         active (not unlocked) and not yet inherited via this module.
    /// @dev Convenience helper for beneficiary UX — avoids manual enumeration.
    function claimableLockIds(address originalOwner) external view returns (uint256[] memory);
}
