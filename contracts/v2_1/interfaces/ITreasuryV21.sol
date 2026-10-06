// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title ITreasuryV21
/// @notice Protocol treasury for YearRing V2.1.
///         Holds yrUSDC accumulated from management fees and pays out rebates.
///
/// Fee collection flow
/// -------------------
/// CoreSM / AccessManagers accrue fee units to this Treasury (as feeReceiver).
/// Admin or keeper calls settleCoreSMFees() / settleAccessManagerFees() to:
///   1. Redeem fee units from the manager → receive USDC.
///   2. Deposit USDC into CoreVault → receive yrUSDC.
///   3. yrUSDC is held here as rebate reserve.
///
/// Alternatively, RebateManager calls ensureLiquidity() which auto-settles all
/// registered managers in one step before a rebate payout.
///
/// Deployment note
/// ---------------
/// Admin must add this contract to CoreVault's allowlist via
/// CoreVault.setAllowlist(address(treasury), true) before any fee-settling deposit
/// can succeed when CoreVault.allowlistEnabled == true.
interface ITreasuryV21 {

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 — used for USDC→yrUSDC conversion and yrUSDC custody
    function coreVault() external view returns (address);

    /// @notice Minimum USDC value a manager must hold in fee units before settleManagers() redeems it.
    function minSettlementValueUSDC() external view returns (uint256);

    /// @notice CoreStrategyManagerV21 address (may be address(0) before configuration)
    function coreStrategyManager() external view returns (address);

    /// @notice RebateManagerV21 — the only address authorised to call withdrawRebate
    function rebateManager() external view returns (address);

    /// @notice yrUSDC balance held by this Treasury (rebate reserve)
    function yrUSDCBalance() external view returns (uint256);

    /// @notice Number of registered Access Managers
    function accessManagerCount() external view returns (uint256);

    /// @notice Access Manager address at the given index
    function accessManagerAt(uint256 index) external view returns (address);

    // -------------------------------------------------------------------------
    // Fee settlement — admin / keeper callable
    // -------------------------------------------------------------------------

    /// @notice Redeem `units` of CoreSM fee units for USDC, then deposit to CoreVault.
    ///         Emits CoreSMFeesSettled.
    function settleCoreSMFees(uint256 units) external returns (uint256 yrUSDCReceived);

    /// @notice Redeem `units` of AccessManager fee units for USDC, then deposit to CoreVault.
    ///         `accessManager` must be a registered Access Manager.
    ///         Emits AccessManagerFeesSettled.
    function settleAccessManagerFees(address accessManager, uint256 units) external returns (uint256 yrUSDCReceived);

    // -------------------------------------------------------------------------
    // Auto-liquidity — called by RebateManager or admin / keeper
    // -------------------------------------------------------------------------

    /// @notice Best-effort attempt to top up yrUSDC reserve to cover `yrUSDCNeeded`.
    ///         Iterates registered managers, redeems all available fee units, and
    ///         converts resulting USDC to yrUSDC via CoreVault.
    ///         Does NOT revert if already sufficient — returns immediately.
    ///         If settlement fails (e.g., strategy illiquid), the call reverts and
    ///         the caller (RebateManager.claimRebate) propagates the error.
    function ensureLiquidity(uint256 yrUSDCNeeded) external;

    // -------------------------------------------------------------------------
    // Rebate payout — RebateManager only
    // -------------------------------------------------------------------------

    /// @notice Transfer `yrUSDCAmount` yrUSDC to `recipient`.
    ///         Reverts InsufficientYrUSDC if balance is insufficient.
    ///         Only RebateManagerV21 may call this.
    function withdrawRebate(address recipient, uint256 yrUSDCAmount) external;

    // -------------------------------------------------------------------------
    // Admin — manual top-up
    // -------------------------------------------------------------------------

    /// @notice Admin or keeper manually deposits yrUSDC into the Treasury.
    ///         Caller must have pre-approved this contract to spend yrUSDC.
    function depositYrUSDC(uint256 amount) external;

    // -------------------------------------------------------------------------
    // Batch settlement — admin / keeper
    // -------------------------------------------------------------------------

    /// @notice Settle fee units for each manager in the provided list.
    ///         CoreSM may be included as address(0) or its actual address.
    ///         Managers below `minSettlementValueUSDC` are skipped without reverting.
    function settleManagers(address[] calldata managers) external;

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    function setRebateManager(address rebateManager_) external;
    function setCoreStrategyManager(address csm) external;
    function addAccessManager(address accessManager) external;
    function removeAccessManager(address accessManager) external;

    /// @notice Set the minimum USDC value threshold for settleManagers() batch redemptions.
    function setMinSettlementValueUSDC(uint256 value) external;
}
