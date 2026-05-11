// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title ICoreStrategyManagerV21
/// @notice Interface for the Phase-1 core strategy manager used by YearRingCoreVaultV21.
///
/// Units model
/// -----------
/// All depositors receive internal "units" (18-decimal) proportional to their contribution.
/// Fee accrual mints new units to feeReceiver, diluting existing holders — no USDC is
/// deducted. This allows multiple depositor types (vault, lock manager, …) to co-exist
/// with correct proportional accounting.
///
/// Fee rate (Phase 1): 50 bps/year continuous dilution, charged to CoreStrategyManagerV21.
interface ICoreStrategyManagerV21 {
    // -------------------------------------------------------------------------
    // View — configuration
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 — the only address that may call vault-only functions
    function vault() external view returns (address);

    /// @notice Active yield strategy (may be address(0) if not yet configured)
    function strategy() external view returns (address);

    /// @notice Address that receives fee-dilution units on every accrueFee()
    function feeReceiver() external view returns (address);

    /// @notice Underlying ERC-20 asset (USDC)
    function underlying() external view returns (address);

    // -------------------------------------------------------------------------
    // View — accounting
    // -------------------------------------------------------------------------

    /// @notice Sum of idle underlying held by this contract plus all strategy-deployed assets
    function totalManagedAssets() external view returns (uint256);

    /// @notice Total outstanding units across all unitholders (including feeReceiver)
    function totalUnits() external view returns (uint256);

    /// @notice Units owned by `account`
    function unitsOf(address account) external view returns (uint256);

    /// @notice Current unit price expressed in ray precision (1e27).
    ///         unitPriceRay = totalManagedAssets * 1e27 / totalUnits
    function unitPriceRay() external view returns (uint256);

    /// @notice Underlying value attributable to the vault, computed from its unit share.
    ///         vaultManagedAssets = totalManagedAssets * unitsOf(vault) / totalUnits
    function vaultManagedAssets() external view returns (uint256);

    // -------------------------------------------------------------------------
    // Vault-only — capital movements
    // -------------------------------------------------------------------------

    /// @notice Vault calls this after transferring `assets` underlying to this contract.
    ///         Accrues outstanding fee first, then mints units to vault proportionally.
    /// @param assets Amount of underlying already received
    function depositFromVault(uint256 assets) external;

    /// @notice Vault calls this to withdraw `assets` underlying.
    ///         Burns vault's units proportionally and transfers underlying back to vault,
    ///         pulling from strategy if this contract's idle balance is insufficient.
    ///         Reverts if total managed assets cannot cover `assets`.
    /// @param assets Amount of underlying requested
    /// @return withdrawn Actual amount transferred (equals `assets` or reverts)
    function withdrawToVault(uint256 assets) external returns (uint256 withdrawn);

    // -------------------------------------------------------------------------
    // Keeper / Admin — strategy operations
    // -------------------------------------------------------------------------

    /// @notice Push `amount` of idle underlying held by this contract into the active strategy.
    ///         Callable by DEFAULT_ADMIN_ROLE or KEEPER_ROLE.
    function invest(uint256 amount) external;

    /// @notice Pull `amount` from strategy back to idle in this contract.
    ///         Callable by DEFAULT_ADMIN_ROLE only.
    function divestFromStrategy(uint256 amount) external;

    /// @notice Withdraw entire strategy position to idle in this contract.
    ///         Callable by DEFAULT_ADMIN_ROLE only.
    function emergencyExitStrategy() external;

    /// @notice Mint fee-dilution units to feeReceiver based on elapsed time since last accrual.
    ///         Callable by DEFAULT_ADMIN_ROLE or KEEPER_ROLE.
    function accrueFee() external;

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    /// @notice Set or replace the active yield strategy.
    function setStrategy(address strategy_) external;

    /// @notice Set or replace the fee receiver address.
    function setFeeReceiver(address feeReceiver_) external;

    // -------------------------------------------------------------------------
    // Fee extraction — feeReceiver only
    // -------------------------------------------------------------------------

    /// @notice Redeem `units` of fee-receiver units for underlying USDC.
    ///         Caller must be the feeReceiver (TreasuryV21).
    ///         Accrues outstanding fee first, then burns units proportionally,
    ///         pulls USDC from strategy if needed, and transfers to caller.
    /// @param units   Number of fee-receiver units to redeem
    /// @return usdcReturned USDC transferred to feeReceiver
    function redeemFeeUnits(uint256 units) external returns (uint256 usdcReturned);
}
