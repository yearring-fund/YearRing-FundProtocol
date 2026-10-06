// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";

/// @title PointsToken
/// @notice Fixed-supply closed beta points token for YearRing Fund Protocol.
///         All tokens are pre-minted to TreasuryV02 at deployment. No mint function exists
///         after construction — total supply is permanently fixed.
///
/// @dev Deployment parameters (closed beta):
///        name:   "YearRing Points"
///        symbol: "YRPTS"
///
///      Extends ERC20Snapshot so GovernanceSignalV02 can freeze voting power at
///      proposal-creation time, preventing the same tokens from influencing a proposal
///      twice via post-creation transfers.
///
///      FRONTEND COMPLIANCE (enforced in Phase 9):
///        - Must display as "Points" — never "RWT", "YRT", "YRFP", "YearRing Token",
///          or any name implying a formal native token.
///        - Must include: "原生代币上线后，将按用户当时持有的 Points 数量进行早期测试奖励分配。"
///        - Must NOT state: "Points are the native token", "guaranteed yield",
///          "guaranteed airdrop", or "risk-free".
///        - Must NOT count Points in user NAV or pricePerShare.
///
///      ECONOMIC ROLE:
///        - Issued upfront at lock time by LockPointsRebateManagerV02.
///        - Amount = lockedUSDCValue × 1e12 × durationDays × multiplierBps / (10000 × 500)
///        - On early exit: user must approve and return this lock's full Points to TreasuryV02.
///        - On normal unlock: Points are retained permanently by the user.
contract PointsToken is ERC20Snapshot {
    error ZeroAddress();
    error ZeroPremintAmount();

    /// @notice Emitted once at construction when the full supply is minted to TreasuryV02
    event TokensPreminted(address indexed treasury, uint256 amount);

    /// @notice Take a balance snapshot; callable by anyone.
    ///         GovernanceSignalV02 calls this at proposal creation to freeze voting power.
    /// @return snapshotId The ID of the new snapshot
    function snapshot() external returns (uint256) {
        return _snapshot();
    }

    /// @param name_         Token name — deploy as "YearRing Points"
    /// @param symbol_       Token symbol — deploy as "YRPTS"
    /// @param premintAmount Total fixed supply, pre-minted entirely to TreasuryV02
    /// @param treasury      TreasuryV02 address — sole initial holder of all Points
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
