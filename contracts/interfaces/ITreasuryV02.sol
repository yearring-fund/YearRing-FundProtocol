// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITreasuryV02
/// @notice Minimal interface for LockPointsRebateManagerV02 to interact with TreasuryV02.
///         Only exposes the subset of functions the manager needs to call.
interface ITreasuryV02 {
    /// @notice Record that `amount` of `asset` has been paid as rebate to `user`.
    ///         Reverts if the cumulative spend would exceed the allocated rebate budget.
    ///         Must be called by an address holding REBATE_MANAGER_ROLE on TreasuryV02.
    /// @param asset  Token address (must be an approved asset in TreasuryV02)
    /// @param user   Recipient of the rebate payment
    /// @param amount Amount of `asset` paid out
    function recordRebateSpent(address asset, address user, uint256 amount) external;

    /// @notice Returns the remaining rebate budget for `asset` (budget − spent).
    function rebateBudgetRemaining(address asset) external view returns (uint256);
}
