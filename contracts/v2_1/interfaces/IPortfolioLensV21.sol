// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "./ILockManagerV21.sol";

/// @title IPortfolioLensV21
/// @notice Read-only view aggregator for the YearRing V2.1 protocol.
///
/// All functions are pure reads — no state is modified.
/// Pending values (bonus Points, rebate) are computed using the same
/// RewardsMathV21 library used by LockManagerV21, so numbers match
/// exactly what would be credited upon the next checkpoint.
interface IPortfolioLensV21 {

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Full view of a single lock including pending (uncheckpointed) rewards.
    struct LockView {
        uint256 lockId;

        /// @notice On-chain lock state (direct from LockManagerV21)
        ILockManagerV21.LockInfo info;

        /// @notice Bonus Points accrued since the last checkpoint, not yet credited
        uint256 pendingBonusPoints;

        /// @notice Rebate (USDC 6-dec) accrued since the last checkpoint, not yet accumulated
        uint256 pendingRebateUSDC;

        /// @notice Current tier name: "Trial" / "Bronze" / "Silver" / "Gold"
        string tierName;

        /// @notice True when block.timestamp >= info.minUnlockTime
        bool isMatured;
    }

    /// @notice Paginated portfolio summary for a user.
    struct UserPortfolio {
        /// @notice Requested page of LockViews (length = min(limit, total - offset))
        LockView[] locks;

        /// @notice Total number of locks ever created by this user (across all pages)
        uint256 total;

        /// @notice User's current PointsLedger balance (0 when ledger not configured)
        uint256 totalPointsBalance;
    }

    /// @notice Snapshot of the core vault.
    struct VaultInfo {
        address vault;

        /// @notice Total USDC managed (idle + strategy-deployed), 6-dec
        uint256 totalAssets;

        /// @notice Total yrUSDC shares outstanding, 18-dec
        uint256 totalSupply;

        /// @notice Price per share in ray (1e27): convertToAssets(1e18) × 1e27 / 1e18
        uint256 pricePerShareRay;

        /// @notice Current vault operating mode: 0=Normal, 1=Paused, 2=EmergencyExit
        uint8 systemMode;

        /// @notice When true, deposits are gated by per-address allowlist
        bool allowlistEnabled;

        /// @notice Idle USDC in vault as a fraction of totalAssets (bps, 10 000 = 100%)
        uint256 reserveRatioBps;
    }

    /// @notice Snapshot of an Access Strategy Manager.
    struct ManagerInfo {
        address manager;

        /// @notice Total USDC value managed: idle held + strategy-deployed, 6-dec
        uint256 totalManagedAssets;

        /// @notice Total outstanding units (all lockIds + fee receiver), 18-dec
        uint256 totalUnits;

        /// @notice Unit price in ray: totalManagedAssets × 1e27 / totalUnits
        uint256 unitPriceRay;

        /// @notice Annual management fee in bps (e.g. 100 = 1.00%)
        uint256 managementFeeBpsPerYear;

        /// @notice Active yield strategy address (address(0) if unset)
        address strategy;

        /// @notice Fee receiver address
        address feeReceiver;

        /// @notice Undistributed fee units attributed to feeReceiver, 18-dec
        uint256 feeReceiverUnits;
    }

    /// @notice Per-manager fee balance held by the Treasury.
    struct TreasuryManagerFeeInfo {
        address manager;

        /// @notice Fee units attributed to Treasury (feeReceiver), 18-dec
        uint256 feeReceiverUnits;

        /// @notice USDC value of those units: totalManagedAssets × feeReceiverUnits / totalUnits
        uint256 usdcValue;
    }

    /// @notice Treasury reserve snapshot.
    struct TreasuryInfo {
        address treasury;

        /// @notice yrUSDC balance held by Treasury (rebate reserve), 18-dec
        uint256 yrUSDCBalance;

        /// @notice USDC value of yrUSDCBalance: convertToAssets(yrUSDCBalance), 6-dec
        uint256 yrUSDCValueUSDC;

        /// @notice Per-manager undistributed fee info (caller-supplied manager list)
        TreasuryManagerFeeInfo[] managerFees;
    }

    // -------------------------------------------------------------------------
    // Lock views
    // -------------------------------------------------------------------------

    /// @notice Full view of a single lock including pending rewards.
    /// @param lockId  Lock identifier (must exist)
    function getLockView(uint256 lockId) external view returns (LockView memory);

    /// @notice Paginated portfolio for a user.
    ///
    /// Iterates the on-chain lock enumeration stored in LockManagerV21.
    /// Pagination is zero-indexed: first page is offset=0, limit=N.
    ///
    /// @param user    User address
    /// @param offset  Index of the first lock to include (0-indexed within user's lock list)
    /// @param limit   Maximum number of LockViews to return (pass 0 for empty result)
    /// @return portfolio  Paginated lock views + total count + points balance
    function getUserPortfolio(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (UserPortfolio memory portfolio);

    // -------------------------------------------------------------------------
    // Vault info
    // -------------------------------------------------------------------------

    /// @notice Current snapshot of the core vault.
    function getVaultInfo() external view returns (VaultInfo memory);

    // -------------------------------------------------------------------------
    // Eligibility check
    // -------------------------------------------------------------------------

    /// @notice Check whether the lock owner may enter `manager` using all of their yrUSDC.
    ///
    /// Delegates to EligibilityModuleV21.canEnterManager with the lock's full yrUSDCAmount.
    /// Returns (false, "MODULE_NOT_SET") if EligibilityModule is not configured.
    ///
    /// @param lockId   Lock to check
    /// @param manager  Target Access Strategy Manager
    /// @return canEnter  True if all eligibility checks pass
    /// @return reason    Zero bytes32 when ok; human-readable reason code when not ok
    function checkEligibility(uint256 lockId, address manager)
        external view returns (bool canEnter, bytes32 reason);

    // -------------------------------------------------------------------------
    // Manager info
    // -------------------------------------------------------------------------

    /// @notice Snapshot of a single Access Strategy Manager.
    /// @param manager  IAccessStrategyManagerV21-compatible address
    function getManagerInfo(address manager) external view returns (ManagerInfo memory);

    // -------------------------------------------------------------------------
    // Treasury info
    // -------------------------------------------------------------------------

    /// @notice Treasury reserve snapshot with per-manager fee information.
    ///
    /// The caller supplies the list of Access Manager addresses to inspect —
    /// this allows the Lens to remain stateless regarding which managers are active.
    /// Pass an empty array to get only the yrUSDC balance.
    ///
    /// @param managers  List of IAccessStrategyManagerV21 addresses to include
    function getTreasuryInfo(address[] calldata managers)
        external view returns (TreasuryInfo memory);
}
