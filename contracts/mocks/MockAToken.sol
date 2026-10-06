// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockAToken
/// @notice Minimal Aave aToken mock for AaveUSDCStrategyV21 unit tests.
///         Tracks deposits and interest (accrued via addYield()).
///         MockAavePool is the only authorised minter/burner.
contract MockAToken is ERC20 {

    address public immutable underlying;
    address public immutable pool;

    error OnlyPool();

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(address underlying_, address pool_)
        ERC20("Mock aUSDC", "maUSDC")
    {
        underlying = underlying_;
        pool       = pool_;
    }

    // -------------------------------------------------------------------------
    // IATokenV3 interface
    // -------------------------------------------------------------------------

    /// @notice Returns the underlying asset address (required by AaveUSDCStrategyV21 constructor).
    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return underlying;
    }

    // -------------------------------------------------------------------------
    // Pool-only minting / burning
    // -------------------------------------------------------------------------

    function mint(address account, uint256 amount) external onlyPool {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external onlyPool {
        _burn(account, amount);
    }

    // -------------------------------------------------------------------------
    // Test helper — simulate interest accrual
    // -------------------------------------------------------------------------

    /// @notice Mint extra aTokens to `account` to simulate yield.
    ///         Callable by anyone in tests; pool mints to strategy.
    function addYield(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
