// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPool
/// @notice Minimal Aave V3 Pool interface required by AaveV3Strategy
interface IPool {
    /// @notice Supply `amount` of `asset` into Aave on behalf of `onBehalfOf`
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /// @notice Withdraw `amount` of `asset` from Aave to `to`
    /// @dev Pass type(uint256).max to withdraw the full aToken balance
    /// @return withdrawn Actual amount withdrawn
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256 withdrawn);
}
