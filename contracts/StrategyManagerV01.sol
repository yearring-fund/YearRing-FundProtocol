// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IStrategyManagerV01.sol";
import "./interfaces/IStrategyV01.sol";

/// @title StrategyManagerV01
/// @notice Middle layer between FundVaultV01 and a single Strategy contract.
///         Handles capital routing, accounting closure, and risk controls.
/// @dev V01: single strategy only. Multi-strategy support deferred to V2.
contract StrategyManagerV01 is IStrategyManagerV01, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error ZeroAddress();
    error ZeroAmount();
    error NotEnoughIdle(uint256 idle, uint256 required);
    error CapExceeded(uint256 cap, uint256 nextTotal);
    error InvalidUnderlying(address expected, address got);
    error NoStrategy();
    error OldStrategyNotEmpty(uint256 remaining);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event VaultSet(address indexed oldVault, address indexed newVault);
    event StrategySet(address indexed oldStrategy, address indexed newStrategy);
    event Invested(uint256 amount);
    event Divested(uint256 requested, uint256 withdrawn);
    event ReturnedToVault(uint256 amount);
    event EmergencyExitTriggered();
    event LimitsSet(uint256 investCap, uint256 minIdle);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Underlying asset (same as FundVaultV01.asset())
    IERC20 public immutable underlying;

    /// @notice FundVaultV01 address — destination for returnToVault()
    address public vault;

    /// @notice Active strategy (V01: single strategy)
    address public strategy;

    /// @notice Maximum total deployed to strategy (0 = unlimited)
    uint256 public investCap;

    /// @notice Minimum idle underlying to keep in this contract (0 = no floor)
    uint256 public minIdle;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param underlying_ Underlying ERC20 asset address
    /// @param vault_ FundVaultV01 address
    /// @param admin_ DEFAULT_ADMIN_ROLE holder (timelock / multisig)
    /// @param guardian_ GUARDIAN_ROLE holder (emergency pause only)
    constructor(
        address underlying_,
        address vault_,
        address admin_,
        address guardian_
    ) {
        if (
            underlying_ == address(0) ||
            vault_      == address(0) ||
            admin_      == address(0) ||
            guardian_   == address(0)
        ) revert ZeroAddress();

        underlying = IERC20(underlying_);
        vault = vault_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(OPERATOR_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, guardian_);
    }

    // -------------------------------------------------------------------------
    // IStrategyManagerV01 — accounting
    // -------------------------------------------------------------------------

    /// @notice Total assets managed here: idle underlying + strategy holdings
    /// @dev Conservative: uses strategy.totalUnderlying() which must not over-report
    function totalManagedAssets() external view override returns (uint256) {
        uint256 idle = underlying.balanceOf(address(this));
        if (strategy == address(0)) return idle;

        uint256 strategyAssets;
        try IStrategyV01(strategy).totalUnderlying() returns (uint256 val) {
            strategyAssets = val;
        } catch {
            // Strategy call failed: report conservatively as 0
            // Vault operations remain functional; operators should investigate
            strategyAssets = 0;
        }

        return idle + strategyAssets;
    }

    /// @notice Idle underlying sitting in this contract (not yet deployed)
    function idleUnderlying() external view returns (uint256) {
        return underlying.balanceOf(address(this));
    }

    // -------------------------------------------------------------------------
    // Capital operations (OPERATOR or ADMIN)
    // -------------------------------------------------------------------------

    /// @notice Deploy `amount` of idle underlying into the active strategy
    /// @dev Blocked when paused. Enforces investCap and minIdle constraints.
    function invest(uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 idle = underlying.balanceOf(address(this));
        if (idle < amount) revert NotEnoughIdle(idle, amount);
        if (minIdle > 0 && idle - amount < minIdle) revert NotEnoughIdle(idle > minIdle ? idle - minIdle : 0, amount);

        if (investCap > 0) {
            uint256 alreadyDeployed = IStrategyV01(strategy).totalUnderlying();
            if (alreadyDeployed + amount > investCap) revert CapExceeded(investCap, alreadyDeployed + amount);
        }

        // Push model: transfer underlying to strategy, then notify
        underlying.safeTransfer(strategy, amount);
        IStrategyV01(strategy).invest(amount);

        emit Invested(amount);
    }

    /// @notice Pull `amount` of underlying back from strategy to this contract
    /// @return withdrawn Actual amount received (may differ from requested)
    function divest(uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 before = underlying.balanceOf(address(this));
        IStrategyV01(strategy).divest(amount);
        withdrawn = underlying.balanceOf(address(this)) - before;

        emit Divested(amount, withdrawn);
    }

    /// @notice Transfer idle underlying from this contract back to vault
    function returnToVault(uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (vault == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 idle = underlying.balanceOf(address(this));
        if (idle < amount) revert NotEnoughIdle(idle, amount);

        underlying.safeTransfer(vault, amount);

        emit ReturnedToVault(amount);
    }

    /// @notice Trigger emergency withdrawal from strategy — pulls as much as possible back here
    /// @dev Intentionally NOT blocked by pause, to always allow capital recovery
    function emergencyExit() external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (strategy == address(0)) revert NoStrategy();

        IStrategyV01(strategy).emergencyExit();

        emit EmergencyExitTriggered();
    }

    // -------------------------------------------------------------------------
    // Admin configuration (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Update the vault address
    function setVault(address newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newVault == address(0)) revert ZeroAddress();
        emit VaultSet(vault, newVault);
        vault = newVault;
    }

    /// @notice Replace the active strategy
    /// @dev Old strategy must be fully divested before switching.
    ///      Required flow: pause → emergencyExit → returnToVault → setStrategy → unpause
    function setStrategy(address newStrategy) external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused {
        if (newStrategy == address(0)) revert ZeroAddress();

        // Enforce: old strategy must be empty before switching
        if (strategy != address(0)) {
            uint256 remaining = IStrategyV01(strategy).totalUnderlying();
            if (remaining > 0) revert OldStrategyNotEmpty(remaining);
        }

        address stratUnderlying = IStrategyV01(newStrategy).underlying();
        if (stratUnderlying != address(underlying)) {
            revert InvalidUnderlying(address(underlying), stratUnderlying);
        }

        emit StrategySet(strategy, newStrategy);
        strategy = newStrategy;
    }

    /// @notice Set investCap and minIdle limits
    /// @param newInvestCap Max total deployed to strategy (0 = unlimited)
    /// @param newMinIdle   Min idle to retain in this contract (0 = no floor)
    function setLimits(uint256 newInvestCap, uint256 newMinIdle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        investCap = newInvestCap;
        minIdle = newMinIdle;
        emit LimitsSet(newInvestCap, newMinIdle);
    }

    // -------------------------------------------------------------------------
    // Pause controls
    // -------------------------------------------------------------------------

    /// @notice Pause: blocks invest(). GUARDIAN or ADMIN.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /// @notice Unpause: ADMIN only.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
