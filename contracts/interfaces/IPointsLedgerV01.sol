// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPointsLedgerV01
/// @notice Interface for the non-transferable on-chain Points ledger.
///         Points are protocol-internal records; they are not ERC20 tokens and cannot be
///         transferred between user addresses.
interface IPointsLedgerV01 {

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when Points are issued to a user
    /// @param to          Recipient address
    /// @param amount      Points amount (18 decimals)
    /// @param pointsType  0 = Lock issuance, 1 = Contribution issuance
    event PointsCredited(address indexed to, uint256 amount, uint8 indexed pointsType);

    /// @notice Emitted when Points are deducted from a user (early exit return)
    /// @param from    User address
    /// @param amount  Points amount deducted (18 decimals)
    event PointsDebited(address indexed from, uint256 amount);

    /// @notice Emitted when a new snapshot is created
    event SnapshotCreated(uint256 indexed id);

    // -------------------------------------------------------------------------
    // Write — POINTS_MINTER_ROLE
    // -------------------------------------------------------------------------

    /// @notice Issue Points to a user from the lock issuance path.
    ///         Increments lockPointsIssued counter.
    ///         Reverts if totalIssued + amount > MAX_SUPPLY.
    /// @param to     Recipient address
    /// @param amount Points to issue (18 decimals)
    function creditLock(address to, uint256 amount) external;

    /// @notice Issue Points to a user from the community contribution path.
    ///         Increments contributionPointsIssued counter.
    ///         Reverts if totalIssued + amount > MAX_SUPPLY.
    /// @param to     Recipient address
    /// @param amount Points to issue (18 decimals)
    function creditContribution(address to, uint256 amount) external;

    // -------------------------------------------------------------------------
    // Write — POINTS_BURNER_ROLE
    // -------------------------------------------------------------------------

    /// @notice Deduct Points from a user (early exit return path).
    ///         Does NOT reduce totalIssued — supply cap is one-directional.
    ///         Reverts if user balance is insufficient.
    /// @param from   User address
    /// @param amount Points to deduct (18 decimals)
    function debit(address from, uint256 amount) external;

    // -------------------------------------------------------------------------
    // Write — SNAPSHOT_ROLE
    // -------------------------------------------------------------------------

    /// @notice Create a new snapshot, freezing all current balances.
    ///         Called by GovernanceSignalV02 at proposal creation time.
    /// @return snapshotId  The ID of the new snapshot
    function snapshot() external returns (uint256 snapshotId);

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Current Points balance of an address
    function balanceOf(address account) external view returns (uint256);

    /// @notice Points balance of an address at a historical snapshot
    /// @param account    Address to query
    /// @param snapshotId Snapshot ID returned by snapshot()
    function balanceOfAt(address account, uint256 snapshotId) external view returns (uint256);

    /// @notice Most recently created snapshot ID (0 = no snapshot taken yet)
    function currentSnapshotId() external view returns (uint256);

    /// @notice Cumulative Points ever issued (never decreases)
    function totalIssued() external view returns (uint256);

    /// @notice Points issued via the lock path (stat only, not a cap)
    function lockPointsIssued() external view returns (uint256);

    /// @notice Points issued via the contribution path (stat only, not a cap)
    function contributionPointsIssued() external view returns (uint256);

    /// @notice Remaining issuable Points before MAX_SUPPLY is reached
    function remainingSupply() external view returns (uint256);
}
