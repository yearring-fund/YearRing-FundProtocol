// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStrategyV01
/// @notice Minimal interface that StrategyManagerV01 expects every V01 strategy to implement
interface IStrategyV01 {
    /// @notice Underlying asset address (must match StrategyManagerV01's underlying)
    function underlying() external view returns (address);

    /// @notice Deploy `amount` of underlying into the strategy
    /// @dev PUSH model: StrategyManagerV01 transfers `amount` to this contract BEFORE calling invest().
    ///      Implementations must NOT call transferFrom on the caller — funds are already here.
    function invest(uint256 amount) external;

    /// @notice Withdraw `amount` of underlying back to caller (StrategyManagerV01)
    /// @dev Implementation must transfer the withdrawn amount to msg.sender before returning.
    ///      StrategyManagerV01 verifies actual receipt via balance diff — return value must match.
    /// @return withdrawn Actual amount transferred back (may be less than requested)
    function divest(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Conservative estimate of redeemable underlying held by this strategy
    /// @dev Must never over-report; rounding down is preferred
    function totalUnderlying() external view returns (uint256);

    /// @notice Trigger emergency withdrawal — pull as much as possible back to StrategyManagerV01
    function emergencyExit() external;
}
