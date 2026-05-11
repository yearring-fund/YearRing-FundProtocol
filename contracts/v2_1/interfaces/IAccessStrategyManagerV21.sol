// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title IAccessStrategyManagerV21
/// @notice Interface for an Access-controlled Strategy Manager that accepts locked yrUSDC,
///         converts it to USDC via the CoreVault, deploys capital into a yield strategy,
///         and issues per-lockId units to track each position's share.
///
/// Entry / exit flow
/// -----------------
/// enter:
///   LockManager transfers yrUSDC to this contract.
///   enter() redeems yrUSDC from CoreVault → USDC.
///   USDC sits idle; keeper calls invest() to push to strategy.
///   enter() mints managerUnits proportional to USDC received.
///   Returns managerUnits for LockManager to record in the lock.
///
/// exit:
///   LockManager calls exit(lockId).
///   exit() burns lock's units, pulls proportional USDC (from idle + strategy).
///   Deposits USDC to CoreVault → yrUSDC (this contract must be on CoreVault allowlist).
///   Transfers yrUSDC to LockManager.
///   LockManager restores lock to YR_USDC state.
///
/// Fee model
/// ---------
/// Continuous management fee charged as unit dilution (same pattern as CoreStrategyManagerV21).
///   feeAmount = totalManagedAssets × feeBps × elapsed / (BPS × YEAR)
///   newFeeUnits = totalUnits × feeAmount / (totalManagedAssets - feeAmount)
/// Configurable at construction; admin may update via setManagementFeeBps().
/// LockManagerV21 reads managementFeeBpsPerYear() for MANAGER_UNITS rebate checkpoints.
interface IAccessStrategyManagerV21 {

    // -------------------------------------------------------------------------
    // View — configuration
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 used for yrUSDC ↔ USDC conversion
    function coreVault() external view returns (address);

    /// @notice LockManagerV21 — the only address authorised to call enter / exit
    function lockManager() external view returns (address);

    /// @notice Active yield strategy (may be address(0))
    function strategy() external view returns (address);

    /// @notice Address that receives fee-dilution units
    function feeReceiver() external view returns (address);

    /// @notice Underlying ERC-20 asset (USDC)
    function underlying() external view returns (address);

    /// @notice Annual management fee in basis points (100 bps = 1.00% / year).
    ///         Read by LockManagerV21._checkpointRebate for MANAGER_UNITS rebate.
    function managementFeeBpsPerYear() external view returns (uint256);

    // -------------------------------------------------------------------------
    // View — accounting
    // -------------------------------------------------------------------------

    /// @notice Total USDC value managed: idle held here + strategy-deployed
    function totalManagedAssets() external view returns (uint256);

    /// @notice Total outstanding units (all lockIds + fee receiver)
    function totalUnits() external view returns (uint256);

    /// @notice Units attributed to a specific lockId
    function unitsOfLock(uint256 lockId) external view returns (uint256);

    /// @notice Units attributed to the fee receiver
    function feeReceiverUnits() external view returns (uint256);

    /// @notice Current unit price in ray precision (1e27).
    ///         unitPriceRay = totalManagedAssets × 1e27 / totalUnits
    function unitPriceRay() external view returns (uint256);

    /// @notice USDC value attributable to a specific lockId.
    ///         lockManagedAssets = totalManagedAssets × unitsOfLock(lockId) / totalUnits
    function lockManagedAssets(uint256 lockId) external view returns (uint256);

    // -------------------------------------------------------------------------
    // LockManager-only — entry / exit
    // -------------------------------------------------------------------------

    /// @notice Called by LockManager after it has transferred `yrUSDCAmount` yrUSDC to
    ///         this contract.  Redeems yrUSDC → USDC, mints units proportional to USDC
    ///         received, and returns the units for LockManager to record in the lock.
    /// @param lockId       LockManagerV21 lock identifier
    /// @param yrUSDCAmount Amount of yrUSDC already transferred (used for validation / events)
    /// @return managerUnits Units minted for this lock's position
    function enter(uint256 lockId, uint256 yrUSDCAmount) external returns (uint256 managerUnits);

    /// @notice Called by LockManager to fully exit a lockId.
    ///         Burns the lock's units, divests proportional USDC from idle / strategy,
    ///         deposits USDC to CoreVault, and transfers yrUSDC to LockManager.
    ///
    ///         Prerequisite: this contract must be on CoreVault's allowlist when
    ///         CoreVault.allowlistEnabled == true.
    /// @param lockId LockManagerV21 lock identifier
    /// @return yrUSDCReturned Amount of yrUSDC transferred to LockManager
    function exit(uint256 lockId) external returns (uint256 yrUSDCReturned);

    // -------------------------------------------------------------------------
    // Keeper / Admin — strategy operations
    // -------------------------------------------------------------------------

    /// @notice Push `amount` of idle USDC into the active strategy.
    ///         Callable by DEFAULT_ADMIN_ROLE or KEEPER_ROLE.
    function invest(uint256 amount) external;

    /// @notice Pull `amount` from strategy back to idle.
    ///         Callable by DEFAULT_ADMIN_ROLE only.
    function divestFromStrategy(uint256 amount) external;

    /// @notice Withdraw entire strategy position to idle.
    ///         Callable by DEFAULT_ADMIN_ROLE only.
    function emergencyExitStrategy() external;

    /// @notice Mint fee-dilution units to feeReceiver based on elapsed time.
    ///         Callable by DEFAULT_ADMIN_ROLE or KEEPER_ROLE.
    function accrueFee() external;

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    /// @notice Set or replace the active yield strategy
    function setStrategy(address strategy_) external;

    /// @notice Set or replace the fee receiver address
    function setFeeReceiver(address feeReceiver_) external;

    /// @notice Update the annual management fee bps. Must emit ManagementFeeBpsSet.
    function setManagementFeeBps(uint256 bps_) external;

    /// @notice Update the LockManager address
    function setLockManager(address lockManager_) external;

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
