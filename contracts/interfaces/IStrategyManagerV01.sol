// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStrategyManagerV01
/// @notice Interface for the strategy manager module
interface IStrategyManagerV01 {
    /// @notice Returns the total amount of assets currently managed by this strategy manager
    /// @dev Must account for all deployed capital across all strategies
    /// @return Total managed assets denominated in the vault's underlying asset
    function totalManagedAssets() external view returns (uint256);
}
