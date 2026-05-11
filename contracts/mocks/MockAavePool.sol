// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MockAToken.sol";

/// @title MockAavePool
/// @notice Minimal Aave V3 pool mock for AaveUSDCStrategyV21 unit tests.
///
/// Behaviour
/// ---------
/// • supply(): pulls USDC from caller, mints 1:1 aTokens to onBehalfOf.
/// • withdraw(): burns aTokens from caller (amount == type(uint256).max burns all),
///               transfers USDC back to `to`.
/// • Yield is simulated by calling MockAToken.addYield() in test scripts — extra aTokens
///   represent accrued interest; withdraw() will attempt to transfer extra USDC so tests
///   must pre-fund the pool with enough USDC to cover simulated yield.
/// • Reverts can be toggled for failure-path tests.
contract MockAavePool {
    using SafeERC20 for IERC20;

    MockAToken public immutable aToken;
    IERC20     public immutable usdc;

    bool public failSupply;
    bool public failWithdraw;

    error SupplyFailed();
    error WithdrawFailed();
    error InsufficientPoolBalance(uint256 available, uint256 required);

    constructor(address usdc_, address aToken_) {
        usdc   = IERC20(usdc_);
        aToken = MockAToken(aToken_);
    }

    // -------------------------------------------------------------------------
    // IAavePoolV3 interface
    // -------------------------------------------------------------------------

    /// @notice Deposit `amount` of `asset` and mint aTokens 1:1 to `onBehalfOf`.
    ///         `referralCode` is accepted but ignored.
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16  /* referralCode */
    ) external {
        if (failSupply) revert SupplyFailed();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    /// @notice Withdraw `amount` of underlying (type(uint256).max = full balance).
    ///         Burns aTokens from `msg.sender` and transfers USDC to `to`.
    /// @return withdrawn Actual USDC transferred.
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256 withdrawn) {
        if (failWithdraw) revert WithdrawFailed();

        uint256 aBalance = aToken.balanceOf(msg.sender);
        withdrawn = (amount == type(uint256).max) ? aBalance : amount;
        if (withdrawn > aBalance) withdrawn = aBalance;

        aToken.burn(msg.sender, withdrawn);

        uint256 poolBal = IERC20(asset).balanceOf(address(this));
        if (poolBal < withdrawn) revert InsufficientPoolBalance(poolBal, withdrawn);

        IERC20(asset).safeTransfer(to, withdrawn);
    }

    // -------------------------------------------------------------------------
    // Test helpers
    // -------------------------------------------------------------------------

    /// @notice Toggle supply() reversion for failure-path tests.
    function setFailSupply(bool fail) external { failSupply = fail; }

    /// @notice Toggle withdraw() reversion for failure-path tests.
    function setFailWithdraw(bool fail) external { failWithdraw = fail; }

    /// @notice Pre-fund the pool with USDC (to cover simulated yield payouts).
    ///         Caller must have approved this contract first.
    function fundPool(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }
}
