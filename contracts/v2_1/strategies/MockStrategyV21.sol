// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IStrategyV21.sol";

/// @title MockStrategyV21
/// @notice Test-only strategy for CoreStrategyManagerV21 and AccessStrategyManagerV21.
///
/// Push model (same as AaveUSDCStrategyV21)
/// ----------------------------------------
/// Manager transfers underlying to this contract, then calls invest().
/// divest() and emergencyExit() return underlying directly to manager.
///
/// Test controls (DEFAULT_ADMIN_ROLE)
/// -----------------------------------
/// addYield(amount)     — admin transfers additional underlying to simulate yield accrual.
/// simulateLoss(amount) — admin withdraws underlying to simulate a loss event.
/// setPaused(bool)      — block invest() and divest() (simulates illiquid / circuit-breaker).
/// setFailInvest(bool)  — make invest() revert (simulates strategy rejection).
/// setFailDivest(bool)  — make divest() revert (simulates withdrawal failure).
contract MockStrategyV21 is IStrategyV21, AccessControl {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error OnlyManager();
    error ZeroAddress();
    error ZeroAmount();
    error Paused();
    error FailInvest();
    error FailDivest();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Invested(uint256 amount);
    event Divested(uint256 requested, uint256 returned);
    event EmergencyExited(uint256 returned);
    event YieldAdded(uint256 amount);
    event LossSimulated(uint256 amount);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice Underlying asset (USDC)
    IERC20 public immutable underlyingToken;

    /// @notice CoreStrategyManagerV21 or AccessStrategyManagerV21 — only caller for fund ops
    address public immutable manager;

    // -------------------------------------------------------------------------
    // Test-control state
    // -------------------------------------------------------------------------

    /// @notice When true, invest() and divest() revert with Paused()
    bool public paused;

    /// @notice When true, invest() reverts with FailInvest()
    bool public failInvest;

    /// @notice When true, divest() reverts with FailDivest()
    bool public failDivest;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address underlying_, address manager_, address admin_) {
        if (underlying_ == address(0) || manager_ == address(0) || admin_ == address(0))
            revert ZeroAddress();

        underlyingToken = IERC20(underlying_);
        manager         = manager_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    // -------------------------------------------------------------------------
    // IStrategyV21 — view
    // -------------------------------------------------------------------------

    /// @inheritdoc IStrategyV21
    function underlying() external view override returns (address) {
        return address(underlyingToken);
    }

    /// @notice Total underlying held by this contract (idle = all deployed capital in mock).
    ///         Never reverts.
    function totalUnderlying() external view override returns (uint256) {
        return underlyingToken.balanceOf(address(this));
    }

    // -------------------------------------------------------------------------
    // IStrategyV21 — fund operations (onlyManager)
    // -------------------------------------------------------------------------

    /// @notice Accept underlying already pushed by manager.
    ///         No external protocol call — tokens simply sit here until divest().
    function invest(uint256 amount) external override onlyManager {
        if (paused)     revert Paused();
        if (failInvest) revert FailInvest();
        if (amount == 0) revert ZeroAmount();
        // Push model: underlying already in this contract; nothing further to do.
        emit Invested(amount);
    }

    /// @notice Withdraw up to `amount` underlying and transfer to manager.
    ///         Returns actual amount (may be less if balance is insufficient due to simulateLoss).
    function divest(uint256 amount) external override onlyManager returns (uint256 returned) {
        if (paused)     revert Paused();
        if (failDivest) revert FailDivest();
        if (amount == 0) revert ZeroAmount();

        uint256 bal  = underlyingToken.balanceOf(address(this));
        returned     = amount > bal ? bal : amount;
        if (returned > 0) underlyingToken.safeTransfer(manager, returned);

        emit Divested(amount, returned);
    }

    /// @notice Withdraw all underlying and transfer to manager.
    function emergencyExit() external override onlyManager returns (uint256 returned) {
        returned = underlyingToken.balanceOf(address(this));
        if (returned > 0) underlyingToken.safeTransfer(manager, returned);
        emit EmergencyExited(returned);
    }

    // -------------------------------------------------------------------------
    // Test helpers — DEFAULT_ADMIN_ROLE only
    // -------------------------------------------------------------------------

    /// @notice Simulate yield: admin transfers `amount` underlying into this contract.
    ///         totalUnderlying() increases by `amount`, raising the unit price in the manager.
    function addYield(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (amount == 0) revert ZeroAmount();
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit YieldAdded(amount);
    }

    /// @notice Simulate loss: admin withdraws `amount` underlying from this contract.
    ///         Capped at current balance — will not revert if amount > balance.
    function simulateLoss(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 bal = underlyingToken.balanceOf(address(this));
        if (amount > bal) amount = bal;
        if (amount > 0) underlyingToken.safeTransfer(msg.sender, amount);
        emit LossSimulated(amount);
    }

    /// @notice Toggle pause — blocks invest() and divest() when true.
    function setPaused(bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = paused_;
    }

    /// @notice Toggle invest failure — makes invest() revert when true.
    function setFailInvest(bool fail_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        failInvest = fail_;
    }

    /// @notice Toggle divest failure — makes divest() revert when true.
    function setFailDivest(bool fail_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        failDivest = fail_;
    }
}
