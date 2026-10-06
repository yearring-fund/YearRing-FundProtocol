// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

/// @title IStrategyV21
/// @notice Minimal interface for yield strategies plugged into CoreStrategyManagerV21.
/// @dev Push model: CoreStrategyManagerV21 transfers underlying before calling invest().
///      divest() and emergencyExit() return underlying directly to the manager.
interface IStrategyV21 {
    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    /// @notice Address of the underlying ERC-20 asset this strategy accepts (e.g. USDC)
    function underlying() external view returns (address);

    /// @notice Conservative mark-to-market of all assets controlled by this strategy.
    ///         Includes both deployed capital and any idle underlying held by the strategy.
    ///         Must never revert so that CoreStrategyManagerV21.totalManagedAssets() stays readable.
    function totalUnderlying() external view returns (uint256);

    // -------------------------------------------------------------------------
    // Fund operations — onlyManager
    // -------------------------------------------------------------------------

    /// @notice Deploy `amount` of underlying (already transferred to this contract) into the yield source.
    function invest(uint256 amount) external;

    /// @notice Withdraw `amount` of underlying from the yield source and transfer it back to manager.
    /// @return withdrawn Actual amount transferred to manager (may be less than `amount` if illiquid)
    function divest(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Withdraw entire position and return all underlying to manager.
    ///         Used for emergency withdrawals or strategy rotation.
    /// @return withdrawn Total underlying transferred to manager
    function emergencyExit() external returns (uint256 withdrawn);
}
