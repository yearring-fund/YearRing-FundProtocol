// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IStrategyV01.sol";

/// @title DummyStrategy
/// @notice Simulation strategy for testing StrategyManagerV01 and FundVaultV01 integration.
///         Holds underlying tokens and supports manual yield/loss injection.
/// @dev Not for production use.
contract DummyStrategy is IStrategyV01 {
    using SafeERC20 for IERC20;

    IERC20 public immutable _underlying;

    /// @notice Simulated yield or loss offset (signed, in underlying units)
    /// @dev Set via simulateYield() / simulateLoss() to test totalUnderlying() reporting
    int256 public yieldOffset;

    constructor(address underlying_) {
        _underlying = IERC20(underlying_);
    }

    // -------------------------------------------------------------------------
    // IStrategy
    // -------------------------------------------------------------------------

    function underlying() external view override returns (address) {
        return address(_underlying);
    }

    /// @notice Receive underlying pushed by StrategyManager (no-op, already received)
    function invest(uint256) external override {
        // Funds are transferred by StrategyManager before this call — nothing to do
    }

    /// @notice Return `amount` of underlying to caller (StrategyManager)
    function divest(uint256 amount) external override returns (uint256 withdrawn) {
        uint256 balance = _underlying.balanceOf(address(this));
        withdrawn = amount > balance ? balance : amount;
        if (withdrawn > 0) {
            _underlying.safeTransfer(msg.sender, withdrawn);
        }
    }

    /// @notice Conservative balance: actual holdings adjusted by yieldOffset
    function totalUnderlying() external view override returns (uint256) {
        uint256 balance = _underlying.balanceOf(address(this));
        int256 adjusted = int256(balance) + yieldOffset;
        return adjusted > 0 ? uint256(adjusted) : 0;
    }

    /// @notice Transfer all holdings back to caller
    function emergencyExit() external override {
        uint256 balance = _underlying.balanceOf(address(this));
        if (balance > 0) {
            _underlying.safeTransfer(msg.sender, balance);
        }
    }

    // -------------------------------------------------------------------------
    // Test helpers
    // -------------------------------------------------------------------------

    /// @notice Simulate accrued yield (increases totalUnderlying without transferring tokens)
    function simulateYield(uint256 amount) external {
        yieldOffset += int256(amount);
    }

    /// @notice Simulate a loss (decreases totalUnderlying without transferring tokens)
    function simulateLoss(uint256 amount) external {
        yieldOffset -= int256(amount);
    }
}
