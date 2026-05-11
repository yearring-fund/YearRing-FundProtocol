// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title IEligibilityModuleV21
/// @notice Read-only eligibility check for High-Tier Manager entry.
///
/// Each HT Manager has independently configurable thresholds.
/// Closed-beta defaults: pointsThreshold=0, yrfpThreshold=0, allowlistRequired=false.
interface IEligibilityModuleV21 {

    // -------------------------------------------------------------------------
    // View — per-manager configuration
    // -------------------------------------------------------------------------

    /// @notice Whether the manager is enabled for new entries
    function isManagerEnabled(address manager) external view returns (bool);

    /// @notice Minimum Points (18 dec) required to enter the manager (0 = no requirement)
    function requiredPoints(address manager) external view returns (uint256);

    /// @notice Minimum YRFP token balance required (0 = no requirement)
    function requiredYRFP(address manager) external view returns (uint256);

    /// @notice Whether per-manager allowlist is active
    function allowlistRequired(address manager) external view returns (bool);

    /// @notice Whether a specific user is on the per-manager allowlist
    function isAllowlisted(address user, address manager) external view returns (bool);

    // -------------------------------------------------------------------------
    // Primary check
    // -------------------------------------------------------------------------

    /// @notice Check whether `user` may enter `manager` using lockId `lockId`
    ///         with `yrUSDCAmount` of their lock.
    ///
    /// Checks in order:
    ///   1. Lock exists and owner == user
    ///   2. Lock status == Active, assetType == YR_USDC, transition == None
    ///   3. Actual lock age >= 30 days (Trial locks not eligible)
    ///   4. yrUSDCAmount > 0 and <= lock.yrUSDCAmount
    ///   5. Manager enabled
    ///   6. Points balance >= requiredPoints (when threshold > 0)
    ///   7. YRFP balance >= requiredYRFP (when threshold > 0 and yrfpToken configured)
    ///   8. Allowlisted (when allowlistRequired)
    ///
    /// @return ok      True if all checks pass
    /// @return reason  Zero bytes32 when ok; human-readable reason code when not ok
    function canEnterManager(
        address user,
        uint256 lockId,
        address manager,
        uint256 yrUSDCAmount
    ) external view returns (bool ok, bytes32 reason);
}
