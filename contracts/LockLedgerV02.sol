// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILockLedgerV02.sol";

/// @title LockLedgerV02
/// @notice Users lock FundVaultV01 shares (fbUSDC) for a fixed duration to earn benefits.
///         Normal unlock requires maturity. earlyExit() allows exit before maturity:
///         principal is returned in full; points entitlement is forfeited.
/// @dev V02 thin-layer module — does NOT modify FundVaultV01 accounting in any way.
///      Interacts with vault shares purely via standard ERC20 transferFrom / transfer.
contract LockLedgerV02 is ILockLedgerV02, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------
    error ZeroShares();
    error ZeroAddress();
    error DurationTooShort(uint64 min, uint64 provided);
    error DurationTooLong(uint64 max, uint64 provided);
    error LockNotFound(uint256 lockId);
    error NotOwner(uint256 lockId);
    error AlreadyUnlocked(uint256 lockId);
    error LockNotMature(uint256 lockId, uint64 unlockAt, uint64 now_);
    error LockAlreadyMature(uint256 lockId, uint64 unlockAt, uint64 now_);
    error TooManyActiveLocks(address owner, uint256 max);

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------
    uint64  public constant MIN_LOCK_DURATION       = 30 days;
    uint64  public constant MAX_LOCK_DURATION       = 365 days;
    uint256 public constant MAX_ACTIVE_LOCKS_PER_USER = 5;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event Locked(
        uint256 indexed lockId,
        address indexed owner,
        uint256 shares,
        uint64  lockedAt,
        uint64  unlockAt
    );
    event Unlocked(uint256 indexed lockId, address indexed owner, uint256 shares);
    event EarlyExited(uint256 indexed lockId, address indexed owner, uint256 shares);
    event LockOwnershipTransferred(uint256 indexed lockId, address indexed oldOwner, address indexed newOwner, uint64 timestamp);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice FundVaultV01 share token (fbUSDC)
    IERC20 public immutable vaultShares;

    /// @notice Auto-incrementing lock ID counter
    uint256 public nextLockId;

    /// @notice Total vault shares currently locked in this contract
    uint256 public totalLockedShares;

    /// @notice Lock position data by lockId
    mapping(uint256 => LockPosition) private _positions;

    /// @notice All lockIds ever created by owner (includes unlocked)
    mapping(address => uint256[]) private _userLockIds;

    /// @notice Number of currently active (unlocked == false) positions per owner
    mapping(address => uint256) private _activeLockCount;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param vaultShares_ FundVaultV01 address (its ERC20 shares token)
    /// @param admin_       DEFAULT_ADMIN_ROLE holder
    /// @param emergency_   EMERGENCY_ROLE holder (pause only)
    constructor(address vaultShares_, address admin_, address emergency_) {
        if (vaultShares_ == address(0) || admin_ == address(0) || emergency_ == address(0)) {
            revert("ZeroAddress");
        }
        vaultShares = IERC20(vaultShares_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(EMERGENCY_ROLE, emergency_);
    }

    // -------------------------------------------------------------------------
    // Operator: lockFor
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockLedgerV02
    function lockFor(address owner, uint256 shares, uint64 duration)
        external
        override
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 lockId)
    {
        if (owner == address(0)) revert ZeroShares(); // reuse cheapest error
        return _lock(owner, shares, duration);
    }

    function _lock(address owner, uint256 shares, uint64 duration)
        internal
        returns (uint256 lockId)
    {
        if (shares == 0) revert ZeroShares();
        if (duration < MIN_LOCK_DURATION) revert DurationTooShort(MIN_LOCK_DURATION, duration);
        if (duration > MAX_LOCK_DURATION) revert DurationTooLong(MAX_LOCK_DURATION, duration);
        if (_activeLockCount[owner] >= MAX_ACTIVE_LOCKS_PER_USER)
            revert TooManyActiveLocks(owner, MAX_ACTIVE_LOCKS_PER_USER);

        uint64 lockedAt = uint64(block.timestamp);
        uint64 unlockAt = lockedAt + duration;

        lockId = nextLockId++;

        _positions[lockId] = LockPosition({
            owner:       owner,
            shares:      shares,
            lockedAt:    lockedAt,
            unlockAt:    unlockAt,
            endedAt:     0,
            unlocked:    false,
            earlyExited: false
        });

        _userLockIds[owner].push(lockId);
        _activeLockCount[owner]++;
        totalLockedShares += shares;

        vaultShares.safeTransferFrom(owner, address(this), shares);

        emit Locked(lockId, owner, shares, lockedAt, unlockAt);
    }

    // -------------------------------------------------------------------------
    // User: unlock
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockLedgerV02
    function unlock(uint256 lockId) external override whenNotPaused nonReentrant {
        LockPosition storage pos = _positions[lockId];

        if (pos.owner == address(0)) revert LockNotFound(lockId);
        if (pos.owner != msg.sender) revert NotOwner(lockId);
        if (pos.unlocked) revert AlreadyUnlocked(lockId);

        uint64 now_ = uint64(block.timestamp);
        if (now_ < pos.unlockAt) revert LockNotMature(lockId, pos.unlockAt, now_);

        pos.unlocked = true;
        pos.endedAt  = uint64(block.timestamp);
        _activeLockCount[msg.sender]--;
        totalLockedShares -= pos.shares;

        vaultShares.safeTransfer(msg.sender, pos.shares);

        emit Unlocked(lockId, msg.sender, pos.shares);
    }

    // -------------------------------------------------------------------------
    // Operator: earlyExitFor
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockLedgerV02
    function earlyExitFor(uint256 lockId, address owner)
        external
        override
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        _earlyExit(lockId, owner);
    }

    function _earlyExit(uint256 lockId, address owner) internal {
        LockPosition storage pos = _positions[lockId];

        if (pos.owner == address(0)) revert LockNotFound(lockId);
        if (pos.owner != owner)      revert NotOwner(lockId);
        if (pos.unlocked)            revert AlreadyUnlocked(lockId);

        uint64 now_ = uint64(block.timestamp);
        if (now_ >= pos.unlockAt) revert LockAlreadyMature(lockId, pos.unlockAt, now_);

        pos.unlocked    = true;
        pos.earlyExited = true;
        pos.endedAt     = uint64(block.timestamp);
        _activeLockCount[owner]--;
        totalLockedShares -= pos.shares;

        vaultShares.safeTransfer(owner, pos.shares);

        emit EarlyExited(lockId, owner, pos.shares);
    }

    // -------------------------------------------------------------------------
    // Operator: transferLockOwnership
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockLedgerV02
    function transferLockOwnership(uint256 lockId, address newOwner)
        external
        override
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (newOwner == address(0)) revert ZeroAddress();
        LockPosition storage pos = _positions[lockId];

        if (pos.owner == address(0)) revert LockNotFound(lockId);
        if (pos.unlocked)            revert AlreadyUnlocked(lockId);

        address oldOwner = pos.owner;

        // Bug fix: count active locks by current owner
        if (_activeLockCount[newOwner] >= MAX_ACTIVE_LOCKS_PER_USER)
            revert TooManyActiveLocks(newOwner, MAX_ACTIVE_LOCKS_PER_USER);

        pos.owner = newOwner;

        // Sync counters
        _activeLockCount[oldOwner]--;
        _activeLockCount[newOwner]++;

        // Sync index so all view/enumeration functions reflect current owner
        _removeFromUserLockIds(oldOwner, lockId);
        _userLockIds[newOwner].push(lockId);

        emit LockOwnershipTransferred(lockId, oldOwner, newOwner, uint64(block.timestamp));
    }

    /// @dev Swap-and-pop removal of lockId from owner's index array. O(n) scan.
    function _removeFromUserLockIds(address owner, uint256 lockId) internal {
        uint256[] storage ids = _userLockIds[owner];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; i++) {
            if (ids[i] == lockId) {
                ids[i] = ids[len - 1];
                ids.pop();
                return;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc ILockLedgerV02
    function getLock(uint256 lockId) external view override returns (LockPosition memory) {
        return _positions[lockId];
    }

    /// @inheritdoc ILockLedgerV02
    function userLockIds(address owner) external view override returns (uint256[] memory) {
        return _userLockIds[owner];
    }

    /// @inheritdoc ILockLedgerV02
    function userLockCount(address owner) external view override returns (uint256) {
        return _userLockIds[owner].length;
    }

    /// @inheritdoc ILockLedgerV02
    function activeLockCount(address owner) external view override returns (uint256) {
        return _activeLockCount[owner];
    }

    /// @inheritdoc ILockLedgerV02
    function userLockedSharesOf(address owner) external view override returns (uint256 total) {
        uint256[] storage ids = _userLockIds[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            LockPosition storage pos = _positions[ids[i]];
            if (!pos.unlocked) total += pos.shares;
        }
    }

    /// @inheritdoc ILockLedgerV02
    /// @dev Historical accuracy caveat: after a transferLockOwnership(), the transferred lockId
    ///      is removed from oldOwner's index and added to newOwner's index. Querying
    ///      lockedSharesOfAt(oldOwner, t) for t < transfer time will NOT include that lock,
    ///      even though oldOwner held it at time t. For precise historical reconstruction
    ///      use LockOwnershipTransferred events (includes timestamp) off-chain.
    function lockedSharesOfAt(address owner, uint256 timestamp) external view override returns (uint256 total) {
        uint256[] storage ids = _userLockIds[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            LockPosition storage pos = _positions[ids[i]];
            // Position was active at `timestamp` if:
            //   - it was created at or before timestamp (lockedAt <= timestamp)
            //   - it had not yet ended: endedAt == 0 (still active now) OR endedAt > timestamp
            if (pos.lockedAt <= uint64(timestamp) && (pos.endedAt == 0 || pos.endedAt > uint64(timestamp))) {
                total += pos.shares;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Pause (EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE can pause; only DEFAULT_ADMIN_ROLE can unpause)
    // -------------------------------------------------------------------------

    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
