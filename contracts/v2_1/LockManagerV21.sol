// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/ILockManagerV21.sol";
import "./interfaces/IEligibilityModuleV21.sol";
import "../interfaces/IPointsLedgerV01.sol";
import "./interfaces/IAccessStrategyManagerV21.sol";
import "./RewardsMathV21.sol";

/// @title LockManagerV21
/// @notice Lock contract for YearRing V2.1 closed beta.
///
/// Responsibilities
/// ----------------
/// • Accept yrUSDC from users and issue lockIds.
/// • Track per-lock Points (base + bonus) and rebate (USDC).
/// • Split, unlock, and early-exit locks.
/// • Gate HT Manager entry via EligibilityModuleV21 (Phase 3 flow).
///
/// Points model
/// ------------
/// Base Points are issued once at createLock based on committedDuration × principalUSDC.
/// Bonus Points accrue continuously while the lock is Active, computed per time segment
/// using actual lock age tiers (30 / 90 / 180 day boundaries).
/// Both are credited to PointsLedgerV01 (if configured).
/// Early exit forfeits all base + bonus Points via a debit call.
///
/// Rebate model
/// ------------
/// Rebate accrues as a fraction of the management fee, computed per time segment by
/// actual lock age tier (Trial=0%, Bronze=20%, Silver=40%, Gold=60%).
/// Accumulated in lock.claimableRebateUSDC (USDC 6-dec).
/// Phase 4 RebateManager handles the actual yrUSDC payout.
///
/// Tier boundaries (same table for commitment multiplier and bonus/rebate age tiers)
/// ---------------------------------------------------------------------------------
///   < 30 days:  Trial   — multiplier 0.5×, rebate 0%
///   30–89 days: Bronze  — multiplier 1.0×, rebate 20%
///   90–179 days: Silver — multiplier 1.3×, rebate 40%
///   180+ days:  Gold    — multiplier 1.8×, rebate 60%
contract LockManagerV21 is ILockManagerV21, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant KEEPER_ROLE          = keccak256("KEEPER_ROLE");
    bytes32 public constant REBATE_MANAGER_ROLE  = keccak256("REBATE_MANAGER_ROLE");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant MIN_COMMITTED_DURATION = 7 days;
    uint256 public constant MIN_LOCK_ASSETS_USDC   = 1e6;        // 1 USDC (6 dec)
    uint256 public constant SECONDS_PER_YEAR       = 365 days;
    uint256 public constant BPS_DENOMINATOR        = 10_000;
    /// @notice Scale factor: principalAssetsUSDC (6-dec) × POINTS_SCALE → 18-dec Points
    uint256 public constant POINTS_SCALE           = 1e12;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error NewLocksPaused();
    error NotImplemented();
    error DurationTooShort(uint64 given, uint64 minimum);
    error LockAmountTooSmall(uint256 assetsUSDC, uint256 minimum);
    error NotOwner(uint256 lockId, address caller);
    error LockNotActive(uint256 lockId);
    error LockNotMatured(uint256 lockId, uint64 minUnlockTime);
    error LockAlreadyMatured(uint256 lockId);
    error MustExitHTFirst(uint256 lockId);
    error LockInTransition(uint256 lockId);
    error SplitAmountInvalid(uint256 splitAmount, uint256 locked);
    error FeeBpsTooHigh(uint256 bps);
    error EligibilityCheckFailed(bytes32 reason);
    error NotInManagerState(uint256 lockId);
    error RebateNotClaimable(uint256 lockId);
    error NothingToClaim(uint256 lockId);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event LockCreated(
        uint256 indexed lockId,
        address indexed owner,
        uint256 yrUSDCAmount,
        uint256 principalAssetsUSDC,
        uint64  committedDuration,
        uint256 basePoints
    );
    event LockSplit(
        uint256 indexed originalLockId,
        uint256 indexed newLockId,
        address indexed owner,
        uint256 splitYrUSDC,
        uint256 splitPoints
    );
    event LockUnlocked(
        uint256 indexed lockId,
        address indexed owner,
        uint256 yrUSDCAmount
    );
    event LockEarlyExited(
        uint256 indexed lockId,
        address indexed owner,
        uint256 yrUSDCAmount,
        uint256 pointsForfeited
    );
    event BonusPointsCheckpoint(
        uint256 indexed lockId,
        address indexed owner,
        uint256 bonusDelta
    );
    event RebateCheckpoint(
        uint256 indexed lockId,
        address indexed owner,
        uint256 rebateDeltaUSDC
    );
    event EligibilityModuleSet(address indexed module);
    event PointsLedgerSet(address indexed ledger);
    event CoreSMFeeBpsPerYearSet(uint256 bps);
    event NewLocksPausedSet(bool paused);
    event LockEnteredManager(
        uint256 indexed lockId,
        address indexed owner,
        address indexed manager,
        uint256 yrUSDCAmount,
        uint256 managerUnits
    );
    event LockExitedManager(
        uint256 indexed lockId,
        address indexed owner,
        address indexed manager,
        uint256 returnedYrUSDC,
        uint256 newPrincipalUSDC
    );
    event RebateClaimed(
        uint256 indexed lockId,
        address indexed owner,
        uint256 claimedUSDC
    );

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice yrUSDC ERC-20 (the CoreVault share token)
    IERC20 public immutable yrUSDC;

    /// @notice YearRingCoreVaultV21 — used for convertToAssets(yrUSDCAmount) at lock creation
    address public immutable coreVault;

    // -------------------------------------------------------------------------
    // Mutable configuration
    // -------------------------------------------------------------------------

    /// @notice PointsLedgerV01 — may be address(0) to skip all Points calls
    address public pointsLedger;

    /// @notice EligibilityModuleV21 — checked in enterAccessStrategyManager (Phase 3)
    address public eligibilityModule;

    /// @notice Annual management fee bps used for Core-path (YR_USDC) rebate calculation.
    ///         Must match CoreStrategyManagerV21.FEE_BPS. Admin-configurable.
    uint256 public coreSMFeeBpsPerYear = 50;

    /// @notice When true, createLock reverts
    bool public newLocksPaused;

    // -------------------------------------------------------------------------
    // Lock storage
    // -------------------------------------------------------------------------

    mapping(uint256 => LockInfo) private _locks;

    /// @notice Per-user ordered list of lock IDs (append-only; includes exited locks)
    mapping(address => uint256[]) private _userLocks;

    /// @notice Next lock ID to assign (starts at 1; ID 0 = invalid)
    uint256 private _nextLockId = 1;

    /// @notice Running total of yrUSDC currently held in Active locks
    uint256 public totalLockedYrUSDC;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param yrUSDC_       YearRingCoreVaultV21 share token address
    /// @param coreVault_    YearRingCoreVaultV21 address (for convertToAssets)
    /// @param pointsLedger_ PointsLedgerV01 address (pass address(0) to defer)
    /// @param admin_        Initial DEFAULT_ADMIN_ROLE holder
    constructor(
        address yrUSDC_,
        address coreVault_,
        address pointsLedger_,
        address admin_
    ) {
        if (yrUSDC_ == address(0) || coreVault_ == address(0) || admin_ == address(0))
            revert ZeroAddress();

        yrUSDC     = IERC20(yrUSDC_);
        coreVault  = coreVault_;
        pointsLedger = pointsLedger_; // may be address(0)

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(KEEPER_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — view
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function getLock(uint256 lockId) external view override returns (LockInfo memory) {
        return _locks[lockId];
    }

    /// @inheritdoc ILockManagerV21
    function ownerOf(uint256 lockId) external view override returns (address) {
        return _locks[lockId].owner;
    }

    /// @inheritdoc ILockManagerV21
    function totalPoints(uint256 lockId) external view override returns (uint256) {
        LockInfo storage lock = _locks[lockId];
        return lock.basePointsIssued + lock.bonusPointsIssued;
    }

    /// @inheritdoc ILockManagerV21
    function nextLockId() external view override returns (uint256) {
        return _nextLockId;
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — createLock
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function createLock(uint256 yrUSDCAmount, uint64 committedDuration)
        external
        override
        nonReentrant
        returns (uint256 lockId)
    {
        if (newLocksPaused) revert NewLocksPaused();
        if (yrUSDCAmount == 0) revert ZeroAmount();
        if (committedDuration < uint64(MIN_COMMITTED_DURATION))
            revert DurationTooShort(committedDuration, uint64(MIN_COMMITTED_DURATION));

        // Compute USDC equivalent and enforce minimum
        uint256 principalUSDC = IERC4626(coreVault).convertToAssets(yrUSDCAmount);
        if (principalUSDC < MIN_LOCK_ASSETS_USDC)
            revert LockAmountTooSmall(principalUSDC, MIN_LOCK_ASSETS_USDC);

        // Pull yrUSDC from caller
        yrUSDC.safeTransferFrom(msg.sender, address(this), yrUSDCAmount);

        lockId = _nextLockId++;

        // Base Points: principalUSDC (6-dec) × POINTS_SCALE × multiplier / BPS_DENOMINATOR → 18-dec
        uint256 multiplierBps = RewardsMathV21.tierMultiplierBps(committedDuration);
        uint256 basePoints    = principalUSDC * POINTS_SCALE * multiplierBps / BPS_DENOMINATOR;

        uint64 now_ = uint64(block.timestamp);

        _locks[lockId] = LockInfo({
            owner:                    msg.sender,
            yrUSDCAmount:             yrUSDCAmount,
            principalAssetsUSDC:      principalUSDC,
            startTime:                now_,
            minUnlockTime:            now_ + committedDuration,
            committedDuration:        committedDuration,
            basePointsIssued:         basePoints,
            bonusPointsIssued:        0,
            lastBonusPointsCheckpoint: now_,
            lastRebateCheckpoint:      now_,
            claimableRebateUSDC:      0,
            manager:                  address(0),
            managerUnits:             0,
            assetType:                LockAssetType.YR_USDC,
            status:                   LockStatus.Active,
            transition:               LockTransition.None
        });

        totalLockedYrUSDC += yrUSDCAmount;

        // Record lock in per-user enumeration
        _userLocks[msg.sender].push(lockId);

        // Credit base Points to ledger
        _creditPoints(msg.sender, basePoints);

        emit LockCreated(lockId, msg.sender, yrUSDCAmount, principalUSDC, committedDuration, basePoints);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — splitLock
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    /// @dev Points and rebate are split proportionally by yrUSDC amount ratio.
    ///      Rounding dust stays in the original lock (via subtraction).
    ///      The split does NOT trigger additional PointsLedger calls beyond the normal
    ///      pre-operation checkpoint.
    function splitLock(uint256 lockId, uint256 splitYrUSDC)
        external
        override
        nonReentrant
        returns (uint256 newLockId)
    {
        LockInfo storage orig = _locks[lockId];

        if (orig.owner != msg.sender)                           revert NotOwner(lockId, msg.sender);
        if (orig.status != LockStatus.Active)                   revert LockNotActive(lockId);
        if (orig.assetType != LockAssetType.YR_USDC)           revert MustExitHTFirst(lockId);
        if (orig.transition != LockTransition.None)             revert LockInTransition(lockId);
        if (splitYrUSDC == 0 || splitYrUSDC >= orig.yrUSDCAmount)
            revert SplitAmountInvalid(splitYrUSDC, orig.yrUSDCAmount);

        // Checkpoint before computing split ratios
        _checkpointBonusPoints(lockId, orig);
        _checkpointRebate(lockId, orig);

        uint256 origAmount = orig.yrUSDCAmount;

        // Proportional split (dust stays in original via subtraction)
        uint256 splitPrincipal = orig.principalAssetsUSDC * splitYrUSDC / origAmount;
        uint256 splitBase      = orig.basePointsIssued    * splitYrUSDC / origAmount;
        uint256 splitBonus     = orig.bonusPointsIssued   * splitYrUSDC / origAmount;
        uint256 splitRebate    = orig.claimableRebateUSDC * splitYrUSDC / origAmount;

        newLockId = _nextLockId++;

        uint64 now_ = uint64(block.timestamp);

        _locks[newLockId] = LockInfo({
            owner:                    orig.owner,
            yrUSDCAmount:             splitYrUSDC,
            principalAssetsUSDC:      splitPrincipal,
            startTime:                orig.startTime,
            minUnlockTime:            orig.minUnlockTime,
            committedDuration:        orig.committedDuration,
            basePointsIssued:         splitBase,
            bonusPointsIssued:        splitBonus,
            lastBonusPointsCheckpoint: now_,
            lastRebateCheckpoint:      now_,
            claimableRebateUSDC:      splitRebate,
            manager:                  address(0),
            managerUnits:             0,
            assetType:                LockAssetType.YR_USDC,
            status:                   LockStatus.Active,
            transition:               LockTransition.None
        });

        // Record new lock in per-user enumeration
        _userLocks[orig.owner].push(newLockId);

        // Update original (dust stays here via subtraction)
        orig.yrUSDCAmount          -= splitYrUSDC;
        orig.principalAssetsUSDC   -= splitPrincipal;
        orig.basePointsIssued      -= splitBase;
        orig.bonusPointsIssued     -= splitBonus;
        orig.claimableRebateUSDC   -= splitRebate;
        orig.lastBonusPointsCheckpoint = now_;
        orig.lastRebateCheckpoint      = now_;

        emit LockSplit(lockId, newLockId, msg.sender, splitYrUSDC, splitBase + splitBonus);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — unlock
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function unlock(uint256 lockId)
        external
        override
        nonReentrant
        returns (uint256 returnedYrUSDC)
    {
        LockInfo storage lock = _locks[lockId];

        if (lock.owner != msg.sender)                        revert NotOwner(lockId, msg.sender);
        if (lock.status != LockStatus.Active)                revert LockNotActive(lockId);
        if (lock.assetType == LockAssetType.MANAGER_UNITS)  revert MustExitHTFirst(lockId);
        if (lock.transition != LockTransition.None)         revert LockInTransition(lockId);
        if (block.timestamp < lock.minUnlockTime)
            revert LockNotMatured(lockId, lock.minUnlockTime);

        // Checkpoint before state change
        _checkpointBonusPoints(lockId, lock);
        _checkpointRebate(lockId, lock);

        returnedYrUSDC    = lock.yrUSDCAmount;
        lock.status       = LockStatus.Exited;
        lock.yrUSDCAmount = 0;
        totalLockedYrUSDC -= returnedYrUSDC;

        yrUSDC.safeTransfer(msg.sender, returnedYrUSDC);

        emit LockUnlocked(lockId, msg.sender, returnedYrUSDC);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — earlyExit
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function earlyExit(uint256 lockId)
        external
        override
        nonReentrant
        returns (uint256 returnedYrUSDC)
    {
        LockInfo storage lock = _locks[lockId];

        if (lock.owner != msg.sender)                        revert NotOwner(lockId, msg.sender);
        if (lock.status != LockStatus.Active)                revert LockNotActive(lockId);
        if (lock.assetType == LockAssetType.MANAGER_UNITS)  revert MustExitHTFirst(lockId);
        if (lock.transition != LockTransition.None)         revert LockInTransition(lockId);
        if (block.timestamp >= lock.minUnlockTime)          revert LockAlreadyMatured(lockId);

        // Checkpoint to compute latest bonus before forfeiting
        _checkpointBonusPoints(lockId, lock);
        // Note: rebate is forfeited, but checkpoint records the final amount for auditability
        _checkpointRebate(lockId, lock);

        uint256 totalToForfit = lock.basePointsIssued + lock.bonusPointsIssued;

        // Debit all Points from ledger
        if (totalToForfit > 0 && pointsLedger != address(0)) {
            IPointsLedgerV01(pointsLedger).debit(lock.owner, totalToForfit);
        }

        returnedYrUSDC = lock.yrUSDCAmount;

        // Forfeit all rewards
        lock.status              = LockStatus.EarlyExited;
        lock.yrUSDCAmount        = 0;
        lock.claimableRebateUSDC = 0;
        lock.basePointsIssued    = 0;
        lock.bonusPointsIssued   = 0;
        totalLockedYrUSDC       -= returnedYrUSDC;

        yrUSDC.safeTransfer(msg.sender, returnedYrUSDC);

        emit LockEarlyExited(lockId, msg.sender, returnedYrUSDC, totalToForfit);
    }

    // -------------------------------------------------------------------------
    // Phase 3 stubs
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function enterAccessStrategyManager(uint256 lockId, address manager)
        external
        override
        nonReentrant
        returns (uint256 managerUnits)
    {
        LockInfo storage lock = _locks[lockId];

        if (lock.owner != msg.sender)                        revert NotOwner(lockId, msg.sender);
        if (lock.status != LockStatus.Active)                revert LockNotActive(lockId);
        if (lock.assetType != LockAssetType.YR_USDC)        revert MustExitHTFirst(lockId);
        if (lock.transition != LockTransition.None)         revert LockInTransition(lockId);

        // Eligibility gate (skipped when module not configured)
        if (eligibilityModule != address(0)) {
            (bool ok, bytes32 reason) = IEligibilityModuleV21(eligibilityModule)
                .canEnterManager(msg.sender, lockId, manager, lock.yrUSDCAmount);
            if (!ok) revert EligibilityCheckFailed(reason);
        }

        // Checkpoint before state transition (YR_USDC path for both bonus and rebate)
        _checkpointBonusPoints(lockId, lock);
        _checkpointRebate(lockId, lock);

        // Set transition guard to block re-entrancy on the same lockId
        lock.transition = LockTransition.EnteringManager;

        uint256 yrUSDCAmount = lock.yrUSDCAmount;

        // Transfer yrUSDC to Access Manager; manager redeems it for USDC internally
        yrUSDC.safeTransfer(manager, yrUSDCAmount);

        // Access Manager issues units
        managerUnits = IAccessStrategyManagerV21(manager).enter(lockId, yrUSDCAmount);

        // Update lock to MANAGER_UNITS state
        lock.yrUSDCAmount  = 0;
        lock.managerUnits  = managerUnits;
        lock.manager       = manager;
        lock.assetType     = LockAssetType.MANAGER_UNITS;
        lock.transition    = LockTransition.None;

        totalLockedYrUSDC -= yrUSDCAmount;

        emit LockEnteredManager(lockId, msg.sender, manager, yrUSDCAmount, managerUnits);
    }

    /// @inheritdoc ILockManagerV21
    function exitToLock(uint256 lockId)
        external
        override
        nonReentrant
        returns (uint256 returnedYrUSDC)
    {
        LockInfo storage lock = _locks[lockId];

        if (lock.owner != msg.sender)                            revert NotOwner(lockId, msg.sender);
        if (lock.status != LockStatus.Active)                    revert LockNotActive(lockId);
        if (lock.assetType != LockAssetType.MANAGER_UNITS)      revert NotInManagerState(lockId);
        if (lock.transition != LockTransition.None)             revert LockInTransition(lockId);

        // Checkpoint before transition (MANAGER_UNITS path — uses Access Manager fee rate)
        _checkpointBonusPoints(lockId, lock);
        _checkpointRebate(lockId, lock);

        address accessManager = lock.manager;

        // Set transition guard
        lock.transition = LockTransition.ExitingManager;

        // Access Manager divests, deposits to CoreVault, and transfers yrUSDC to this contract
        returnedYrUSDC = IAccessStrategyManagerV21(accessManager).exit(lockId);

        // Update principalAssetsUSDC to actual USDC equivalent of returned yrUSDC
        uint256 newPrincipal = IERC4626(coreVault).convertToAssets(returnedYrUSDC);

        // Restore lock to YR_USDC state
        lock.yrUSDCAmount        = returnedYrUSDC;
        lock.principalAssetsUSDC = newPrincipal;
        lock.managerUnits        = 0;
        lock.manager             = address(0);
        lock.assetType           = LockAssetType.YR_USDC;
        lock.transition          = LockTransition.None;
        // lastRebateCheckpoint was already advanced by _checkpointRebate above;
        // lastBonusPointsCheckpoint similarly advanced by _checkpointBonusPoints.

        totalLockedYrUSDC += returnedYrUSDC;

        emit LockExitedManager(lockId, msg.sender, accessManager, returnedYrUSDC, newPrincipal);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — public checkpoints
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function checkpointBonusPoints(uint256 lockId) external override {
        LockInfo storage lock = _locks[lockId];
        if (lock.status != LockStatus.Active) revert LockNotActive(lockId);
        _checkpointBonusPoints(lockId, lock);
    }

    /// @inheritdoc ILockManagerV21
    function checkpointRebate(uint256 lockId) external override {
        LockInfo storage lock = _locks[lockId];
        if (lock.status != LockStatus.Active) revert LockNotActive(lockId);
        _checkpointRebate(lockId, lock);
    }

    // -------------------------------------------------------------------------
    // RebateManager — rebate claim
    // -------------------------------------------------------------------------

    /// @notice Called exclusively by RebateManagerV21 to settle a rebate claim.
    ///         Auto-checkpoints bonus Points and rebate (no-op for Exited locks).
    ///         Zeroes lock.claimableRebateUSDC and returns the amount.
    ///
    ///         Eligible statuses: Active, Exited.
    ///         EarlyExited: not claimable (rebate forfeited at earlyExit).
    ///
    /// @param lockId Lock to claim for
    /// @return claimedUSDC USDC (6-dec) that was accumulated and is now cleared
    function claimRebateOf(uint256 lockId)
        external
        returns (uint256 claimedUSDC)
    {
        if (!hasRole(REBATE_MANAGER_ROLE, msg.sender)) revert Unauthorized();

        LockInfo storage lock = _locks[lockId];

        // Status gate: Active and Exited are eligible; EarlyExited and None are not
        if (lock.status == LockStatus.EarlyExited || lock.status == LockStatus.None)
            revert RebateNotClaimable(lockId);

        // Auto-checkpoint: internal functions return early when status != Active,
        // so this is a no-op for Exited locks (checkpoint was done at unlock time).
        _checkpointBonusPoints(lockId, lock);
        _checkpointRebate(lockId, lock);

        claimedUSDC = lock.claimableRebateUSDC;
        if (claimedUSDC == 0) revert NothingToClaim(lockId);

        lock.claimableRebateUSDC = 0;

        emit RebateClaimed(lockId, lock.owner, claimedUSDC);
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    function setEligibilityModule(address module) external onlyRole(DEFAULT_ADMIN_ROLE) {
        eligibilityModule = module;
        emit EligibilityModuleSet(module);
    }

    function setPointsLedger(address ledger) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pointsLedger = ledger;
        emit PointsLedgerSet(ledger);
    }

    /// @notice Update the Core SM annual fee bps used for rebate accrual.
    ///         Must stay in sync with CoreStrategyManagerV21.FEE_BPS.
    function setCoreSMFeeBpsPerYear(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > BPS_DENOMINATOR) revert FeeBpsTooHigh(bps);
        coreSMFeeBpsPerYear = bps;
        emit CoreSMFeeBpsPerYearSet(bps);
    }

    function setNewLocksPaused(bool paused) external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender))
            revert Unauthorized();
        newLocksPaused = paused;
        emit NewLocksPausedSet(paused);
    }

    // -------------------------------------------------------------------------
    // ILockManagerV21 — lock enumeration
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockManagerV21
    function getUserLockIds(address user, uint256 offset, uint256 limit)
        external
        view
        override
        returns (uint256[] memory lockIds, uint256 total)
    {
        uint256[] storage all = _userLocks[user];
        total = all.length;

        if (offset >= total || limit == 0) {
            return (new uint256[](0), total);
        }

        uint256 end   = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        lockIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            lockIds[i] = all[offset + i];
        }
    }

    // -------------------------------------------------------------------------
    // Internal — checkpoints
    // -------------------------------------------------------------------------

    /// @dev Compute and credit bonus Points accrued since last checkpoint.
    ///      Returns immediately for non-Active locks — no accrual after exit.
    ///      Splits computation across 30 / 90 / 180 day age tier boundaries.
    function _checkpointBonusPoints(uint256 lockId, LockInfo storage lock) internal {
        if (lock.status != LockStatus.Active) return;
        uint64 from = lock.lastBonusPointsCheckpoint;
        uint64 to   = uint64(block.timestamp);
        if (from >= to) return;

        uint256 delta = RewardsMathV21.computeSegmentBonusPoints(
            lock.principalAssetsUSDC,
            lock.startTime,
            from,
            to
        );

        lock.bonusPointsIssued            += delta;
        lock.lastBonusPointsCheckpoint     = to;

        if (delta > 0) {
            _creditPoints(lock.owner, delta);
            emit BonusPointsCheckpoint(lockId, lock.owner, delta);
        }
    }

    /// @dev Compute and accumulate rebate accrued since last checkpoint.
    ///      Returns immediately for non-Active locks — no accrual after exit.
    ///      YR_USDC state  → uses coreSMFeeBpsPerYear.
    ///      MANAGER_UNITS  → reads managementFeeBpsPerYear() from lock.manager.
    ///      Splits across 30 / 90 / 180 day age tier boundaries.
    ///      Trial segment (0–29 days) always yields 0 rebate.
    function _checkpointRebate(uint256 lockId, LockInfo storage lock) internal {
        if (lock.status != LockStatus.Active) return;
        uint64 from = lock.lastRebateCheckpoint;
        uint64 to   = uint64(block.timestamp);
        if (from >= to) return;

        uint256 feeBps;
        if (lock.assetType == LockAssetType.YR_USDC) {
            feeBps = coreSMFeeBpsPerYear;
        } else if (lock.assetType == LockAssetType.MANAGER_UNITS && lock.manager != address(0)) {
            feeBps = IAccessStrategyManagerV21(lock.manager).managementFeeBpsPerYear();
        } else {
            // Unknown state — advance checkpoint but accrue nothing
            lock.lastRebateCheckpoint = to;
            return;
        }

        uint256 delta = RewardsMathV21.computeSegmentRebate(
            lock.principalAssetsUSDC,
            lock.startTime,
            from,
            to,
            feeBps
        );

        lock.claimableRebateUSDC  += delta;
        lock.lastRebateCheckpoint  = to;

        if (delta > 0) emit RebateCheckpoint(lockId, lock.owner, delta);
    }

    // -------------------------------------------------------------------------
    // Internal — PointsLedger helper
    // -------------------------------------------------------------------------

    /// @dev Credit Points to the PointsLedger if configured. Silent no-op if not configured.
    function _creditPoints(address to, uint256 amount) internal {
        if (amount == 0 || pointsLedger == address(0)) return;
        IPointsLedgerV01(pointsLedger).creditLock(to, amount);
    }
}
