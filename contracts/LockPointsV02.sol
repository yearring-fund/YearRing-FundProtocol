// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ILockPointsV02.sol";
import "./interfaces/ILockLedgerV02.sol";
import "./interfaces/ILockBenefitV02.sol";

/// @title LockPointsV02
/// @notice Pure view contract: computes loyalty points from lock positions.
///         No state written. No assets held. No transfers.
///
/// Formula (mirrors RewardToken formula):
///   points = lockedUSDCValue × elapsed_days × multiplierBps / (10000 × 50)
///
/// - lockedUSDCValue : vault.convertToAssets(lockedShares) at query time
/// - elapsed_days    : capped at unlockAt for unlocked positions
/// - multiplierBps   : LockBenefitV02.multiplierOf(lockId)
///
/// @dev Not exposed in V2 frontend. Reserved for V3+ governance / boost narratives.
contract LockPointsV02 is ILockPointsV02 {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev Matches RewardToken formula denominator: 10000 bps × 50 USDC/day/token
    uint256 private constant POINTS_DENOMINATOR = 10_000 * 50;

    uint256 private constant SECONDS_PER_DAY = 1 days;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    ILockLedgerV02  public immutable ledger;
    ILockBenefitV02 public immutable benefit;

    /// @notice FundVaultV01 — used for convertToAssets()
    address         public immutable vault;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address ledger_, address benefit_, address vault_) {
        require(ledger_  != address(0), "ZeroAddress: ledger");
        require(benefit_ != address(0), "ZeroAddress: benefit");
        require(vault_   != address(0), "ZeroAddress: vault");

        ledger  = ILockLedgerV02(ledger_);
        benefit = ILockBenefitV02(benefit_);
        vault   = vault_;
    }

    // -------------------------------------------------------------------------
    // ILockPointsV02
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockPointsV02
    function pointsOf(uint256 lockId) public view override returns (uint256) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
        if (pos.owner == address(0)) return 0;
        if (pos.earlyExited) return 0;  // points forfeited on early exit

        // For unlocked positions multiplierOf returns 0 (Tier.None); fall back to duration
        uint256 multiplierBps = benefit.multiplierOf(lockId);
        if (multiplierBps == 0) {
            multiplierBps = benefit.multiplierFromDuration(pos.unlockAt - pos.lockedAt);
        }
        if (multiplierBps == 0) return 0;

        // elapsed: capped at unlockAt so points freeze after unlock
        uint64 now_     = uint64(block.timestamp);
        uint64 elapsed  = pos.unlocked
            ? pos.unlockAt - pos.lockedAt
            : now_ - pos.lockedAt;

        uint256 elapsedDays = elapsed / SECONDS_PER_DAY;
        if (elapsedDays == 0) return 0;

        // lockedUSDCValue: real-time conversion via ERC4626
        uint256 lockedUSDCValue = _convertToAssets(pos.shares);

        // points = lockedUSDCValue × elapsed_days × multiplierBps / (10000 × 50)
        return lockedUSDCValue * elapsedDays * multiplierBps / POINTS_DENOMINATOR;
    }

    /// @inheritdoc ILockPointsV02
    function totalPointsOf(address owner) external view override returns (uint256 total) {
        if (owner == address(0)) return 0;
        uint256[] memory ids = ledger.userLockIds(owner);
        for (uint256 i = 0; i < ids.length; i++) {
            total += pointsOf(ids[i]);
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Calls FundVaultV01.convertToAssets(shares) via low-level call
    ///      to avoid importing the full vault interface.
    ///      Intentionally returns 0 on failure: LockPointsV02 is a pure view
    ///      auxiliary layer (V2 not exposed in frontend). A vault failure causes
    ///      pointsOf() to return 0 rather than revert — no assets are affected.
    ///      If points are used for governance weight in V3+, upgrade to a typed
    ///      interface call so failures revert explicitly.
    function _convertToAssets(uint256 shares) internal view returns (uint256) {
        (bool ok, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("convertToAssets(uint256)", shares)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }
}
