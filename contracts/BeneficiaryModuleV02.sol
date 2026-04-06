// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IBeneficiaryModuleV02.sol";
import "./interfaces/ILockLedgerV02.sol";

/// @title BeneficiaryModuleV02
/// @notice Tracks user activity and allows a designated beneficiary to inherit
///         lock positions on a per-lock basis when the original owner becomes inactive.
///
/// Inheritance rules (V2):
///   - Locked positions: transferred on-chain via LockLedger.transferLockOwnership().
///     Lock state (duration, unlockAt) is fully preserved.
///   - Free fbUSDC assets: NOT transferred on-chain (off-chain coordination only).
///   - Per-lock claim state: each lockId is independently claimable and re-tryable.
///     A failed or partial batch does not block future claims for other locks.
///
/// Heartbeat is the ONLY action that resets the inactivity timer. Other protocol
/// operations (deposit, lock, redeem, etc.) do NOT reset it — module is non-invasive.
///
/// @dev Requires OPERATOR_ROLE on LockLedgerV02 to call transferLockOwnership().
contract BeneficiaryModuleV02 is IBeneficiaryModuleV02, AccessControl {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Inactivity threshold — aligned with MAX_LOCK_DURATION in LockLedgerV02.
    uint64 public constant INACTIVITY_THRESHOLD = 365 days;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    /// @notice LockLedgerV02 — used to transfer lock ownership and enumerate locks.
    ILockLedgerV02 public immutable ledger;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Designated beneficiary per user. address(0) = not set (default = self).
    mapping(address => address) private _beneficiary;

    /// @notice Last recorded heartbeat timestamp. 0 = user has never interacted.
    mapping(address => uint64) private _lastActiveAt;

    /// @notice Admin-override inactivity flag (for oracle integration and testing).
    mapping(address => bool) private _adminMarked;

    /// @notice Per-lock claim state. true = this lockId has been inherited via executeClaim.
    mapping(uint256 => bool) public inheritedClaimed;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param ledger_ LockLedgerV02 address. This contract must be granted OPERATOR_ROLE on it.
    /// @param admin_  Address granted DEFAULT_ADMIN_ROLE (can mark/unmark inactive).
    constructor(address ledger_, address admin_) {
        if (ledger_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        ledger = ILockLedgerV02(ledger_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // User: beneficiary management
    // -------------------------------------------------------------------------

    /// @inheritdoc IBeneficiaryModuleV02
    function setBeneficiary(address beneficiary) external override {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == msg.sender) revert SelfBeneficiary();
        _beneficiary[msg.sender] = beneficiary;
        _touch(msg.sender);
        emit BeneficiarySet(msg.sender, beneficiary);
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function updateBeneficiary(address newBeneficiary) external override {
        if (newBeneficiary == address(0)) revert ZeroAddress();
        if (newBeneficiary == msg.sender) revert SelfBeneficiary();
        _beneficiary[msg.sender] = newBeneficiary;
        _touch(msg.sender);
        emit BeneficiarySet(msg.sender, newBeneficiary);
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function revokeBeneficiary() external override {
        _beneficiary[msg.sender] = address(0);
        _touch(msg.sender);
        emit BeneficiaryRevoked(msg.sender);
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function heartbeat() external override {
        _touch(msg.sender);
        emit HeartbeatRecorded(msg.sender, _lastActiveAt[msg.sender]);
    }

    // -------------------------------------------------------------------------
    // Beneficiary: claim
    // -------------------------------------------------------------------------

    /// @inheritdoc IBeneficiaryModuleV02
    function executeClaim(address originalOwner, uint256[] calldata lockIds)
        external
        override
    {
        if (!isInactive(originalOwner)) revert UserNotInactive(originalOwner);

        address bene = beneficiaryOf(originalOwner);
        if (bene == originalOwner) revert NotBeneficiary(msg.sender, bene);
        if (msg.sender != bene)    revert NotBeneficiary(msg.sender, bene);

        for (uint256 i = 0; i < lockIds.length; i++) {
            uint256 lockId = lockIds[i];

            if (inheritedClaimed[lockId]) revert LockAlreadyClaimed(lockId);

            ILockLedgerV02.LockPosition memory pos = ledger.getLock(lockId);
            // Lock must be active and currently owned by originalOwner
            if (pos.owner != originalOwner || pos.unlocked) revert LockNotClaimable(lockId);

            inheritedClaimed[lockId] = true;
            ledger.transferLockOwnership(lockId, bene);
            emit LockInherited(originalOwner, bene, lockId);
        }
    }

    // -------------------------------------------------------------------------
    // Admin: inactivity override
    // -------------------------------------------------------------------------

    /// @notice Mark a user as inactive (bypasses time-based check).
    ///         Intended for oracle integration and testing.
    function adminMarkInactive(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        _adminMarked[user] = true;
    }

    /// @notice Unmark a previously admin-marked user.
    function adminUnmarkInactive(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _adminMarked[user] = false;
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc IBeneficiaryModuleV02
    function beneficiaryOf(address user) public view override returns (address) {
        address bene = _beneficiary[user];
        return bene == address(0) ? user : bene;
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function isInactive(address user) public view override returns (bool) {
        if (_adminMarked[user]) return true;
        uint64 last = _lastActiveAt[user];
        if (last == 0) return false;
        return uint64(block.timestamp) - last >= INACTIVITY_THRESHOLD;
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function lastActiveAt(address user) external view override returns (uint64) {
        return _lastActiveAt[user];
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function adminMarked(address user) external view override returns (bool) {
        return _adminMarked[user];
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function isLockClaimed(uint256 lockId) external view override returns (bool) {
        return inheritedClaimed[lockId];
    }

    /// @inheritdoc IBeneficiaryModuleV02
    function claimableLockIds(address originalOwner)
        external
        view
        override
        returns (uint256[] memory result)
    {
        uint256[] memory ids = ledger.userLockIds(originalOwner);
        uint256 count = 0;

        // First pass: count eligible locks
        for (uint256 i = 0; i < ids.length; i++) {
            ILockLedgerV02.LockPosition memory pos = ledger.getLock(ids[i]);
            if (pos.owner == originalOwner && !pos.unlocked && !inheritedClaimed[ids[i]]) {
                count++;
            }
        }

        // Second pass: fill result
        result = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            ILockLedgerV02.LockPosition memory pos = ledger.getLock(ids[i]);
            if (pos.owner == originalOwner && !pos.unlocked && !inheritedClaimed[ids[i]]) {
                result[j++] = ids[i];
            }
        }
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _touch(address user) internal {
        _lastActiveAt[user] = uint64(block.timestamp);
    }
}
