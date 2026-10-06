// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/ITreasuryV21.sol";
import "./interfaces/ICoreStrategyManagerV21.sol";
import "./interfaces/IAccessStrategyManagerV21.sol";

/// @title TreasuryV21
/// @notice Protocol treasury for YearRing V2.1.
///         Holds yrUSDC accumulated from management fees and pays out rebates.
///
/// Fee collection path
/// -------------------
/// Treasury is set as the feeReceiver in CoreStrategyManagerV21 and each
/// AccessStrategyManagerV21.  Fee accrual mints units to this address.
/// Admin / keeper calls settleCoreSMFees() / settleAccessManagerFees() to redeem those
/// units for USDC and deposit to CoreVault → yrUSDC rebate reserve.
///
/// Auto-settle on claim
/// --------------------
/// RebateManagerV21 calls ensureLiquidity() before each payout.
/// ensureLiquidity() iterates registered managers and settles any available
/// fee units if the current yrUSDC balance is insufficient.
///
/// Deployment prerequisite
/// -----------------------
/// Admin must call CoreVault.setAllowlist(address(this), true) so that this
/// contract can deposit USDC to CoreVault when allowlistEnabled = true.
contract TreasuryV21 is ITreasuryV21, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error AccessManagerNotRegistered(address accessManager);
    error AccessManagerAlreadyRegistered(address accessManager);
    error InsufficientYrUSDC(uint256 available, uint256 required);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event CoreSMFeesSettled(uint256 units, uint256 usdcReceived, uint256 yrUSDCReceived);
    event AccessManagerFeesSettled(address indexed accessManager, uint256 units, uint256 usdcReceived, uint256 yrUSDCReceived);
    event RebateWithdrawn(address indexed recipient, uint256 yrUSDCAmount);
    event YrUSDCDeposited(address indexed from, uint256 amount);
    event RebateManagerSet(address indexed rebateManager_);
    event CoreSMSet(address indexed csm);
    event AccessManagerAdded(address indexed accessManager);
    event AccessManagerRemoved(address indexed accessManager);
    /// @notice Emitted for each manager skipped in settleManagers() due to below-threshold value.
    event ManagerSettlementSkipped(address indexed manager, uint256 usdcValue);
    /// @notice Emitted once at the end of a successful settleManagers() batch.
    event ManagersBatchSettled(uint256 managersSettled, uint256 totalUsdcReceived, uint256 totalYrUSDCReceived);
    event MinSettlementValueSet(uint256 newValue);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 — yrUSDC token and USDC deposit target
    address public immutable override coreVault;

    IERC20 private immutable _usdc;

    // -------------------------------------------------------------------------
    // Mutable configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    address public override coreStrategyManager;

    /// @inheritdoc ITreasuryV21
    address public override rebateManager;

    address[] private _accessManagers;
    mapping(address => bool) private _isAccessManager;

    /// @notice Minimum USDC value (6-dec) a manager must have in fee units before
    ///         settleManagers() will redeem it.  Default = 100 USDC.
    uint256 public minSettlementValueUSDC = 100 * 1e6;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param coreVault_          YearRingCoreVaultV21 address
    /// @param usdc_               USDC address (underlying asset of CoreVault)
    /// @param coreStrategyManager_ CoreStrategyManagerV21 address (may be address(0))
    /// @param admin_              DEFAULT_ADMIN_ROLE holder
    constructor(
        address coreVault_,
        address usdc_,
        address coreStrategyManager_,
        address admin_
    ) {
        if (coreVault_ == address(0) || usdc_ == address(0) || admin_ == address(0))
            revert ZeroAddress();

        coreVault           = coreVault_;
        _usdc               = IERC20(usdc_);
        coreStrategyManager = coreStrategyManager_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(KEEPER_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    function yrUSDCBalance() external view override returns (uint256) {
        return IERC20(coreVault).balanceOf(address(this));
    }

    /// @inheritdoc ITreasuryV21
    function accessManagerCount() external view override returns (uint256) {
        return _accessManagers.length;
    }

    /// @inheritdoc ITreasuryV21
    function accessManagerAt(uint256 index) external view override returns (address) {
        return _accessManagers[index];
    }

    // -------------------------------------------------------------------------
    // Fee settlement — admin / keeper
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    function settleCoreSMFees(uint256 units)
        external
        override
        onlyAdminOrKeeper
        nonReentrant
        returns (uint256 yrUSDCReceived)
    {
        if (coreStrategyManager == address(0)) revert ZeroAddress();
        if (units == 0) revert ZeroAmount();

        uint256 usdcReceived = ICoreStrategyManagerV21(coreStrategyManager).redeemFeeUnits(units);
        yrUSDCReceived = _depositUSDC(usdcReceived);

        emit CoreSMFeesSettled(units, usdcReceived, yrUSDCReceived);
    }

    /// @inheritdoc ITreasuryV21
    function settleAccessManagerFees(address accessManager, uint256 units)
        external
        override
        onlyAdminOrKeeper
        nonReentrant
        returns (uint256 yrUSDCReceived)
    {
        if (!_isAccessManager[accessManager]) revert AccessManagerNotRegistered(accessManager);
        if (units == 0) revert ZeroAmount();

        uint256 usdcReceived = IAccessStrategyManagerV21(accessManager).redeemFeeUnits(units);
        yrUSDCReceived = _depositUSDC(usdcReceived);

        emit AccessManagerFeesSettled(accessManager, units, usdcReceived, yrUSDCReceived);
    }

    // -------------------------------------------------------------------------
    // Auto-liquidity
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    /// @dev No try/catch — if any settlement step fails (e.g. strategy illiquid or
    ///      CoreVault paused) the call reverts and the caller (claimRebate) propagates
    ///      the error.  Admin must resolve the underlying issue before retrying.
    function ensureLiquidity(uint256 yrUSDCNeeded) external override nonReentrant {
        if (msg.sender != rebateManager
            && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
            && !hasRole(KEEPER_ROLE, msg.sender))
            revert Unauthorized();

        // Already sufficient — return early
        if (IERC20(coreVault).balanceOf(address(this)) >= yrUSDCNeeded) return;

        // Attempt to refill from CoreSM fee units
        if (coreStrategyManager != address(0)) {
            uint256 units = ICoreStrategyManagerV21(coreStrategyManager).unitsOf(address(this));
            if (units > 0) {
                uint256 usdc = ICoreStrategyManagerV21(coreStrategyManager).redeemFeeUnits(units);
                if (usdc > 0) _depositUSDC(usdc);
            }
        }

        if (IERC20(coreVault).balanceOf(address(this)) >= yrUSDCNeeded) return;

        // Attempt to refill from each registered Access Manager
        for (uint256 i = 0; i < _accessManagers.length; i++) {
            address accessManager = _accessManagers[i];
            uint256 units = IAccessStrategyManagerV21(accessManager).feeReceiverUnits();
            if (units > 0) {
                uint256 usdc = IAccessStrategyManagerV21(accessManager).redeemFeeUnits(units);
                if (usdc > 0) _depositUSDC(usdc);
            }
            if (IERC20(coreVault).balanceOf(address(this)) >= yrUSDCNeeded) return;
        }
        // If we reach here, we have done our best.
        // RebateManager checks the balance after this call and reverts if still insufficient.
    }

    // -------------------------------------------------------------------------
    // Rebate payout — RebateManager only
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    function withdrawRebate(address recipient, uint256 yrUSDCAmount)
        external
        override
        nonReentrant
    {
        if (msg.sender != rebateManager) revert Unauthorized();
        if (yrUSDCAmount == 0) revert ZeroAmount();

        uint256 bal = IERC20(coreVault).balanceOf(address(this));
        if (bal < yrUSDCAmount) revert InsufficientYrUSDC(bal, yrUSDCAmount);

        IERC20(coreVault).safeTransfer(recipient, yrUSDCAmount);
        emit RebateWithdrawn(recipient, yrUSDCAmount);
    }

    // -------------------------------------------------------------------------
    // Admin — manual top-up
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    function depositYrUSDC(uint256 amount) external override onlyAdminOrKeeper nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(coreVault).safeTransferFrom(msg.sender, address(this), amount);
        emit YrUSDCDeposited(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc ITreasuryV21
    function setRebateManager(address rebateManager_)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        rebateManager = rebateManager_;
        emit RebateManagerSet(rebateManager_);
    }

    /// @inheritdoc ITreasuryV21
    function setCoreStrategyManager(address csm)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        coreStrategyManager = csm;
        emit CoreSMSet(csm);
    }

    /// @inheritdoc ITreasuryV21
    function setMinSettlementValueUSDC(uint256 value) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        minSettlementValueUSDC = value;
        emit MinSettlementValueSet(value);
    }

    /// @inheritdoc ITreasuryV21
    function addAccessManager(address accessManager) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (accessManager == address(0)) revert ZeroAddress();
        if (_isAccessManager[accessManager]) revert AccessManagerAlreadyRegistered(accessManager);
        _isAccessManager[accessManager] = true;
        _accessManagers.push(accessManager);
        emit AccessManagerAdded(accessManager);
    }

    /// @inheritdoc ITreasuryV21
    function removeAccessManager(address accessManager) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_isAccessManager[accessManager]) revert AccessManagerNotRegistered(accessManager);
        _isAccessManager[accessManager] = false;

        // Swap-and-pop removal from array
        uint256 len = _accessManagers.length;
        for (uint256 i = 0; i < len; i++) {
            if (_accessManagers[i] == accessManager) {
                _accessManagers[i] = _accessManagers[len - 1];
                _accessManagers.pop();
                break;
            }
        }
        emit AccessManagerRemoved(accessManager);
    }

    // -------------------------------------------------------------------------
    // Batch settlement — admin / keeper
    // -------------------------------------------------------------------------

    /// @notice Settle fee units for a caller-specified list of managers in one transaction.
    ///         `managers` may contain address(0) as a sentinel for the CoreSM entry; any
    ///         registered Access Manager address is also accepted.  Unrecognised addresses are skipped.
    ///         Managers whose redeemable USDC value (computed via unitPrice) is below
    ///         `minSettlementValueUSDC` are skipped without reverting.
    ///
    /// @param managers Ordered list of manager addresses to settle.
    ///                 Pass `address(0)` or `coreStrategyManager` to include CoreSM.
    ///                 Pass registered Access Manager addresses to settle their fees.
    function settleManagers(address[] calldata managers)
        external
        override
        onlyAdminOrKeeper
        nonReentrant
    {
        uint256 totalUSDC;
        uint256 totalYrUSDC;
        uint256 settled;

        for (uint256 i = 0; i < managers.length; i++) {
            address mgr = managers[i];
            bool isCoresSM = (mgr == address(0) || mgr == coreStrategyManager);

            if (isCoresSM) {
                // CoreSM settlement
                if (coreStrategyManager == address(0)) continue;
                address csm = coreStrategyManager;
                uint256 units = ICoreStrategyManagerV21(csm).unitsOf(address(this));
                if (units == 0) continue;

                // Estimate USDC value — unitPriceRay * units / 1e27
                uint256 usdcValue = ICoreStrategyManagerV21(csm).unitPriceRay() * units / 1e27;
                if (usdcValue < minSettlementValueUSDC) {
                    emit ManagerSettlementSkipped(csm, usdcValue);
                    continue;
                }

                uint256 usdc = ICoreStrategyManagerV21(csm).redeemFeeUnits(units);
                uint256 yr   = _depositUSDC(usdc);
                totalUSDC  += usdc;
                totalYrUSDC += yr;
                settled++;
                emit CoreSMFeesSettled(units, usdc, yr);

            } else if (_isAccessManager[mgr]) {
                // Access Manager settlement
                uint256 units = IAccessStrategyManagerV21(mgr).feeReceiverUnits();
                if (units == 0) continue;

                // Estimate USDC value via Access Manager's unitPriceRay
                uint256 usdcValue = IAccessStrategyManagerV21(mgr).unitPriceRay() * units / 1e27;
                if (usdcValue < minSettlementValueUSDC) {
                    emit ManagerSettlementSkipped(mgr, usdcValue);
                    continue;
                }

                uint256 usdc = IAccessStrategyManagerV21(mgr).redeemFeeUnits(units);
                uint256 yr   = _depositUSDC(usdc);
                totalUSDC  += usdc;
                totalYrUSDC += yr;
                settled++;
                emit AccessManagerFeesSettled(mgr, units, usdc, yr);

            }
            // Unrecognised address — skip silently
        }

        emit ManagersBatchSettled(settled, totalUSDC, totalYrUSDC);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Approve CoreVault to spend `usdcAmount` and deposit, receiving yrUSDC here.
    ///      Uses safeApprove reset pattern for USDC compatibility.
    ///      Prerequisite: this contract on CoreVault allowlist when allowlistEnabled = true.
    function _depositUSDC(uint256 usdcAmount) internal returns (uint256 yrUSDCReceived) {
        if (usdcAmount == 0) return 0;
        _usdc.safeApprove(coreVault, 0);
        _usdc.safeApprove(coreVault, usdcAmount);
        yrUSDCReceived = IERC4626(coreVault).deposit(usdcAmount, address(this));
    }

    modifier onlyAdminOrKeeper() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender))
            revert Unauthorized();
        _;
    }
}
