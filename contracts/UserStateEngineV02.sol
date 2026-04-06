// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IUserStateEngineV02.sol";
import "./interfaces/ILockLedgerV02.sol";

/// @title UserStateEngineV02
/// @notice Pure view contract: derives lock and user state from LockLedgerV02.
///         No state written. No assets held. No transfers.
///
/// State derivation rules (per lock position):
///   owner == address(0)              → Normal   (position not created)
///   unlocked == true                 → Normal   (position already withdrawn)
///   unlocked == false, now < unlockAt → LockedAccumulating
///   unlocked == false, now >= unlockAt → Matured
///   EarlyExit                        → V3+ reserved, unreachable in V2
///
/// User aggregate state priority: EarlyExit > LockedAccumulating > Matured > Normal
contract UserStateEngineV02 is IUserStateEngineV02 {

    // -------------------------------------------------------------------------
    // Immutable
    // -------------------------------------------------------------------------

    ILockLedgerV02 public immutable ledger;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address ledger_) {
        require(ledger_ != address(0), "ZeroAddress");
        ledger = ILockLedgerV02(ledger_);
    }

    // -------------------------------------------------------------------------
    // IUserStateEngineV02
    // -------------------------------------------------------------------------

    /// @inheritdoc IUserStateEngineV02
    function lockStateOf(uint256 lockId) public view override returns (LockState) {
        ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);

        if (pos.owner == address(0)) return LockState.Normal;
        if (pos.unlocked && pos.earlyExited) return LockState.EarlyExit;
        if (pos.unlocked)                    return LockState.Normal;

        if (block.timestamp >= pos.unlockAt) return LockState.Matured;
        return LockState.LockedAccumulating;
    }

    /// @inheritdoc IUserStateEngineV02
    function userStateOf(address owner) external view override returns (LockState) {
        if (owner == address(0)) return LockState.Normal;

        uint256[] memory ids = ledger.userLockIds(owner);
        if (ids.length == 0) return LockState.Normal;

        LockState highest = LockState.Normal;

        for (uint256 i = 0; i < ids.length; i++) {
            LockState s = lockStateOf(ids[i]);

            // EarlyExit is the highest priority — short-circuit immediately
            if (s == LockState.EarlyExit)          return LockState.EarlyExit;
            if (s == LockState.LockedAccumulating) highest = LockState.LockedAccumulating;
            if (s == LockState.Matured && highest == LockState.Normal) highest = LockState.Matured;
        }

        return highest;
    }
}
