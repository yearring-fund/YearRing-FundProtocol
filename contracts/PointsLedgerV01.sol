// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IPointsLedgerV01.sol";

/// @title PointsLedgerV01
/// @notice Non-transferable on-chain Points ledger for YearRing Fund Protocol closed beta.
///
/// @dev Design principles:
///   - NOT an ERC20 token. Points cannot be transferred between user addresses.
///   - All issuance and deduction flows through role-controlled functions called by
///     other protocol contracts — users have no direct write access.
///   - Snapshot mechanism replicates OZ ERC20Snapshot logic for governance compatibility,
///     restricted to SNAPSHOT_ROLE (granted to GovernanceSignalV02).
///
/// Role model:
///   POINTS_MINTER_ROLE  — LockPointsRebateManagerV02, ContributionPointsDistributorV01
///   POINTS_BURNER_ROLE  — LockPointsRebateManagerV02 only
///   SNAPSHOT_ROLE       — GovernanceSignalV02 only
///
/// Supply:
///   MAX_SUPPLY = 20,000,000 × 1e18. totalIssued only increases; debit does not free supply.
///   lockPointsIssued + contributionPointsIssued are stats counters, not sub-caps.
contract PointsLedgerV01 is IPointsLedgerV01, AccessControl {

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant POINTS_MINTER_ROLE = keccak256("POINTS_MINTER_ROLE");
    bytes32 public constant POINTS_BURNER_ROLE = keccak256("POINTS_BURNER_ROLE");
    bytes32 public constant SNAPSHOT_ROLE      = keccak256("SNAPSHOT_ROLE");

    // -------------------------------------------------------------------------
    // Supply constants
    // -------------------------------------------------------------------------

    /// @notice Hard cap on total Points ever issued (18 decimals)
    uint256 public constant MAX_SUPPLY = 20_000_000 * 1e18;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Current Points balance per address
    mapping(address => uint256) private _balances;

    /// @notice Cumulative Points ever issued (monotonically increasing)
    uint256 public override totalIssued;

    /// @notice Points issued via the lock path
    uint256 public override lockPointsIssued;

    /// @notice Points issued via the community contribution path
    uint256 public override contributionPointsIssued;

    /// @notice Most recently created snapshot ID
    uint256 private _currentSnapshotId;

    // -------------------------------------------------------------------------
    // Snapshot storage
    // Replicates OZ ERC20Snapshot: per-account arrays of (snapshotId, balance) pairs.
    // Invariant: ids[] is strictly increasing. A new entry is written only once per
    // snapshot period — recording the balance BEFORE the first change in that period.
    // -------------------------------------------------------------------------

    struct Snapshots {
        uint256[] ids;
        uint256[] values;
    }

    mapping(address => Snapshots) private _accountSnapshots;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error MaxSupplyExceeded(uint256 requested, uint256 remaining);
    error InsufficientBalance(address account, uint256 required, uint256 available);
    error SnapshotIdZero();
    error SnapshotIdFuture(uint256 requested, uint256 current);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param admin_ DEFAULT_ADMIN_ROLE holder — can grant/revoke all roles
    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // POINTS_MINTER_ROLE — issuance
    // -------------------------------------------------------------------------

    /// @inheritdoc IPointsLedgerV01
    function creditLock(address to, uint256 amount)
        external
        override
        onlyRole(POINTS_MINTER_ROLE)
    {
        _credit(to, amount);
        lockPointsIssued += amount;
        emit PointsCredited(to, amount, 0);
    }

    /// @inheritdoc IPointsLedgerV01
    function creditContribution(address to, uint256 amount)
        external
        override
        onlyRole(POINTS_MINTER_ROLE)
    {
        _credit(to, amount);
        contributionPointsIssued += amount;
        emit PointsCredited(to, amount, 1);
    }

    // -------------------------------------------------------------------------
    // POINTS_BURNER_ROLE — deduction
    // -------------------------------------------------------------------------

    /// @inheritdoc IPointsLedgerV01
    /// @dev totalIssued is NOT decremented. Returned Points do not free supply capacity.
    function debit(address from, uint256 amount)
        external
        override
        onlyRole(POINTS_BURNER_ROLE)
    {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = _balances[from];
        if (bal < amount) revert InsufficientBalance(from, amount, bal);

        _updateAccountSnapshot(from);
        _balances[from] = bal - amount;

        emit PointsDebited(from, amount);
    }

    // -------------------------------------------------------------------------
    // SNAPSHOT_ROLE
    // -------------------------------------------------------------------------

    /// @inheritdoc IPointsLedgerV01
    function snapshot()
        external
        override
        onlyRole(SNAPSHOT_ROLE)
        returns (uint256)
    {
        _currentSnapshotId += 1;
        emit SnapshotCreated(_currentSnapshotId);
        return _currentSnapshotId;
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc IPointsLedgerV01
    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    /// @inheritdoc IPointsLedgerV01
    /// @dev Replicates OZ ERC20Snapshot.balanceOfAt logic.
    ///      If no snapshot entry exists for this account at or after snapshotId,
    ///      returns the current balance (the account has not changed since that snapshot).
    function balanceOfAt(address account, uint256 snapshotId)
        external
        view
        override
        returns (uint256)
    {
        if (snapshotId == 0) revert SnapshotIdZero();
        if (snapshotId > _currentSnapshotId) revert SnapshotIdFuture(snapshotId, _currentSnapshotId);

        (bool snapshotted, uint256 value) = _valueAt(_accountSnapshots[account], snapshotId);
        return snapshotted ? value : _balances[account];
    }

    /// @inheritdoc IPointsLedgerV01
    function currentSnapshotId() external view override returns (uint256) {
        return _currentSnapshotId;
    }

    /// @inheritdoc IPointsLedgerV01
    function remainingSupply() external view override returns (uint256) {
        return MAX_SUPPLY - totalIssued;
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Core credit logic shared by creditLock and creditContribution.
    function _credit(address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalIssued + amount > MAX_SUPPLY)
            revert MaxSupplyExceeded(amount, MAX_SUPPLY - totalIssued);

        _updateAccountSnapshot(to);
        _balances[to] += amount;
        totalIssued   += amount;
    }

    /// @dev Record the current balance of `account` under the active snapshot ID,
    ///      but only once per snapshot period (the first balance change in that period).
    function _updateAccountSnapshot(address account) private {
        uint256 currentId = _currentSnapshotId;
        Snapshots storage snaps = _accountSnapshots[account];

        // Only write if this snapshot period has not been recorded yet for this account
        if (_lastId(snaps.ids) < currentId) {
            snaps.ids.push(currentId);
            snaps.values.push(_balances[account]);
        }
    }

    /// @dev Binary search: returns the index of the first element in ids[] that is
    ///      >= snapshotId (lower bound). Returns ids.length if all elements < snapshotId.
    ///
    ///      Snapshot semantics (matching OZ ERC20Snapshot):
    ///        - Entry (id, v) means "balance was v at the START of snapshot period id".
    ///        - To find balance at snapshotId, find the first stored id >= snapshotId:
    ///            • If found at index i: values[i] is the balance valid from that period onward
    ///              (and was also valid at snapshotId since no change occurred in between).
    ///            • If not found (all ids < snapshotId): no change since snapshotId →
    ///              current balance equals balance at snapshotId → return (false, 0) to
    ///              signal "use current value".
    function _valueAt(Snapshots storage snaps, uint256 snapshotId)
        private
        view
        returns (bool, uint256)
    {
        uint256 len = snaps.ids.length;
        if (len == 0) return (false, 0);

        uint256 low  = 0;
        uint256 high = len;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (snaps.ids[mid] < snapshotId) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        // `low` is the first index where ids[low] >= snapshotId
        if (low == len) return (false, 0);          // all stored ids < snapshotId → use current
        return (true, snaps.values[low]);
    }

    /// @dev Returns the last element of an array, or 0 if empty.
    function _lastId(uint256[] storage ids) private view returns (uint256) {
        uint256 len = ids.length;
        return len == 0 ? 0 : ids[len - 1];
    }

    // -------------------------------------------------------------------------
    // supportsInterface
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
