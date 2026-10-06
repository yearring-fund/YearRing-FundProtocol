// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";

/// @title RewardToken
/// @notice Fixed-supply reward token; all tokens pre-minted to treasury at deploy
/// @dev No mint function exposed → supply is permanently fixed after construction.
///      Extends ERC20Snapshot so governance contracts can freeze voting power at
///      proposal-creation time, preventing the same tokens from voting twice by
///      being transferred between addresses after a proposal is opened.
contract RewardToken is ERC20Snapshot {
    error ZeroAddress();
    error ZeroPremintAmount();

    event TokensPreminted(address indexed treasury, uint256 amount);

    /// @notice Take a balance snapshot; callable by anyone (used by governance on proposal creation)
    /// @return snapshotId The ID of the new snapshot
    function snapshot() external returns (uint256) {
        return _snapshot();
    }

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
