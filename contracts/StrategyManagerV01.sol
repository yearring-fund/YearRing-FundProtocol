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
/// @notice Middle layer between YearRingCoreVaultV01 and a single Strategy contract.
///         Handles capital routing, accounting closure, and risk controls.
/// @dev V01: single strategy only. Multi-strategy support deferred to V2.
contract StrategyManagerV01 is IStrategyManagerV01, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Can pause the strategy manager (stop new invest() calls). Cannot reset balances.
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

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
    error NotInNormalMode();
    error NotVault();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event VaultSet(address indexed oldVault, address indexed newVault);
    event StrategySet(address indexed oldStrategy, address indexed newStrategy);
    event Invested(uint256 amount);
    event Divested(uint256 requested, uint256 withdrawn);
    event ReturnedToVault(uint256 amount);
    event EmergencyExitTriggered();
    event PartialEmergencyExitTriggered(uint256 amount);
    event LimitsSet(uint256 investCap, uint256 minIdle);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Underlying asset (same as YearRingCoreVaultV01.asset())
    IERC20 public immutable underlying;

    /// @notice YearRingCoreVaultV01 address — destination for returnToVault()
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
    /// @param vault_ YearRingCoreVaultV01 address
    /// @param admin_ DEFAULT_ADMIN_ROLE holder (timelock / multisig)
    constructor(
        address underlying_,
        address vault_,
        address admin_
    ) {
        if (
            underlying_ == address(0) ||
            vault_      == address(0) ||
            admin_      == address(0)
        ) revert ZeroAddress();

        underlying = IERC20(underlying_);
        vault = vault_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
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
    // Capital operations (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Deploy `amount` of idle underlying into the active strategy
    /// @dev Blocked when paused. Enforces investCap and minIdle constraints.
    ///      Also blocked when vault is in non-Normal mode.
    function invest(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
        // Block invest in non-Normal modes
        if (vault != address(0)) {
            (bool ok, bytes memory data) = vault.staticcall(abi.encodeWithSignature("systemMode()"));
            if (ok && data.length == 32) {
                uint8 vaultMode = abi.decode(data, (uint8));
                if (vaultMode != 0) revert NotInNormalMode();
            }
        }

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
    function divest(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 before = underlying.balanceOf(address(this));
        IStrategyV01(strategy).divest(amount);
        withdrawn = underlying.balanceOf(address(this)) - before;

        emit Divested(amount, withdrawn);
    }

    /// @notice Transfer idle underlying from this contract back to vault
    function returnToVault(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (vault == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 idle = underlying.balanceOf(address(this));
        if (idle < amount) revert NotEnoughIdle(idle, amount);

        underlying.safeTransfer(vault, amount);

        emit ReturnedToVault(amount);
    }

    /// @notice Trigger emergency withdrawal from strategy — pulls as much as possible back here,
    ///         then auto-forwards all idle USDC to vault
    /// @dev Intentionally NOT blocked by pause, to always allow capital recovery
    function emergencyExit() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (strategy == address(0)) revert NoStrategy();

        IStrategyV01(strategy).emergencyExit();

        // Auto-forward all idle USDC to vault
        uint256 idle = underlying.balanceOf(address(this));
        if (idle > 0 && vault != address(0)) {
            underlying.safeTransfer(vault, idle);
            emit ReturnedToVault(idle);
        }

        emit EmergencyExitTriggered();
    }

    /// @notice Partially withdraw `amount` from strategy, then auto-forward all idle to vault
    function partialEmergencyExit(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (strategy == address(0)) revert NoStrategy();

        IStrategyV01(strategy).partialEmergencyExit(amount);

        // Auto-forward all idle USDC to vault
        uint256 idle = underlying.balanceOf(address(this));
        if (idle > 0 && vault != address(0)) {
            underlying.safeTransfer(vault, idle);
            emit ReturnedToVault(idle);
        }

        emit PartialEmergencyExitTriggered(amount);
    }

    /// @notice Pull `amount` from strategy and forward to vault; called by vault _autoRebalance() only.
    /// @dev Bypasses role check — gated by vault address comparison instead.
    ///      Divest failure is not re-thrown; vault catches via try/catch.
    function returnForRebalance(uint256 amount) external override nonReentrant {
        if (msg.sender != vault) revert NotVault();
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 before = underlying.balanceOf(address(this));
        IStrategyV01(strategy).divest(amount);
        uint256 withdrawn = underlying.balanceOf(address(this)) - before;

        uint256 toReturn = withdrawn < amount ? withdrawn : amount;
        if (toReturn > 0) {
            underlying.safeTransfer(vault, toReturn);
            emit ReturnedToVault(toReturn);
        }
        emit Divested(amount, withdrawn);
    }

    /// @notice Invest `amount` of idle underlying (already transferred by vault) into the active strategy.
    ///         Called by vault _autoRebalance() only when reserve ratio exceeds MAX_RESERVE_BPS (15%).
    /// @dev Push model: vault transfers USDC here first, then calls this function.
    ///      Blocked when paused or no strategy configured — vault wraps in try/catch.
    ///      If this reverts, USDC remains idle in this contract; totalManagedAssets() still accounts for it.
    function deployForRebalance(uint256 amount) external override nonReentrant whenNotPaused {
        if (msg.sender != vault) revert NotVault();
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 idle = underlying.balanceOf(address(this));
        if (idle < amount) revert NotEnoughIdle(idle, amount);

        // Push model: transfer to strategy, then notify
        underlying.safeTransfer(strategy, amount);
        IStrategyV01(strategy).invest(amount);

        emit Invested(amount);
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
    // EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE can pause. Only DEFAULT_ADMIN_ROLE can unpause.
    // -------------------------------------------------------------------------

    /// @notice Pause: blocks invest(). EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE.
    function pause() external {
        if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert("AccessControl: unauthorized");
        _pause();
    }

    /// @notice Unpause: DEFAULT_ADMIN_ROLE only.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
