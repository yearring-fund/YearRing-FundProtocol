// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IEligibilityModuleV21.sol";
import "./interfaces/ILockManagerV21.sol";
import "../interfaces/IPointsLedgerV01.sol";

/// @title EligibilityModuleV21
/// @notice Read-only eligibility guard for High-Tier Manager entry.
///
/// Checks performed by canEnterManager()
/// ---------------------------------------
///  1. Lock exists and owner == user
///  2. lock.status == Active
///  3. lock.assetType == YR_USDC
///  4. lock.transition == None
///  5. Actual lock age >= 30 days (Trial locks are never HT-eligible)
///  6. yrUSDCAmount > 0 and <= lock.yrUSDCAmount
///  7. Manager is enabled
///  8. user Points >= requiredPoints    (skipped when threshold == 0 or no ledger)
///  9. user YRFP balance >= requiredYRFP (skipped when threshold == 0 or no yrfpToken)
/// 10. user is on allowlist             (skipped when allowlistRequired == false)
///
/// Closed-beta defaults: all thresholds = 0, allowlistRequired = false.
/// Admin may enable stricter requirements per manager at any time.
contract EligibilityModuleV21 is IEligibilityModuleV21, AccessControl {

    // -------------------------------------------------------------------------
    // Constants — reason codes
    // -------------------------------------------------------------------------

    bytes32 public constant LOCK_NOT_FOUND      = "LOCK_NOT_FOUND";
    bytes32 public constant NOT_LOCK_OWNER      = "NOT_LOCK_OWNER";
    bytes32 public constant LOCK_NOT_ACTIVE     = "LOCK_NOT_ACTIVE";
    bytes32 public constant LOCK_NOT_YRUSDC     = "LOCK_NOT_YRUSDC";
    bytes32 public constant LOCK_IN_TRANSITION  = "LOCK_IN_TRANSITION";
    bytes32 public constant TRIAL_NOT_ELIGIBLE  = "TRIAL_NOT_HT_ELIGIBLE";
    bytes32 public constant INVALID_AMOUNT      = "INVALID_AMOUNT";
    bytes32 public constant MANAGER_DISABLED    = "MANAGER_DISABLED";
    bytes32 public constant INSUFFICIENT_POINTS = "INSUFFICIENT_POINTS";
    bytes32 public constant INSUFFICIENT_YRFP   = "INSUFFICIENT_YRFP";
    bytes32 public constant NOT_ALLOWLISTED     = "NOT_ALLOWLISTED";

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct ManagerConfig {
        bool    enabled;
        uint256 requiredPoints;     // 18-dec; 0 = no requirement
        uint256 requiredYRFP;       // token units; 0 = no requirement
        bool    allowlistRequired;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ManagerConfigSet(
        address indexed manager,
        bool    enabled,
        uint256 requiredPoints,
        uint256 requiredYRFP,
        bool    allowlistRequired
    );
    event ManagerAllowlistUpdated(address indexed manager, address indexed user, bool allowed);
    event LockManagerSet(address indexed lockManager);
    event PointsLedgerSet(address indexed pointsLedger);
    event YRFPTokenSet(address indexed yrfpToken);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice LockManagerV21 reference — used to read lock state in canEnterManager
    address public lockManager;

    /// @notice PointsLedgerV01 reference — used for Points threshold check
    address public pointsLedger;

    /// @notice YRFP governance token address — used for YRFP threshold check.
    ///         address(0) means the check is always skipped regardless of requiredYRFP.
    address public yrfpToken;

    mapping(address manager => ManagerConfig)             public managerConfigs;
    mapping(address manager => mapping(address user => bool)) public managerAllowlist;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param lockManager_   LockManagerV21 address (may be set later via setLockManager)
    /// @param pointsLedger_  PointsLedgerV01 address (may be address(0))
    /// @param admin_         DEFAULT_ADMIN_ROLE holder
    constructor(
        address lockManager_,
        address pointsLedger_,
        address admin_
    ) {
        if (admin_ == address(0)) revert();
        lockManager  = lockManager_;
        pointsLedger = pointsLedger_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // IEligibilityModuleV21 — view
    // -------------------------------------------------------------------------

    /// @inheritdoc IEligibilityModuleV21
    function isManagerEnabled(address manager) external view override returns (bool) {
        return managerConfigs[manager].enabled;
    }

    /// @inheritdoc IEligibilityModuleV21
    function requiredPoints(address manager) external view override returns (uint256) {
        return managerConfigs[manager].requiredPoints;
    }

    /// @inheritdoc IEligibilityModuleV21
    function requiredYRFP(address manager) external view override returns (uint256) {
        return managerConfigs[manager].requiredYRFP;
    }

    /// @inheritdoc IEligibilityModuleV21
    function allowlistRequired(address manager) external view override returns (bool) {
        return managerConfigs[manager].allowlistRequired;
    }

    /// @inheritdoc IEligibilityModuleV21
    function isAllowlisted(address user, address manager) external view override returns (bool) {
        return managerAllowlist[manager][user];
    }

    // -------------------------------------------------------------------------
    // IEligibilityModuleV21 — canEnterManager
    // -------------------------------------------------------------------------

    /// @inheritdoc IEligibilityModuleV21
    function canEnterManager(
        address user,
        uint256 lockId,
        address manager,
        uint256 yrUSDCAmount
    ) external view override returns (bool ok, bytes32 reason) {

        // ── 1. Lock existence ─────────────────────────────────────────────────
        if (lockManager == address(0)) return (false, LOCK_NOT_FOUND);
        ILockManagerV21.LockInfo memory lock = ILockManagerV21(lockManager).getLock(lockId);
        if (lock.owner == address(0)) return (false, LOCK_NOT_FOUND);

        // ── 2. Owner check ────────────────────────────────────────────────────
        if (lock.owner != user) return (false, NOT_LOCK_OWNER);

        // ── 3. Status ─────────────────────────────────────────────────────────
        if (lock.status != ILockManagerV21.LockStatus.Active)
            return (false, LOCK_NOT_ACTIVE);

        // ── 4. Asset type ─────────────────────────────────────────────────────
        if (lock.assetType != ILockManagerV21.LockAssetType.YR_USDC)
            return (false, LOCK_NOT_YRUSDC);

        // ── 5. No transition in progress ──────────────────────────────────────
        if (lock.transition != ILockManagerV21.LockTransition.None)
            return (false, LOCK_IN_TRANSITION);

        // ── 6. Actual lock age >= 30 days ─────────────────────────────────────
        uint256 lockAge = block.timestamp > uint256(lock.startTime)
            ? block.timestamp - uint256(lock.startTime)
            : 0;
        if (lockAge < 30 days) return (false, TRIAL_NOT_ELIGIBLE);

        // ── 7. Amount check ───────────────────────────────────────────────────
        if (yrUSDCAmount == 0 || yrUSDCAmount > lock.yrUSDCAmount)
            return (false, INVALID_AMOUNT);

        // ── 8. Manager enabled ────────────────────────────────────────────────
        ManagerConfig storage cfg = managerConfigs[manager];
        if (!cfg.enabled) return (false, MANAGER_DISABLED);

        // ── 9. Points threshold ───────────────────────────────────────────────
        if (cfg.requiredPoints > 0 && pointsLedger != address(0)) {
            uint256 pts = IPointsLedgerV01(pointsLedger).balanceOf(user);
            if (pts < cfg.requiredPoints) return (false, INSUFFICIENT_POINTS);
        }

        // ── 10. YRFP threshold ────────────────────────────────────────────────
        if (cfg.requiredYRFP > 0 && yrfpToken != address(0)) {
            uint256 yrfp = IERC20(yrfpToken).balanceOf(user);
            if (yrfp < cfg.requiredYRFP) return (false, INSUFFICIENT_YRFP);
        }

        // ── 11. Allowlist ─────────────────────────────────────────────────────
        if (cfg.allowlistRequired && !managerAllowlist[manager][user])
            return (false, NOT_ALLOWLISTED);

        return (true, bytes32(0));
    }

    // -------------------------------------------------------------------------
    // Admin — manager configuration
    // -------------------------------------------------------------------------

    /// @notice Set or update configuration for an HT Manager.
    ///         Closed-beta initial values: enabled=true, all thresholds=0, allowlistRequired=false.
    function setManagerConfig(
        address manager,
        bool    enabled,
        uint256 requiredPoints_,
        uint256 requiredYRFP_,
        bool    allowlistRequired_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(manager != address(0), "EligibilityModule: zero manager");
        managerConfigs[manager] = ManagerConfig({
            enabled:           enabled,
            requiredPoints:    requiredPoints_,
            requiredYRFP:      requiredYRFP_,
            allowlistRequired: allowlistRequired_
        });
        emit ManagerConfigSet(manager, enabled, requiredPoints_, requiredYRFP_, allowlistRequired_);
    }

    /// @notice Add or remove a user from a manager's allowlist.
    function setManagerAllowlist(address manager, address user, bool allowed)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(manager != address(0) && user != address(0), "EligibilityModule: zero address");
        managerAllowlist[manager][user] = allowed;
        emit ManagerAllowlistUpdated(manager, user, allowed);
    }

    // -------------------------------------------------------------------------
    // Admin — reference addresses
    // -------------------------------------------------------------------------

    function setLockManager(address lockManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lockManager = lockManager_;
        emit LockManagerSet(lockManager_);
    }

    function setPointsLedger(address ledger) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pointsLedger = ledger;
        emit PointsLedgerSet(ledger);
    }

    function setYRFPToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        yrfpToken = token;
        emit YRFPTokenSet(token);
    }
}
