// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMetricsLayerV02
/// @notice Interface for the V02 protocol metrics layer (O(1) snapshot only)
interface IMetricsLayerV02 {

    /// @notice Immutable protocol snapshot — all fields computed in a single call
    struct ProtocolSnapshot {
        /// @notice FundVaultV01.totalAssets() — USDC (6-decimal)
        uint256 totalTVL;

        /// @notice LockLedgerV02.totalLockedShares() — fbUSDC (18-decimal)
        uint256 totalLockedShares;

        /// @notice totalLockedShares × 10000 / vault.totalSupply() (bps)
        ///         Returns 0 when totalSupply == 0
        uint256 lockedRatioBps;

        /// @notice LockLedgerV02.nextLockId() — total lock positions ever created (append-only)
        uint256 totalLocksEver;
    }

    /// @notice Returns a single-call O(1) protocol snapshot
    function snapshot() external view returns (ProtocolSnapshot memory);
}
