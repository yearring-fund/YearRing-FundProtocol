// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title RewardsMathV21
/// @notice Pure-math library shared by LockManagerV21 and PortfolioLensV21.
///
/// Extracted here so that both contracts use identical reward calculations —
/// preventing logic drift between on-chain accrual and off-chain display.
///
/// Tier table (applies to both commitment duration and actual lock age)
/// --------------------------------------------------------------------
///   Age/duration      Tier    Bonus multiplier    Rebate share
///   < 30 days         Trial       0.50×  (5 000 bps)    0%
///   30–89 days        Bronze      1.00×  (10 000 bps)   20% (2 000 bps)
///   90–179 days       Silver      1.30×  (13 000 bps)   40% (4 000 bps)
///   ≥ 180 days        Gold        1.80×  (18 000 bps)   60% (6 000 bps)
library RewardsMathV21 {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant SECONDS_PER_YEAR = 365 days;
    uint256 internal constant BPS_DENOMINATOR  = 10_000;
    /// @notice Scale: principalAssetsUSDC (6-dec) × POINTS_SCALE → 18-dec Points
    uint256 internal constant POINTS_SCALE     = 1e12;

    // -------------------------------------------------------------------------
    // Tier helpers
    // -------------------------------------------------------------------------

    /// @notice Returns the commitment/age multiplier in bps.
    ///         Used for base Points (committedDuration) and bonus Points (age segment).
    function tierMultiplierBps(uint256 durationOrAge) internal pure returns (uint256) {
        if (durationOrAge >= 180 days) return 18_000;
        if (durationOrAge >=  90 days) return 13_000;
        if (durationOrAge >=  30 days) return 10_000;
        return 5_000; // Trial
    }

    /// @notice Human-readable tier name for display purposes.
    function tierName(uint256 age) internal pure returns (string memory) {
        if (age >= 180 days) return "Gold";
        if (age >=  90 days) return "Silver";
        if (age >=  30 days) return "Bronze";
        return "Trial";
    }

    // -------------------------------------------------------------------------
    // Bonus Points computation
    // -------------------------------------------------------------------------

    /// @notice Compute total bonus Points for time window [from, to],
    ///         split across 30 / 90 / 180-day tier boundaries relative to startTime.
    ///
    /// @param principalUSDC  Lock principal in USDC (6-dec)
    /// @param startTime      Lock creation timestamp
    /// @param from           Window start (inclusive), seconds
    /// @param to             Window end (exclusive), seconds
    /// @return points        18-decimal bonus Points accrued
    function computeSegmentBonusPoints(
        uint256 principalUSDC,
        uint64  startTime,
        uint64  from,
        uint64  to
    ) internal pure returns (uint256 points) {
        if (from >= to) return 0;

        uint64 t30  = startTime + uint64(30 days);
        uint64 t90  = startTime + uint64(90 days);
        uint64 t180 = startTime + uint64(180 days);

        points += _bonusInRange(principalUSDC, from, to, startTime, t30,               5_000);
        points += _bonusInRange(principalUSDC, from, to, t30,        t90,              10_000);
        points += _bonusInRange(principalUSDC, from, to, t90,        t180,             13_000);
        points += _bonusInRange(principalUSDC, from, to, t180,       type(uint64).max, 18_000);
    }

    /// @dev Bonus Points for the overlap of [from, to] with [tierStart, tierEnd].
    ///      Formula: principalUSDC × POINTS_SCALE × multiplierBps × elapsed / YEAR / BPS
    function _bonusInRange(
        uint256 principalUSDC,
        uint64  from,
        uint64  to,
        uint64  tierStart,
        uint64  tierEnd,
        uint256 multiplierBps
    ) private pure returns (uint256) {
        uint64 segStart = from > tierStart ? from : tierStart;
        uint64 segEnd   = to   < tierEnd   ? to   : tierEnd;
        if (segStart >= segEnd) return 0;
        uint256 elapsed = uint256(segEnd - segStart);
        // principalUSDC (6-dec) × 1e12 × multiplierBps × elapsed / YEAR / BPS → 18-dec
        return principalUSDC * POINTS_SCALE * multiplierBps * elapsed
            / SECONDS_PER_YEAR / BPS_DENOMINATOR;
    }

    // -------------------------------------------------------------------------
    // Rebate computation
    // -------------------------------------------------------------------------

    /// @notice Compute total USDC rebate for time window [from, to],
    ///         split across tier boundaries. Trial segment (0–29 days) = 0 rebate.
    ///
    ///   segmentFeeUSDC    = principalUSDC × feeBpsPerYear × elapsed / YEAR / BPS
    ///   segmentRebateUSDC = segmentFeeUSDC × tierRebateBps / BPS
    ///
    /// @param principalUSDC  Lock principal in USDC (6-dec)
    /// @param startTime      Lock creation timestamp
    /// @param from           Window start (inclusive), seconds
    /// @param to             Window end (exclusive), seconds
    /// @param feeBpsPerYear  Annual management fee in bps (e.g. 50 for CoreSM)
    /// @return rebate        USDC (6-dec) rebate accrued
    function computeSegmentRebate(
        uint256 principalUSDC,
        uint64  startTime,
        uint64  from,
        uint64  to,
        uint256 feeBpsPerYear
    ) internal pure returns (uint256 rebate) {
        if (from >= to) return 0;

        uint64 t30  = startTime + uint64(30 days);
        uint64 t90  = startTime + uint64(90 days);
        uint64 t180 = startTime + uint64(180 days);

        // Trial (startTime → t30): 0% rebate — intentionally skipped
        rebate += _rebateInRange(principalUSDC, from, to, t30,  t90,              feeBpsPerYear, 2_000);
        rebate += _rebateInRange(principalUSDC, from, to, t90,  t180,             feeBpsPerYear, 4_000);
        rebate += _rebateInRange(principalUSDC, from, to, t180, type(uint64).max, feeBpsPerYear, 6_000);
    }

    /// @dev USDC rebate for the overlap of [from, to] with [tierStart, tierEnd].
    function _rebateInRange(
        uint256 principalUSDC,
        uint64  from,
        uint64  to,
        uint64  tierStart,
        uint64  tierEnd,
        uint256 feeBpsPerYear,
        uint256 rebateBps
    ) private pure returns (uint256) {
        uint64 segStart = from > tierStart ? from : tierStart;
        uint64 segEnd   = to   < tierEnd   ? to   : tierEnd;
        if (segStart >= segEnd) return 0;
        uint256 elapsed = uint256(segEnd - segStart);
        uint256 feeUSDC = principalUSDC * feeBpsPerYear * elapsed
            / SECONDS_PER_YEAR / BPS_DENOMINATOR;
        return feeUSDC * rebateBps / BPS_DENOMINATOR;
    }
}
