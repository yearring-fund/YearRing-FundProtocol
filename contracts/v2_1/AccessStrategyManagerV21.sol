// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IAccessStrategyManagerV21.sol";
import "./interfaces/IStrategyV21.sol";

/// @title AccessStrategyManagerV21
/// @notice Access-controlled Strategy Manager for YearRing V2.1.
///         Manages USDC capital deployed into a yield strategy on behalf of
///         locked positions in LockManagerV21 (Phase 3).
///
/// Units model
/// -----------
/// Per-lockId units (18-decimal) represent each position's proportional share of
/// totalManagedAssets.  Unit price rises as yield accrues while totalUnits stays flat
/// between entry/exit/fee events.
///
///   unitPriceRay = totalManagedAssets × 1e27 / totalUnits
///
/// Fee accrual mints new units to feeReceiver, diluting all lockId holders.
/// No USDC is deducted — dilution IS the fee.
///
///   newFeeUnits = totalUnits × feeAmount / (totalManagedAssets - feeAmount)
///
/// Entry / exit
/// ------------
/// enter(): yrUSDC already transferred by LockManager; this contract redeems it via
///          CoreVault and issues proportional managerUnits.  USDC sits idle until
///          keeper calls invest().
///
/// exit():  Burns lock's units, pulls proportional USDC (idle first, then strategy),
///          deposits USDC to CoreVault (this contract must be on CoreVault allowlist),
///          and transfers yrUSDC to LockManager.
///
/// Deployment note
/// ---------------
/// Admin must add this contract to CoreVault's allowlist via
/// CoreVault.setAllowlist(address(this), true) before the first exit() call when
/// CoreVault.allowlistEnabled == true.
///
/// Default fee: 100 bps / year (1%).  MAX_FEE_BPS = 2 000 (20%).
contract AccessStrategyManagerV21 is IAccessStrategyManagerV21, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// @notice Initial scale: 1 USDC (6-dec) → 1e12 units (18-dec) at first entry
    uint256 public constant UNITS_SCALE      = 1e12;
    uint256 public constant RAY              = 1e27;
    /// @notice Maximum allowed management fee: 20% / year
    uint256 public constant MAX_FEE_BPS      = 2_000;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotLockManager();
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroUnits();
    error NoStrategy();
    error LockAlreadyEntered(uint256 lockId);
    error LockNotEntered(uint256 lockId);
    error InsufficientIdle(uint256 available, uint256 required);
    error InsufficientManagedAssets(uint256 available, uint256 required);
    error InsufficientLiquidity(uint256 required, uint256 available);
    error FeeBpsTooHigh(uint256 bps);
    error InsufficientFeeUnits(uint256 available, uint256 requested);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Entered(
        uint256 indexed lockId,
        uint256 yrUSDCAmount,
        uint256 usdcReceived,
        uint256 unitsMinted
    );
    event Exited(
        uint256 indexed lockId,
        uint256 unitsBurned,
        uint256 usdcDivested,
        uint256 yrUSDCReturned
    );
    event FeeAccrued(uint256 unitsMinted, uint256 feeAssetEquiv, uint256 elapsed);
    event ManagementFeeBpsSet(uint256 bps);
    event StrategySet(address indexed strategy_);
    event FeeReceiverSet(address indexed feeReceiver_);
    event LockManagerSet(address indexed lockManager_);
    event Invested(uint256 amount);
    event DivestFromStrategy(uint256 requested, uint256 returned);
    event EmergencyExitStrategy(uint256 returned);
    event FeeUnitsRedeemed(uint256 unitsBurned, uint256 usdcReturned);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 — used for yrUSDC ↔ USDC conversion
    address public immutable override coreVault;

    IERC20 private immutable _underlying;

    // -------------------------------------------------------------------------
    // Mutable configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc IAccessStrategyManagerV21
    address public override lockManager;

    /// @inheritdoc IAccessStrategyManagerV21
    address public override strategy;

    /// @inheritdoc IAccessStrategyManagerV21
    address public override feeReceiver;

    /// @inheritdoc IAccessStrategyManagerV21
    uint256 public override managementFeeBpsPerYear;

    // -------------------------------------------------------------------------
    // Units accounting
    // -------------------------------------------------------------------------

    /// @notice Units attributed to each lockId
    mapping(uint256 => uint256) private _unitsOfLock;

    /// @notice Units attributed to the fee receiver (separate from lock units)
    uint256 private _feeReceiverUnits;

    /// @notice Total outstanding units (all lockIds + fee receiver)
    uint256 private _totalUnits;

    // -------------------------------------------------------------------------
    // Fee accrual state
    // -------------------------------------------------------------------------

    /// @notice Timestamp of the most recent fee accrual checkpoint
    uint256 public lastFeeAccrualAt;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param underlying_    USDC address
    /// @param coreVault_     YearRingCoreVaultV21 address
    /// @param lockManager_   LockManagerV21 address (may be address(0) to set later)
    /// @param feeBpsPerYear_ Initial management fee in bps/year (e.g. 100 = 1%)
    /// @param admin_         Initial DEFAULT_ADMIN_ROLE holder
    constructor(
        address underlying_,
        address coreVault_,
        address lockManager_,
        uint256 feeBpsPerYear_,
        address admin_
    ) {
        if (underlying_ == address(0) || coreVault_ == address(0) || admin_ == address(0))
            revert ZeroAddress();
        if (feeBpsPerYear_ > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBpsPerYear_);

        _underlying             = IERC20(underlying_);
        coreVault               = coreVault_;
        lockManager             = lockManager_;
        managementFeeBpsPerYear = feeBpsPerYear_;
        lastFeeAccrualAt        = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(KEEPER_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyLockManager() {
        if (msg.sender != lockManager) revert NotLockManager();
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

    /// @inheritdoc IAccessStrategyManagerV21
    function underlying() external view override returns (address) {
        return address(_underlying);
    }

    // -------------------------------------------------------------------------
    // View — accounting
    // -------------------------------------------------------------------------

    /// @notice Total USDC value: idle held here + strategy-deployed assets
    function totalManagedAssets() public view override returns (uint256) {
        uint256 inStrategy = strategy != address(0)
            ? IStrategyV21(strategy).totalUnderlying()
            : 0;
        return _underlying.balanceOf(address(this)) + inStrategy;
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function totalUnits() external view override returns (uint256) {
        return _totalUnits;
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function unitsOfLock(uint256 lockId) external view override returns (uint256) {
        return _unitsOfLock[lockId];
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function feeReceiverUnits() external view override returns (uint256) {
        return _feeReceiverUnits;
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function unitPriceRay() external view override returns (uint256) {
        if (_totalUnits == 0) return RAY;
        return totalManagedAssets() * RAY / _totalUnits;
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function lockManagedAssets(uint256 lockId) external view override returns (uint256) {
        if (_totalUnits == 0) return 0;
        return totalManagedAssets() * _unitsOfLock[lockId] / _totalUnits;
    }

    // -------------------------------------------------------------------------
    // LockManager-only — enter
    // -------------------------------------------------------------------------

    /// @inheritdoc IAccessStrategyManagerV21
    /// @dev LockManager must transfer yrUSDC to this contract BEFORE calling enter().
    ///      Accrues outstanding fee first so new units are issued at the post-fee price.
    ///      Pre-deposit AUM is captured before the redemption because yrUSDC is not
    ///      counted in totalManagedAssets() — only USDC is.
    function enter(uint256 lockId, uint256 yrUSDCAmount)
        external
        override
        onlyLockManager
        nonReentrant
        returns (uint256 managerUnits)
    {
        if (yrUSDCAmount == 0) revert ZeroAmount();
        if (_unitsOfLock[lockId] != 0) revert LockAlreadyEntered(lockId);

        _accrueFee();

        // Capture pre-deposit AUM before the yrUSDC redemption.
        // (yrUSDC held in this contract is NOT counted in totalManagedAssets;
        //  after redeem() it becomes USDC which IS counted.)
        uint256 preAssets = totalManagedAssets();

        // Redeem yrUSDC for USDC; both owner and receiver are this contract
        uint256 usdcBefore   = _underlying.balanceOf(address(this));
        IERC4626(coreVault).redeem(yrUSDCAmount, address(this), address(this));
        uint256 usdcReceived = _underlying.balanceOf(address(this)) - usdcBefore;

        if (usdcReceived == 0) revert ZeroAmount();

        // Mint units proportional to USDC received relative to pre-deposit AUM
        if (_totalUnits == 0 || preAssets == 0) {
            // First entry: issue at initial scale
            managerUnits = usdcReceived * UNITS_SCALE;
        } else {
            // Proportional issuance: newUnits / totalUnits = usdcReceived / preAssets
            managerUnits = _totalUnits * usdcReceived / preAssets;
        }
        if (managerUnits == 0) revert ZeroUnits();

        _unitsOfLock[lockId] = managerUnits;
        _totalUnits         += managerUnits;

        emit Entered(lockId, yrUSDCAmount, usdcReceived, managerUnits);
    }

    // -------------------------------------------------------------------------
    // LockManager-only — exit
    // -------------------------------------------------------------------------

    /// @inheritdoc IAccessStrategyManagerV21
    /// @dev Accrues fee first (dilutes lock's share) then computes USDC owed.
    ///      Pulls liquidity from strategy if idle is insufficient.
    ///      Deposits USDC to CoreVault with this contract as receiver, then transfers
    ///      yrUSDC to LockManager.
    ///
    ///      Prerequisite: admin must have added this contract to CoreVault allowlist via
    ///      CoreVault.setAllowlist(address(this), true) when allowlistEnabled = true.
    function exit(uint256 lockId)
        external
        override
        onlyLockManager
        nonReentrant
        returns (uint256 yrUSDCReturned)
    {
        uint256 lockUnits = _unitsOfLock[lockId];
        if (lockUnits == 0) revert LockNotEntered(lockId);

        _accrueFee();

        uint256 managed  = totalManagedAssets();
        uint256 usdcOwed = _totalUnits > 0 ? managed * lockUnits / _totalUnits : 0;
        if (usdcOwed == 0) revert ZeroAmount();

        // Burn lock's units
        _unitsOfLock[lockId] = 0;
        _totalUnits         -= lockUnits;

        // Pull USDC from strategy if idle is insufficient
        _pullLiquidity(usdcOwed);

        // Deposit USDC to CoreVault → receive yrUSDC to this contract.
        // safeApprove: reset to 0 then set amount (USDC non-standard approval safety).
        _underlying.safeApprove(coreVault, 0);
        _underlying.safeApprove(coreVault, usdcOwed);
        yrUSDCReturned = IERC4626(coreVault).deposit(usdcOwed, address(this));

        // Transfer yrUSDC to LockManager (coreVault IS the yrUSDC ERC-20)
        IERC20(coreVault).safeTransfer(lockManager, yrUSDCReturned);

        emit Exited(lockId, lockUnits, usdcOwed, yrUSDCReturned);
    }

    // -------------------------------------------------------------------------
    // Keeper / Admin — strategy operations
    // -------------------------------------------------------------------------

    /// @inheritdoc IAccessStrategyManagerV21
    function invest(uint256 amount) external override onlyAdminOrKeeper nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 idle = _underlying.balanceOf(address(this));
        if (idle < amount) revert InsufficientIdle(idle, amount);

        _underlying.safeTransfer(strategy, amount);
        IStrategyV21(strategy).invest(amount);

        emit Invested(amount);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function divestFromStrategy(uint256 amount)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (strategy == address(0)) revert NoStrategy();

        uint256 returned = IStrategyV21(strategy).divest(amount);
        emit DivestFromStrategy(amount, returned);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function emergencyExitStrategy()
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (strategy == address(0)) revert NoStrategy();
        uint256 returned = IStrategyV21(strategy).emergencyExit();
        emit EmergencyExitStrategy(returned);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function accrueFee() external override onlyAdminOrKeeper {
        _accrueFee();
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // Fee extraction — feeReceiver only
    // -------------------------------------------------------------------------

    /// @inheritdoc IAccessStrategyManagerV21
    function redeemFeeUnits(uint256 units) external override nonReentrant returns (uint256 usdcReturned) {
        if (msg.sender != feeReceiver) revert Unauthorized();
        if (units == 0) revert ZeroAmount();

        if (_feeReceiverUnits < units) revert InsufficientFeeUnits(_feeReceiverUnits, units);

        // Accrue latest fee first
        _accrueFee();

        uint256 managed = totalManagedAssets();
        usdcReturned = (_totalUnits > 0 && managed > 0) ? managed * units / _totalUnits : 0;
        if (usdcReturned == 0) revert ZeroAmount();

        _feeReceiverUnits -= units;
        _totalUnits       -= units;

        _pullLiquidity(usdcReturned);
        _underlying.safeTransfer(feeReceiver, usdcReturned);

        emit FeeUnitsRedeemed(units, usdcReturned);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function setStrategy(address strategy_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (strategy_ == address(0)) revert ZeroAddress();
        strategy = strategy_;
        emit StrategySet(strategy_);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function setFeeReceiver(address feeReceiver_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeReceiver_ == address(0)) revert ZeroAddress();
        feeReceiver = feeReceiver_;
        emit FeeReceiverSet(feeReceiver_);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function setManagementFeeBps(uint256 bps_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps_ > MAX_FEE_BPS) revert FeeBpsTooHigh(bps_);
        managementFeeBpsPerYear = bps_;
        emit ManagementFeeBpsSet(bps_);
    }

    /// @inheritdoc IAccessStrategyManagerV21
    function setLockManager(address lockManager_) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lockManager_ == address(0)) revert ZeroAddress();
        lockManager = lockManager_;
        emit LockManagerSet(lockManager_);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Continuous fee accrual via unit dilution.
    ///
    ///   feeAmount = totalManagedAssets × feeBps × elapsed / (BPS × YEAR)
    ///   newFeeUnits = totalUnits × feeAmount / (totalManagedAssets - feeAmount)
    ///
    /// Timestamp is updated BEFORE any state changes to prevent double-charging.
    function _accrueFee() internal {
        uint256 elapsed  = block.timestamp - lastFeeAccrualAt;
        lastFeeAccrualAt = block.timestamp;

        if (elapsed == 0)                    return;
        if (_totalUnits == 0)                return;
        if (feeReceiver == address(0))       return;
        if (managementFeeBpsPerYear == 0)    return;

        uint256 managed = totalManagedAssets();
        if (managed == 0) return;

        uint256 feeAmount =
            managed * managementFeeBpsPerYear * elapsed / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        if (feeAmount == 0) return;

        // Hard cap
        if (feeAmount >= managed) feeAmount = managed - 1;

        // newFeeUnits / (_totalUnits + newFeeUnits) = feeAmount / managed
        uint256 newFeeUnits = _totalUnits * feeAmount / (managed - feeAmount);
        if (newFeeUnits == 0) return;

        _feeReceiverUnits += newFeeUnits;
        _totalUnits       += newFeeUnits;

        emit FeeAccrued(newFeeUnits, feeAmount, elapsed);
    }

    /// @dev Ensure this contract holds at least `amount` idle USDC.
    ///      Pulls from strategy if needed. Reverts if total liquidity is insufficient.
    function _pullLiquidity(uint256 amount) internal {
        uint256 idle = _underlying.balanceOf(address(this));
        if (idle >= amount) return;

        if (strategy == address(0)) revert InsufficientLiquidity(amount, idle);

        uint256 shortfall = amount - idle;
        IStrategyV21(strategy).divest(shortfall);

        uint256 newIdle = _underlying.balanceOf(address(this));
        if (newIdle < amount) revert InsufficientLiquidity(amount, newIdle);
    }
}
