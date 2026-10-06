// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IUserStateEngineV02
/// @notice Read-only interface for lock position and user aggregate state queries
interface IUserStateEngineV02 {

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice State of a single lock position or a user's aggregate state
    /// @dev Derived purely from LockPosition fields — never stored.
    ///   Normal             : no active lock, or position already unlocked
    ///   LockedAccumulating : lock active, maturity not yet reached
    ///   Matured            : lock active, maturity passed, unlock() callable
    ///   EarlyExit          : position exited before maturity (V3+ reserved, unreachable in V2)
    enum LockState { Normal, LockedAccumulating, Matured, EarlyExit }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice State of a single lock position
    /// @param lockId Lock position ID in LockLedgerV02
    /// @return LockState derived from position fields and current timestamp
    function lockStateOf(uint256 lockId) external view returns (LockState);

    /// @notice Aggregate state across all lock positions ever created by owner
    /// @dev Priority order: EarlyExit > LockedAccumulating > Matured > Normal
    /// @param owner Wallet address
    /// @return LockState highest-priority state among owner's positions
    function userStateOf(address owner) external view returns (LockState);
}
