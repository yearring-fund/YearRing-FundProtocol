// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ICoreStrategyManagerV21.sol";
import "./interfaces/IStrategyV21.sol";

/// @title CoreStrategyManagerV21
/// @notice Manages USDC capital deployed into yield strategies on behalf of
///         YearRingCoreVaultV21 (Phase 1) and later LockManagerV21 (Phase 2).
///
/// Units model
/// -----------
/// Depositors receive internal "units" (18-decimal) proportional to their contribution
/// at the time of deposit. Unit price rises as yield accrues (totalManagedAssets grows
/// while totalUnits stays flat between deposit/withdraw/fee events).
///
/// Fee accrual mints new units to feeReceiver, diluting all existing unitholders.
/// No USDC is deducted or transferred for fees — dilution IS the fee.
///
///   unitPriceRay = totalManagedAssets × 1e27 / totalUnits
///
/// Phase-1 constants
/// -----------------
///   FEE_BPS     = 50    (50 bps / year = 0.5%)
///   UNITS_SCALE = 1e12  (1 USDC [6-dec] → 1e12 units [18-dec] at first deposit)
contract CoreStrategyManagerV21 is ICoreStrategyManagerV21, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice May call invest() and accrueFee() alongside DEFAULT_ADMIN_ROLE
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant FEE_BPS          = 50;
    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// @notice Initial scale: 1 USDC (6-decimal) → 1e12 units (18-decimal equivalent)
    uint256 public constant UNITS_SCALE      = 1e12;
    uint256 public constant RAY              = 1e27;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotVault();
    error Unauthorized();
    error ZeroAmount();
    error ZeroAddress();
    error NoStrategy();
    error ZeroUnits();
    error InsufficientIdle(uint256 available, uint256 required);
    error InsufficientManagedAssets(uint256 available, uint256 required);
    error InsufficientLiquidity(uint256 required, uint256 available);
    error InsufficientFeeUnits(uint256 available, uint256 requested);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DepositedFromVault(uint256 assets, uint256 unitsMinted);
    event WithdrawnToVault(uint256 assets, uint256 unitsBurned);
    event Invested(uint256 amount);
    event DivestFromStrategy(uint256 requested, uint256 returned);
    event EmergencyExitStrategy(uint256 returned);
    event FeeAccrued(uint256 unitsMinted, uint256 feeAssetEquiv, uint256 elapsed);
    event FeeUnitsRedeemed(uint256 unitsBurned, uint256 usdcReturned);
    event StrategySet(address indexed strategy);
    event FeeReceiverSet(address indexed feeReceiver);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 — only this address may call vault-gated functions
    address public immutable override vault;

    IERC20 private immutable _underlying;

    // -------------------------------------------------------------------------
    // Mutable configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    address public override strategy;

    /// @inheritdoc ICoreStrategyManagerV21
    address public override feeReceiver;

    // -------------------------------------------------------------------------
    // Units accounting
    // -------------------------------------------------------------------------

    uint256 private _totalUnits;
    mapping(address => uint256) private _unitsOf;

    // -------------------------------------------------------------------------
    // Fee accrual state
    // -------------------------------------------------------------------------

    /// @notice Timestamp of the most recent fee accrual checkpoint
    uint256 public lastFeeAccrualAt;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param underlying_  USDC address on Base
    /// @param vault_       YearRingCoreVaultV21 address
    /// @param admin_       Initial DEFAULT_ADMIN_ROLE holder
    constructor(
        address underlying_,
        address vault_,
        address admin_
    ) {
        if (underlying_ == address(0) || vault_ == address(0) || admin_ == address(0))
            revert ZeroAddress();

        _underlying      = IERC20(underlying_);
        vault            = vault_;
        lastFeeAccrualAt = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyAdminOrKeeper() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender))
            revert Unauthorized();
        _;
    }

    // -------------------------------------------------------------------------
    // View — configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    function underlying() external view override returns (address) {
        return address(_underlying);
    }

    // -------------------------------------------------------------------------
    // View — accounting
    // -------------------------------------------------------------------------

    /// @notice Idle underlying held by this contract plus all strategy-deployed assets.
    function totalManagedAssets() public view override returns (uint256) {
        uint256 inStrategy = strategy != address(0)
            ? IStrategyV21(strategy).totalUnderlying()
            : 0;
        return _underlying.balanceOf(address(this)) + inStrategy;
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function totalUnits() external view override returns (uint256) {
        return _totalUnits;
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function unitsOf(address account) external view override returns (uint256) {
        return _unitsOf[account];
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function unitPriceRay() external view override returns (uint256) {
        if (_totalUnits == 0) return RAY;
        return totalManagedAssets() * RAY / _totalUnits;
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function vaultManagedAssets() external view override returns (uint256) {
        if (_totalUnits == 0) return 0;
        return totalManagedAssets() * _unitsOf[vault] / _totalUnits;
    }

    // -------------------------------------------------------------------------
    // Vault-only — capital movements
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    /// @dev Vault MUST transfer `assets` to this contract BEFORE calling this.
    ///      Uses (totalManagedAssets - assets) as pre-deposit AUM for correct unit pricing.
    function depositFromVault(uint256 assets) external override onlyVault nonReentrant {
        if (assets == 0) revert ZeroAmount();

        _accrueFee();

        // Pre-deposit AUM: the USDC is already in this contract, so subtract it
        uint256 managed   = totalManagedAssets();
        uint256 preAssets = managed > assets ? managed - assets : 0;

        uint256 newUnits;
        if (_totalUnits == 0 || preAssets == 0) {
            // First deposit or SM was emptied: issue at initial scale
            newUnits = assets * UNITS_SCALE;
        } else {
            // Proportional issuance: newUnits / _totalUnits = assets / preAssets
            newUnits = _totalUnits * assets / preAssets;
        }

        if (newUnits == 0) revert ZeroUnits();

        _unitsOf[vault] += newUnits;
        _totalUnits     += newUnits;

        emit DepositedFromVault(assets, newUnits);
    }

    /// @inheritdoc ICoreStrategyManagerV21
    /// @dev Burns vault units proportionally: unitsToBurn / _totalUnits = assets / managed.
    ///      Pulls from strategy first if idle is insufficient.
    ///      Reverts if liquidity is inadequate.
    function withdrawToVault(uint256 assets) external override onlyVault nonReentrant returns (uint256 withdrawn) {
        if (assets == 0) revert ZeroAmount();

        _accrueFee();

        uint256 managed = totalManagedAssets();
        if (assets > managed) revert InsufficientManagedAssets(managed, assets);

        // Pull liquidity before burning units (reverts internally if insufficient)
        withdrawn = _pullLiquidity(assets);

        // Burn vault's proportional share of units
        if (_totalUnits > 0 && managed > 0) {
            uint256 unitsToBurn = _totalUnits * assets / managed;
            // Cap at what vault actually holds (guards against rounding drift)
            if (unitsToBurn > _unitsOf[vault]) unitsToBurn = _unitsOf[vault];

            if (unitsToBurn > 0) {
                _unitsOf[vault] -= unitsToBurn;
                _totalUnits     -= unitsToBurn;
                emit WithdrawnToVault(assets, unitsToBurn);
            }
        }

        _underlying.safeTransfer(vault, withdrawn);
    }

    // -------------------------------------------------------------------------
    // Keeper / Admin — strategy operations
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    function invest(uint256 amount) external override onlyAdminOrKeeper nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 idle = _underlying.balanceOf(address(this));
        if (idle < amount) revert InsufficientIdle(idle, amount);

        _underlying.safeTransfer(strategy, amount);
        IStrategyV21(strategy).invest(amount);

        emit Invested(amount);
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function divestFromStrategy(uint256 amount) external override onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 returned = IStrategyV21(strategy).divest(amount);
        emit DivestFromStrategy(amount, returned);
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function emergencyExitStrategy() external override onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (strategy == address(0)) revert NoStrategy();

        uint256 returned = IStrategyV21(strategy).emergencyExit();
        emit EmergencyExitStrategy(returned);
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function accrueFee() external override onlyAdminOrKeeper {
        _accrueFee();
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    function setStrategy(address strategy_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (strategy_ == address(0)) revert ZeroAddress();
        strategy = strategy_;
        emit StrategySet(strategy_);
    }

    // -------------------------------------------------------------------------
    // Fee extraction — feeReceiver only
    // -------------------------------------------------------------------------

    /// @inheritdoc ICoreStrategyManagerV21
    function redeemFeeUnits(uint256 units) external override nonReentrant returns (uint256 usdcReturned) {
        if (msg.sender != feeReceiver) revert Unauthorized();
        if (units == 0) revert ZeroAmount();

        uint256 available = _unitsOf[feeReceiver];
        if (available < units) revert InsufficientFeeUnits(available, units);

        // Accrue latest fee first (may increase feeReceiver units, always safe to redeem `units`)
        _accrueFee();

        uint256 managed = totalManagedAssets();
        usdcReturned = (_totalUnits > 0 && managed > 0) ? managed * units / _totalUnits : 0;
        if (usdcReturned == 0) revert ZeroAmount();

        _unitsOf[feeReceiver] -= units;
        _totalUnits           -= units;

        _pullLiquidity(usdcReturned);
        _underlying.safeTransfer(feeReceiver, usdcReturned);

        emit FeeUnitsRedeemed(units, usdcReturned);
    }

    /// @inheritdoc ICoreStrategyManagerV21
    function setFeeReceiver(address feeReceiver_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeReceiver_ == address(0)) revert ZeroAddress();
        feeReceiver = feeReceiver_;
        emit FeeReceiverSet(feeReceiver_);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Continuous management-fee accrual via unit dilution.
    ///
    ///   feeAmount = managed × FEE_BPS × elapsed / (BPS_DENOMINATOR × SECONDS_PER_YEAR)
    ///
    /// Dilution formula (ensures feeReceiver units represent exactly feeAmount of value):
    ///   newFeeUnits = _totalUnits × feeAmount / (managed - feeAmount)
    ///
    /// Timestamp is captured BEFORE any state changes to avoid re-entrancy timestamp drift.
    function _accrueFee() internal {
        uint256 elapsed       = block.timestamp - lastFeeAccrualAt;
        lastFeeAccrualAt      = block.timestamp;

        if (elapsed == 0)                  return;
        if (_totalUnits == 0)              return;
        if (feeReceiver == address(0))     return;

        uint256 managed = totalManagedAssets();
        if (managed == 0) return;

        uint256 feeAmount = managed * FEE_BPS * elapsed / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        if (feeAmount == 0) return;

        // Hard cap: fee cannot consume entire managed value
        if (feeAmount >= managed) feeAmount = managed - 1;

        // newFeeUnits / (_totalUnits + newFeeUnits) = feeAmount / managed
        // => newFeeUnits = _totalUnits × feeAmount / (managed - feeAmount)
        uint256 newFeeUnits = _totalUnits * feeAmount / (managed - feeAmount);
        if (newFeeUnits == 0) return;

        _unitsOf[feeReceiver] += newFeeUnits;
        _totalUnits           += newFeeUnits;

        emit FeeAccrued(newFeeUnits, feeAmount, elapsed);
    }

    /// @dev Ensure this contract holds at least `amount` idle underlying.
    ///      Divests from strategy if needed. Reverts if total liquidity is insufficient.
    function _pullLiquidity(uint256 amount) internal returns (uint256) {
        uint256 idle = _underlying.balanceOf(address(this));
        if (idle >= amount) return amount;

        if (strategy == address(0)) revert InsufficientLiquidity(amount, idle);

        uint256 shortfall = amount - idle;
        IStrategyV21(strategy).divest(shortfall);

        uint256 newIdle = _underlying.balanceOf(address(this));
        if (newIdle < amount) revert InsufficientLiquidity(amount, newIdle);

        return amount;
    }
}
