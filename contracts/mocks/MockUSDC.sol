// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Mock USDC token for testing purposes only
/// @dev 6 decimals to match real USDC, public mint function
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (test only)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
