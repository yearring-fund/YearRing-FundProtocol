// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStrategyManagerV01
/// @notice Interface for the strategy manager module
interface IStrategyManagerV01 {
    /// @notice Returns the total amount of assets currently managed by this strategy manager
    /// @dev Must account for all deployed capital across all strategies
    /// @return Total managed assets denominated in the vault's underlying asset
    function totalManagedAssets() external view returns (uint256);

    /// @notice Called exclusively by the vault's _autoRebalance() to pull funds back when
    ///         reserve ratio falls below MIN_RESERVE_BPS (5%).
    /// @dev Only callable by vault address. Divests `amount` from strategy, then
    ///      transfers idle to vault. A failure here causes vault to emit RebalanceDivestFailed.
    function returnForRebalance(uint256 amount) external;

    /// @notice Called exclusively by the vault's _autoRebalance() to invest funds that were
    ///         just transferred by the vault when reserve ratio exceeds MAX_RESERVE_BPS (15%).
    /// @dev Only callable by vault address. Vault transfers `amount` to this contract first,
    ///      then calls this. Blocked when paused or no strategy set.
    ///      A failure here leaves USDC idle in this contract (still tracked by totalManagedAssets).
    function deployForRebalance(uint256 amount) external;
}
