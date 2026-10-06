// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStrategyV02
/// @notice Reserved interface for a potential second strategy in V4+.
/// @dev V3 初版：接口仅作文档性预留，不得被 StrategyManagerV01 激活。
///      任何实现必须在完成独立审计并通过 V4 储备模型验证后方可接入。
interface IStrategyV02 {
    /// @notice Deploy `amount` of underlying into the strategy.
    function invest(uint256 amount) external;

    /// @notice Withdraw `amount` of underlying back to StrategyManager.
    /// @return withdrawn Actual amount transferred back (may be less than requested).
    function divest(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Conservative estimate of redeemable underlying. Must not over-report.
    function totalUnderlying() external view returns (uint256);

    /// @notice Trigger full emergency withdrawal — pull all assets back to StrategyManager.
    function emergencyExit() external;

    /// @notice Partial emergency withdrawal of `amount`.
    function partialEmergencyExit(uint256 amount) external;

    /// @notice Underlying asset address (must match StrategyManager's underlying).
    function underlying() external view returns (address);
}
