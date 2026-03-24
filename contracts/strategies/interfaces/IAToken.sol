// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAToken
/// @notice Minimal Aave V3 aToken interface required by AaveV3Strategy
interface IAToken {
    /// @notice Returns the address of the underlying asset of this aToken
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}
