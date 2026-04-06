// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ILockBenefitV02.sol";
import "./interfaces/ILockLedgerV02.sol";

/// @title LockBenefitV02
/// @notice Pure view contract: derives lock tier and reward multiplier from LockLedgerV02.
///         No state written. No assets held. LockLedgerV02 is never modified.
///
/// Tier ranges (derived from lock duration = unlockAt - lockedAt):
///   Bronze : [30 days, 90 days)   — 1.0× (10000 bps)
///   Silver : [90 days, 180 days)  — 1.3× (13000 bps)
///   Gold   : [180 days, 365 days] — 1.8× (18000 bps)
contract LockBenefitV02 is ILockBenefitV02 {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant BRONZE_MULTIPLIER_BPS = 10_000;
    uint256 public constant SILVER_MULTIPLIER_BPS = 13_000;
    uint256 public constant GOLD_MULTIPLIER_BPS   = 18_000;

    uint256 public constant BRONZE_DISCOUNT_BPS   =  2_000;  // 20%
    uint256 public constant SILVER_DISCOUNT_BPS   =  4_000;  // 40%
    uint256 public constant GOLD_DISCOUNT_BPS     =  6_000;  // 60%

    uint64 private constant BRONZE_MIN =  30 days;
    uint64 private constant SILVER_MIN =  90 days;
    uint64 private constant GOLD_MIN   = 180 days;
    uint64 private constant GOLD_MAX   = 365 days;

    // -------------------------------------------------------------------------
    // Immutable
    // -------------------------------------------------------------------------

    /// @notice LockLedgerV02 contract address
    ILockLedgerV02 public immutable ledger;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address ledger_) {
        require(ledger_ != address(0), "ZeroAddress");
        ledger = ILockLedgerV02(ledger_);
    }

    // -------------------------------------------------------------------------
    // ILockBenefitV02
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockBenefitV02
    function tierOf(uint256 lockId) public view override returns (Tier) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);

        // Position not created (owner == address(0)) or already unlocked
        if (pos.owner == address(0) || pos.unlocked) return Tier.None;

        uint64 duration = pos.unlockAt - pos.lockedAt;
        return tierFromDuration(duration);
    }

    /// @inheritdoc ILockBenefitV02
    function multiplierOf(uint256 lockId) external view override returns (uint256) {
        return multiplierForTier(tierOf(lockId));
    }

    /// @inheritdoc ILockBenefitV02
    function multiplierForTier(Tier tier) public pure override returns (uint256) {
        if (tier == Tier.Bronze) return BRONZE_MULTIPLIER_BPS;
        if (tier == Tier.Silver) return SILVER_MULTIPLIER_BPS;
        if (tier == Tier.Gold)   return GOLD_MULTIPLIER_BPS;
        return 0; // Tier.None
    }

    /// @inheritdoc ILockBenefitV02
    function tierFromDuration(uint64 duration) public pure override returns (Tier) {
        if (duration >= GOLD_MIN && duration <= GOLD_MAX) return Tier.Gold;
        if (duration >= SILVER_MIN)                       return Tier.Silver;
        if (duration >= BRONZE_MIN)                       return Tier.Bronze;
        return Tier.None;
    }

    /// @inheritdoc ILockBenefitV02
    function multiplierFromDuration(uint64 duration) external pure override returns (uint256) {
        return multiplierForTier(tierFromDuration(duration));
    }

    /// @inheritdoc ILockBenefitV02
    function feeDiscountBpsOf(uint256 lockId) external view override returns (uint256) {
        return feeDiscountForTier(tierOf(lockId));
    }

    /// @inheritdoc ILockBenefitV02
    function feeDiscountForTier(Tier tier) public pure override returns (uint256) {
        if (tier == Tier.Bronze) return BRONZE_DISCOUNT_BPS;
        if (tier == Tier.Silver) return SILVER_DISCOUNT_BPS;
        if (tier == Tier.Gold)   return GOLD_DISCOUNT_BPS;
        return 0;
    }

    /// @inheritdoc ILockBenefitV02
    function feeDiscountFromDuration(uint64 duration) external pure override returns (uint256) {
        return feeDiscountForTier(tierFromDuration(duration));
    }
}
