// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IMetricsLayerV02.sol";

// Minimal read interfaces (avoids importing full V01 contracts)
interface IVaultView {
    function totalAssets()  external view returns (uint256);
    function totalSupply()  external view returns (uint256);
}

interface ILedgerView {
    function totalLockedShares() external view returns (uint256);
    function nextLockId()        external view returns (uint256);
}

/// @title MetricsLayerV02
/// @notice Bundles O(1) protocol-level stats into a single staticcall.
///         No state written. No assets held. No access control.
///
/// Design: iteration-heavy aggregation (tier breakdown, early-exit count, points)
///         is intentionally off-chain (scripts/metrics.ts).
///         This contract only packs the four cheapest cross-contract reads.
contract MetricsLayerV02 is IMetricsLayerV02 {

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    IVaultView  public immutable vault;
    ILedgerView public immutable ledger;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address vault_, address ledger_) {
        if (vault_ == address(0) || ledger_ == address(0)) revert ZeroAddress();
        vault  = IVaultView(vault_);
        ledger = ILedgerView(ledger_);
    }

    // -------------------------------------------------------------------------
    // IMetricsLayerV02
    // -------------------------------------------------------------------------

    /// @inheritdoc IMetricsLayerV02
    function snapshot() external view override returns (ProtocolSnapshot memory s) {
        s.totalTVL          = vault.totalAssets();
        s.totalLockedShares = ledger.totalLockedShares();
        uint256 supply      = vault.totalSupply();
        s.lockedRatioBps    = supply == 0 ? 0 : s.totalLockedShares * BPS_DENOMINATOR / supply;
        s.totalLocksEver    = ledger.nextLockId();
    }
}
