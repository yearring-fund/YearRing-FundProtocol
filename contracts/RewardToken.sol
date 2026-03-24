// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title RewardToken
/// @notice Fixed-supply reward token; all tokens pre-minted to treasury at deploy
/// @dev No mint function exposed → supply is permanently fixed after construction
contract RewardToken is ERC20 {
    error ZeroAddress();
    error ZeroPremintAmount();

    event TokensPreminted(address indexed treasury, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 premintAmount,
        address treasury
    ) ERC20(name_, symbol_) {
        if (treasury == address(0)) revert ZeroAddress();
        if (premintAmount == 0) revert ZeroPremintAmount();

        _mint(treasury, premintAmount);
        emit TokensPreminted(treasury, premintAmount);
    }
}
