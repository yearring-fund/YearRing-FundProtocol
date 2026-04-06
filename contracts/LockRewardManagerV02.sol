// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILockRewardManagerV02.sol";
import "./interfaces/ILockLedgerV02.sol";
import "./interfaces/ILockBenefitV02.sol";

/// @title LockRewardManagerV02
/// @notice Coordinates lock creation, upfront reward token issuance, rebate claims, and early exit.
///
/// Two reward layers:
///   Layer 1 — Rebate (fbUSDC shares): accrues linearly over lock duration, claimable anytime.
///   Layer 2 — Reward tokens: issued upfront at lock time (full duration × tier multiplier).
///             Must be returned in full on earlyExit.
///
/// @dev Holds OPERATOR_ROLE on LockLedgerV02. Direct lock()/earlyExit() calls on LockLedger
///      are blocked for users; all entry points go through this contract.
contract LockRewardManagerV02 is ILockRewardManagerV02, AccessControl, Pausable, ReentrancyGuard {
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

    /// @dev 1 day × 500 USDC × 1× = 1 reward token (18-decimal).
    ///      lockedUSDCValue is in USDC (6 dec); reward token has 18 dec.
    ///      USDC_TO_TOKEN_SCALE = 10^(18-6) = 10^12 bridges the decimal gap.
    uint256 private constant REWARD_DENOMINATOR  = 10_000 * 500;
    uint256 private constant USDC_TO_TOKEN_SCALE = 1e12;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    ILockLedgerV02  public immutable ledger;
    ILockBenefitV02 public immutable benefit;

    /// @notice Reward token (RewardToken.sol)
    IERC20 public immutable rewardToken;

    /// @notice FundVaultV01 share token (fbUSDC)
    IERC20 public immutable vaultShares;

    /// @notice FundVaultV01 address — read mgmtFeeBpsPerMonth + convertToAssets
    address public immutable vault;

    /// @notice Treasury address — source for rebate shares and reward tokens
    address public immutable treasury;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Reward tokens issued at lock time per lockId
    mapping(uint256 => uint256) public override issuedRewardTokens;

    /// @notice Timestamp of last rebate settlement per lockId (initialized to lockedAt)
    mapping(uint256 => uint256) public override lastRebateClaimedAt;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error NotLockOwner(uint256 lockId);
    error LockNotActive(uint256 lockId);
    error LockAlreadyMature(uint256 lockId);
    error InsufficientRewardTokenAllowance(uint256 required, uint256 allowed);
    error InsufficientVaultSharesAllowance(uint256 required, uint256 allowed);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address ledger_,
        address benefit_,
        address rewardToken_,
        address vaultShares_,
        address vault_,
        address treasury_,
        address admin_,
        address emergency_
    ) {
        if (
            ledger_      == address(0) ||
            benefit_     == address(0) ||
            rewardToken_ == address(0) ||
            vaultShares_ == address(0) ||
            vault_       == address(0) ||
            treasury_    == address(0) ||
            admin_       == address(0) ||
            emergency_   == address(0)
        ) revert ZeroAddress();

        ledger      = ILockLedgerV02(ledger_);
        benefit     = ILockBenefitV02(benefit_);
        rewardToken = IERC20(rewardToken_);
        vaultShares = IERC20(vaultShares_);
        vault       = vault_;
        treasury    = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(EMERGENCY_ROLE, emergency_);
    }

    // -------------------------------------------------------------------------
    // ILockRewardManagerV02 — user operations
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockRewardManagerV02
    function lockWithReward(uint256 shares, uint64 duration)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 lockId)
    {
        // 1. Create lock via LockLedger (OPERATOR_ROLE required on ledger)
        //    Owner must have approved vault shares to LockLedger before calling this.
        uint256 vsAllowed = vaultShares.allowance(msg.sender, address(ledger));
        if (vsAllowed < shares)
            revert InsufficientVaultSharesAllowance(shares, vsAllowed);
        lockId = ledger.lockFor(msg.sender, shares, duration);

        // 2. Calculate reward tokens for the full lock duration
        uint256 lockedUSDCValue = _convertToAssets(shares);          // 6-decimal USDC
        uint256 durationDays    = uint256(duration) / SECONDS_PER_DAY;
        uint256 multiplierBps   = benefit.multiplierFromDuration(duration);
        // Scale USDC value to 18-decimal before dividing, so token amount is in 18-decimal units.
        uint256 tokens = lockedUSDCValue * USDC_TO_TOKEN_SCALE * durationDays * multiplierBps / REWARD_DENOMINATOR;

        // 3. Record issuance and initialize rebate timestamp
        issuedRewardTokens[lockId]   = tokens;
        lastRebateClaimedAt[lockId]  = block.timestamp;

        // 4. Transfer reward tokens from treasury to owner
        if (tokens > 0) {
            uint256 rwAllowed = rewardToken.allowance(treasury, address(this));
            if (rwAllowed < tokens)
                revert InsufficientRewardTokenAllowance(tokens, rwAllowed);
            rewardToken.safeTransferFrom(treasury, msg.sender, tokens);
        }

        emit LockedWithReward(lockId, msg.sender, shares, tokens);
    }

    /// @inheritdoc ILockRewardManagerV02
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

    /// @inheritdoc ILockRewardManagerV02
    function earlyExitWithReturn(uint256 lockId)
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

        // 1. Auto-settle final rebate
        _settleRebate(lockId, pos);

        // 2. Pull reward tokens from user back to treasury
        uint256 tokensToReturn = issuedRewardTokens[lockId];
        if (tokensToReturn > 0) {
            uint256 allowed = rewardToken.allowance(msg.sender, address(this));
            if (allowed < tokensToReturn)
                revert InsufficientRewardTokenAllowance(tokensToReturn, allowed);
            rewardToken.safeTransferFrom(msg.sender, treasury, tokensToReturn);
            issuedRewardTokens[lockId] = 0; // cleared: tokens fully returned, lock terminated
        }

        // 3. Release shares via LockLedger (OPERATOR_ROLE)
        ledger.earlyExitFor(lockId, msg.sender);

        emit EarlyExitExecuted(lockId, msg.sender, tokensToReturn);
    }

    // -------------------------------------------------------------------------
    // ILockRewardManagerV02 — views
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockRewardManagerV02
    function previewRebate(uint256 lockId) external view override returns (uint256) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked) return 0;
        return _calcRebate(lockId, pos);
    }

    /// @inheritdoc ILockRewardManagerV02
    function checkClaimRebate(uint256 lockId) external view override returns (
        uint256 rebateShares,
        uint256 treasuryBalance,
        uint256 treasuryAllowance
    ) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked || pos.earlyExited) return (0, 0, 0);

        rebateShares      = _calcRebate(lockId, pos);
        treasuryBalance   = vaultShares.balanceOf(treasury);
        treasuryAllowance = vaultShares.allowance(treasury, address(this));
    }

    /// @inheritdoc ILockRewardManagerV02
    function checkEarlyExit(uint256 lockId) external view override returns (
        uint256 rebateShares,
        uint256 tokensToReturn,
        uint256 treasuryShareBalance,
        uint256 treasuryShareAllowance,
        uint256 userTokenBalance,
        uint256 userTokenAllowance
    ) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0) || pos.unlocked || pos.earlyExited) return (0, 0, 0, 0, 0, 0);
        if (block.timestamp >= pos.unlockAt) return (0, 0, 0, 0, 0, 0); // already mature

        rebateShares           = _calcRebate(lockId, pos);
        tokensToReturn         = issuedRewardTokens[lockId];
        treasuryShareBalance   = vaultShares.balanceOf(treasury);
        treasuryShareAllowance = vaultShares.allowance(treasury, address(this));
        userTokenBalance       = rewardToken.balanceOf(pos.owner);
        userTokenAllowance     = rewardToken.allowance(pos.owner, address(this));
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

    function _settleRebate(
        uint256 lockId,
        ILockLedgerV02.LockPosition memory pos
    ) internal returns (uint256 rebateShares) {
        rebateShares = _calcRebate(lockId, pos);

        // Always advance timestamp (even if rebate is 0) to avoid double-counting
        uint256 effectiveNow = block.timestamp < pos.unlockAt
            ? block.timestamp
            : pos.unlockAt;
        lastRebateClaimedAt[lockId] = effectiveNow;

        if (rebateShares == 0) return 0;

        uint256 vsAllowed = vaultShares.allowance(treasury, address(this));
        if (vsAllowed < rebateShares)
            revert InsufficientVaultSharesAllowance(rebateShares, vsAllowed);
        vaultShares.safeTransferFrom(treasury, pos.owner, rebateShares);
        emit RebateClaimed(lockId, pos.owner, rebateShares);
    }

    function _calcRebate(
        uint256 lockId,
        ILockLedgerV02.LockPosition memory pos
    ) internal view returns (uint256) {
        uint256 lastClaimed  = lastRebateClaimedAt[lockId];
        uint256 effectiveNow = block.timestamp < pos.unlockAt
            ? block.timestamp
            : uint256(pos.unlockAt);
        if (effectiveNow <= lastClaimed) return 0;
        uint256 elapsed = effectiveNow - lastClaimed;

        uint256 discountBps = benefit.feeDiscountFromDuration(pos.unlockAt - pos.lockedAt);
        if (discountBps == 0) return 0;

        uint256 mgmtFeeBps = _mgmtFeeBpsPerMonth();
        if (mgmtFeeBps == 0) return 0;

        // rebate = shares × mgmtFeeBps × discountBps × elapsed / (BPS² × SECONDS_PER_MONTH)
        return pos.shares * mgmtFeeBps * discountBps * elapsed
               / (BPS_DENOMINATOR * BPS_DENOMINATOR * SECONDS_PER_MONTH);
    }

    /// @dev Read FundVaultV01.convertToAssets(shares) via staticcall
    function _convertToAssets(uint256 shares) internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("convertToAssets(uint256)", shares)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @dev Read FundVaultV01.mgmtFeeBpsPerMonth() via staticcall
    function _mgmtFeeBpsPerMonth() internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("mgmtFeeBpsPerMonth()")
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }
}
