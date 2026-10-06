// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILockPointsRebateManagerV02.sol";
import "./interfaces/ILockLedgerV02.sol";
import "./interfaces/ILockBenefitV02.sol";
import "./interfaces/ITreasuryV02.sol";
import "./interfaces/IPointsLedgerV01.sol";

/// @title LockPointsRebateManagerV02
/// @notice Closed beta lock manager: coordinates yrCORE lock creation, upfront Points
///         issuance, rebate claims, and early exit.
///
/// Two benefit layers:
///   Layer 1 — Rebate (yrCORE shares): accrues linearly over lock duration, claimable anytime.
///             Source: TreasuryV02 yrCORE allowance, subject to rebate budget cap.
///   Layer 2 — Points: issued upfront at lock time via PointsLedgerV01.creditLock().
///             Formula: lockedUSDCValue(6dec) × 1e12 × durationDays × multiplierBps / (10000 × 500)
///             Deducted via PointsLedgerV01.debit() on earlyExit (no user approve needed).
///
/// Points semantics (closed beta):
///   - Single balance per lock: issuedPoints[lockId]
///   - No active / finalized / reduced tiers
///   - Normal unlock: user keeps Points permanently
///   - Early exit: contract calls pointsLedger.debit(owner, issuedPoints[lockId]) directly
///   - forceExit: bypasses both rebate settlement and Points deduction (emergency only, documented)
///
/// @dev Holds OPERATOR_ROLE on LockLedgerV02.
///      Holds POINTS_MINTER_ROLE + POINTS_BURNER_ROLE on PointsLedgerV01.
///      Must be registered as REBATE_MANAGER_ROLE on TreasuryV02 (set via setRebateManager).
///      Must be registered as an approved module on TreasuryV02.
contract LockPointsRebateManagerV02 is ILockPointsRebateManagerV02, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 private constant BPS_DENOMINATOR   = 10_000;
    uint256 private constant SECONDS_PER_MONTH = 30 days;
    uint256 private constant SECONDS_PER_DAY   = 1 days;

    /// @dev 500 USDC × 1 day × 1.0× = 1 Point (18-decimal).
    ///      lockedUSDCValue is 6-decimal USDC; Points token has 18 decimals.
    ///      USDC_TO_POINTS_SCALE = 10^(18-6) = 10^12 bridges the decimal gap.
    uint256 private constant POINTS_DENOMINATOR    = 10_000 * 500; // = 5_000_000
    uint256 private constant USDC_TO_POINTS_SCALE  = 1e12;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    ILockLedgerV02  public immutable ledger;
    ILockBenefitV02 public immutable benefit;

    /// @notice PointsLedgerV01 — non-transferable on-chain Points store
    IPointsLedgerV01 public immutable pointsLedger;

    /// @notice YearRingCoreVaultV01 share token (yrCORE)
    IERC20 public immutable vaultShares;

    /// @notice YearRingCoreVaultV01 address — read mgmtFeeBpsPerMonth + convertToAssets
    address public immutable vault;

    /// @notice TreasuryV02 contract address — source of rebate shares and Points budget
    address public immutable treasury;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Points issued at lock time per lockId (single balance, no tiers)
    mapping(uint256 => uint256) public override issuedPoints;

    /// @notice Timestamp of last rebate settlement per lockId (initialized to lockedAt)
    mapping(uint256 => uint256) public override lastRebateClaimedAt;

    /// @notice Guardian pre-approval for forced exit (lockId → approved)
    mapping(uint256 => bool) public override forceExitApproved;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error NotLockOwner(uint256 lockId);
    error LockNotActive(uint256 lockId);
    error LockAlreadyMature(uint256 lockId);
    error InsufficientVaultSharesAllowance(uint256 required, uint256 allowed);
    error ForceExitNotApproved(uint256 lockId);
    error LockNotFound(uint256 lockId);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param ledger_       LockLedgerV02 (bound to yrCORE)
    /// @param benefit_      LockBenefitV02 (tier rules)
    /// @param pointsLedger_ PointsLedgerV01 address — this contract must hold POINTS_MINTER_ROLE + POINTS_BURNER_ROLE
    /// @param vaultShares_  YearRingCoreVaultV01 address (yrCORE ERC20)
    /// @param vault_        YearRingCoreVaultV01 address (for convertToAssets + mgmtFee reads)
    /// @param treasury_     TreasuryV02 contract address
    /// @param admin_        DEFAULT_ADMIN_ROLE holder
    /// @param emergency_    EMERGENCY_ROLE holder (guardian)
    constructor(
        address ledger_,
        address benefit_,
        address pointsLedger_,
        address vaultShares_,
        address vault_,
        address treasury_,
        address admin_,
        address emergency_
    ) {
        if (
            ledger_       == address(0) ||
            benefit_      == address(0) ||
            pointsLedger_ == address(0) ||
            vaultShares_  == address(0) ||
            vault_        == address(0) ||
            treasury_     == address(0) ||
            admin_        == address(0) ||
            emergency_    == address(0)
        ) revert ZeroAddress();

        ledger       = ILockLedgerV02(ledger_);
        benefit      = ILockBenefitV02(benefit_);
        pointsLedger = IPointsLedgerV01(pointsLedger_);
        vaultShares  = IERC20(vaultShares_);
        vault        = vault_;
        treasury     = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(EMERGENCY_ROLE, emergency_);
    }

    // -------------------------------------------------------------------------
    // User operations
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockPointsRebateManagerV02
    function lockWithPoints(uint256 shares, uint64 duration)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 lockId)
    {
        return _lockInternal(msg.sender, shares, duration);
    }

    /// @notice Lock yrCORE shares using an EIP-2612 permit signature.
    ///         Removes the need for a separate approve transaction.
    /// @dev permit is attempted via try/catch — continues if already consumed or allowance sufficient.
    ///      Permit spender must be address(ledger) (LockLedgerV02).
    function lockWithPermit(
        uint256 shares,
        uint64  duration,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    )
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lockId)
    {
        try IERC20Permit(address(vaultShares)).permit(
            msg.sender, address(ledger), shares, deadline, v, r, s
        ) {} catch {}

        return _lockInternal(msg.sender, shares, duration);
    }

    /// @dev Core lock logic shared by lockWithPoints and lockWithPermit.
    function _lockInternal(address owner, uint256 shares, uint64 duration)
        internal
        returns (uint256 lockId)
    {
        // 1. Validate allowance and create lock via LockLedger (OPERATOR_ROLE required)
        uint256 vsAllowed = vaultShares.allowance(owner, address(ledger));
        if (vsAllowed < shares)
            revert InsufficientVaultSharesAllowance(shares, vsAllowed);
        lockId = ledger.lockFor(owner, shares, duration);

        // 2. Calculate Points for the full lock duration
        //    Points = lockedUSDCValue(6dec) × 1e12 × durationDays × multiplierBps / (10000 × 500)
        uint256 lockedUSDCValue = _convertToAssets(shares);
        uint256 durationDays    = uint256(duration) / SECONDS_PER_DAY;
        uint256 multiplierBps   = benefit.multiplierFromDuration(duration);
        uint256 points = lockedUSDCValue * USDC_TO_POINTS_SCALE * durationDays * multiplierBps
                         / POINTS_DENOMINATOR;

        // 3. Record issuance and initialize rebate timestamp
        issuedPoints[lockId]        = points;
        lastRebateClaimedAt[lockId] = block.timestamp;

        // 4. Issue Points to owner via PointsLedgerV01 (no ERC20 approval needed)
        if (points > 0) {
            pointsLedger.creditLock(owner, points);
        }

        emit LockedWithPoints(lockId, owner, shares, points);
    }

    /// @inheritdoc ILockPointsRebateManagerV02
    function claimRebate(uint256 lockId)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 rebateShares)
    {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.earlyExited) revert LockNotActive(lockId);
        if (pos.owner != msg.sender) revert NotLockOwner(lockId);
        if (pos.unlocked) revert LockNotActive(lockId);

        rebateShares = _settleRebate(lockId, pos);
    }

    /// @inheritdoc ILockPointsRebateManagerV02
    /// @dev Early exit flow:
    ///      1. Auto-settle final rebate (yrCORE shares from TreasuryV02, subject to budget)
    ///      2. Return this lock's full Points to TreasuryV02 (user must have pre-approved)
    ///      3. issuedPoints[lockId] = 0
    ///      4. Release yrCORE shares back to owner via LockLedger
    function earlyExit(uint256 lockId)
        external
        override
        nonReentrant
        whenNotPaused
    {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.earlyExited) revert LockNotActive(lockId);
        if (pos.owner != msg.sender) revert NotLockOwner(lockId);
        if (pos.unlocked)            revert LockNotActive(lockId);
        if (block.timestamp >= pos.unlockAt) revert LockAlreadyMature(lockId);

        // Step 1: Auto-settle final rebate
        _settleRebate(lockId, pos);

        // Step 2: Deduct this lock's full Points from owner via PointsLedgerV01 (no approve needed)
        uint256 pointsToReturn = issuedPoints[lockId];
        if (pointsToReturn > 0) {
            pointsLedger.debit(msg.sender, pointsToReturn);

            // Step 3: Zero out — points fully deducted, lock terminating
            issuedPoints[lockId] = 0;
        }

        // Step 4: Release yrCORE shares to owner via LockLedger (OPERATOR_ROLE)
        ledger.earlyExitFor(lockId, msg.sender);

        emit EarlyExitExecuted(lockId, msg.sender, pointsToReturn);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockPointsRebateManagerV02
    function previewRebate(uint256 lockId) external view override returns (uint256) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked) return 0;
        return _calcRebate(lockId, pos);
    }

    /// @inheritdoc ILockPointsRebateManagerV02
    function checkClaimRebate(uint256 lockId) external view override returns (
        uint256 rebateShares,
        uint256 treasuryBalance,
        uint256 treasuryAllowance,
        uint256 remainingBudget
    ) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked || pos.earlyExited) return (0, 0, 0, 0);

        rebateShares    = _calcRebate(lockId, pos);
        treasuryBalance = vaultShares.balanceOf(treasury);
        treasuryAllowance = vaultShares.allowance(treasury, address(this));
        remainingBudget = _rebateBudgetRemaining();
    }

    /// @inheritdoc ILockPointsRebateManagerV02
    function checkEarlyExit(uint256 lockId) external view override returns (
        uint256 rebateShares,
        uint256 pointsToReturn,
        uint256 treasuryShareBalance,
        uint256 treasuryShareAllowance,
        uint256 userPointsBalance
    ) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked || pos.earlyExited) return (0, 0, 0, 0, 0);
        if (block.timestamp >= pos.unlockAt) return (0, 0, 0, 0, 0);

        rebateShares           = _calcRebate(lockId, pos);
        pointsToReturn         = issuedPoints[lockId];
        treasuryShareBalance   = vaultShares.balanceOf(treasury);
        treasuryShareAllowance = vaultShares.allowance(treasury, address(this));
        userPointsBalance      = pointsLedger.balanceOf(pos.owner);
    }

    // -------------------------------------------------------------------------
    // Forced exit — two-key authorisation (guardian + admin)
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockPointsRebateManagerV02
    function approveForceExit(uint256 lockId)
        external
        override
        onlyRole(EMERGENCY_ROLE)
    {
        forceExitApproved[lockId] = true;
        emit ForceExitApproved(lockId, msg.sender);
    }

    /// @inheritdoc ILockPointsRebateManagerV02
    /// @dev FORCE EXIT POLICY (documented omission):
    ///      forceExit bypasses both rebate settlement and Points deduction.
    ///      - Rebate: NOT settled. Any pending rebate is forfeited.
    ///      - Points: NOT deducted. issuedPoints[lockId] remains as-is; owner keeps their Points.
    ///        TreasuryV02 absorbs the Points balance as a loss.
    ///      This design is intentional: forceExit is an emergency path where the normal
    ///      user approval flow (approve Points → return) cannot be relied upon.
    ///      The reason string is recorded on-chain for post-hoc auditability.
    function executeForceExit(uint256 lockId, string calldata reason)
        external
        override
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (!forceExitApproved[lockId]) revert ForceExitNotApproved(lockId);
        forceExitApproved[lockId] = false; // consume approval (one-shot)

        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0)) revert LockNotFound(lockId);

        // Release shares to owner via LockLedger OPERATOR path
        ledger.earlyExitFor(lockId, pos.owner);

        emit ForceExitExecuted(lockId, pos.owner, msg.sender, reason);
    }

    // -------------------------------------------------------------------------
    // Pause controls
    // -------------------------------------------------------------------------

    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Settle rebate for a lock position:
    ///      1. Calculate rebateShares
    ///      2. Advance lastRebateClaimedAt (prevents double-counting)
    ///      3. Call TreasuryV02.recordRebateSpent — enforces budget cap; reverts if exceeded
    ///      4. Transfer yrCORE shares from TreasuryV02 to owner via ERC20 allowance
    function _settleRebate(
        uint256 lockId,
        ILockLedgerV02.LockPosition memory pos
    ) internal returns (uint256 rebateShares) {
        rebateShares = _calcRebate(lockId, pos);

        // Always advance timestamp to prevent double-counting even when rebate is 0
        uint256 effectiveNow = block.timestamp < pos.unlockAt
            ? block.timestamp
            : pos.unlockAt;
        lastRebateClaimedAt[lockId] = effectiveNow;

        if (rebateShares == 0) return 0;

        // Budget check + debit via TreasuryV02 (reverts on exceeded budget)
        ITreasuryV02(treasury).recordRebateSpent(address(vaultShares), pos.owner, rebateShares);

        // Transfer yrCORE shares from TreasuryV02 to owner
        // Requires prior TreasuryV02.approveSpender(yrCORE, address(this), amount)
        uint256 vsAllowed = vaultShares.allowance(treasury, address(this));
        if (vsAllowed < rebateShares)
            revert InsufficientVaultSharesAllowance(rebateShares, vsAllowed);
        vaultShares.safeTransferFrom(treasury, pos.owner, rebateShares);

        emit RebateClaimed(lockId, pos.owner, rebateShares);
    }

    /// @dev Rebate formula:
    ///      rebate = shares × mgmtFeeBps × discountBps × elapsed / (BPS² × SECONDS_PER_MONTH)
    function _calcRebate(
        uint256 lockId,
        ILockLedgerV02.LockPosition memory pos
    ) internal view returns (uint256) {
        uint256 lastClaimed = lastRebateClaimedAt[lockId] != 0
            ? lastRebateClaimedAt[lockId]
            : uint256(pos.lockedAt);
        uint256 effectiveNow = block.timestamp < pos.unlockAt
            ? block.timestamp
            : uint256(pos.unlockAt);
        if (effectiveNow <= lastClaimed) return 0;
        uint256 elapsed = effectiveNow - lastClaimed;

        uint256 discountBps = benefit.feeDiscountFromDuration(pos.unlockAt - pos.lockedAt);
        if (discountBps == 0) return 0;

        uint256 mgmtFeeBps = _mgmtFeeBpsPerMonth();
        if (mgmtFeeBps == 0) return 0;

        return pos.shares * mgmtFeeBps * discountBps * elapsed
               / (BPS_DENOMINATOR * BPS_DENOMINATOR * SECONDS_PER_MONTH);
    }

    /// @dev Read YearRingCoreVaultV01.convertToAssets(shares) via staticcall (6-decimal USDC)
    function _convertToAssets(uint256 shares) internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("convertToAssets(uint256)", shares)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @dev Read YearRingCoreVaultV01.mgmtFeeBpsPerMonth() via staticcall
    function _mgmtFeeBpsPerMonth() internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("mgmtFeeBpsPerMonth()")
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @dev Query TreasuryV02 remaining rebate budget for yrCORE shares (view, no revert)
    function _rebateBudgetRemaining() internal view returns (uint256) {
        (bool ok, bytes memory data) = treasury.staticcall(
            abi.encodeWithSignature("rebateBudgetRemaining(address)", address(vaultShares))
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }
}
