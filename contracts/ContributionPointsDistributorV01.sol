// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IPointsLedgerV01.sol";

/// @title ContributionPointsDistributorV01
/// @notice Issues Points to community contributors via admin-authorised single or batch calls.
///
/// @dev Off-chain process (required before each batch):
///   1. Admin publishes a public list (Discord / official channel) containing:
///      address[], amount[], reason, batchId (bytes32), listHash (keccak256 of the list)
///   2. Admin calls distributeBatch() on-chain with the same parameters.
///   3. Anyone can verify on-chain: executedBatches[batchId] == true, batchRecords[batchId].listHash.
///
/// Anti-replay:
///   - batchId prevents the same batch from being submitted twice.
///   - For single distributions there is no on-chain dedup; admin is responsible for avoiding
///     duplicates (consistent with the "public list + admin custody" trust model).
///
/// Role model:
///   DISTRIBUTOR_ROLE  — can call distributeSingle and distributeBatch (granted to admin by default)
///   DEFAULT_ADMIN_ROLE — can grant/revoke DISTRIBUTOR_ROLE
contract ContributionPointsDistributorV01 is AccessControl, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice PointsLedgerV01 — the authoritative Points store
    IPointsLedgerV01 public immutable pointsLedger;

    /// @notice Whether a batch has already been executed (batchId → executed)
    mapping(bytes32 => bool) public executedBatches;

    struct BatchRecord {
        bytes32 listHash;         // keccak256 of the off-chain public list
        uint256 recipientCount;
        uint256 totalPoints;
        uint256 executedAt;       // block.timestamp at execution
    }

    /// @notice On-chain record of each executed batch
    mapping(bytes32 => BatchRecord) public batchRecords;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted for each single-address distribution
    /// @param recipient  Recipient address
    /// @param amount     Points issued (18 decimals)
    /// @param reason     Bytes32 reason tag (e.g. keccak256("testnet-feedback"))
    event SingleDistributed(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed reason
    );

    /// @notice Emitted once per executed batch
    /// @param batchId        Unique batch identifier
    /// @param listHash       keccak256 of the corresponding off-chain public list
    /// @param recipientCount Number of addresses in this batch
    /// @param totalPoints    Total Points issued in this batch
    event BatchDistributed(
        bytes32 indexed batchId,
        bytes32 listHash,
        uint256 recipientCount,
        uint256 totalPoints
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error EmptyBatch();
    error ArrayLengthMismatch();
    error BatchAlreadyExecuted(bytes32 batchId);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param pointsLedger_ PointsLedgerV01 address
    /// @param admin_        DEFAULT_ADMIN_ROLE holder; also receives DISTRIBUTOR_ROLE
    constructor(address pointsLedger_, address admin_) {
        if (pointsLedger_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        pointsLedger = IPointsLedgerV01(pointsLedger_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(DISTRIBUTOR_ROLE,   admin_);
    }

    // -------------------------------------------------------------------------
    // Distribution functions
    // -------------------------------------------------------------------------

    /// @notice Issue Points to a single address.
    /// @dev No on-chain dedup; admin is responsible for avoiding duplicate single distributions.
    /// @param recipient  Recipient address
    /// @param amount     Points to issue (18 decimals)
    /// @param reason     Bytes32 reason tag for on-chain record (e.g. keccak256("discord-activity"))
    function distributeSingle(
        address recipient,
        uint256 amount,
        bytes32 reason
    )
        external
        onlyRole(DISTRIBUTOR_ROLE)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0)             revert ZeroAmount();

        pointsLedger.creditContribution(recipient, amount);
        emit SingleDistributed(recipient, amount, reason);
    }

    /// @notice Issue Points to multiple addresses in a single transaction.
    /// @dev batchId prevents re-submission of the same batch. listHash links this execution
    ///      to the corresponding public off-chain list for verifiability.
    /// @param batchId     Unique batch identifier (admin-chosen bytes32, e.g. keccak256("2026-05-batch-01"))
    /// @param listHash    keccak256 of the off-chain public list (address / amount / reason table)
    /// @param recipients  Array of recipient addresses
    /// @param amounts     Array of Points amounts (18 decimals), parallel to recipients
    function distributeBatch(
        bytes32          batchId,
        bytes32          listHash,
        address[] calldata recipients,
        uint256[] calldata amounts
    )
        external
        nonReentrant
        onlyRole(DISTRIBUTOR_ROLE)
    {
        if (executedBatches[batchId])          revert BatchAlreadyExecuted(batchId);
        if (recipients.length == 0)            revert EmptyBatch();
        if (recipients.length != amounts.length) revert ArrayLengthMismatch();

        executedBatches[batchId] = true;

        uint256 total = 0;
        uint256 count = recipients.length;
        for (uint256 i = 0; i < count; i++) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0)             revert ZeroAmount();
            pointsLedger.creditContribution(recipients[i], amounts[i]);
            total += amounts[i];
        }

        batchRecords[batchId] = BatchRecord({
            listHash:       listHash,
            recipientCount: count,
            totalPoints:    total,
            executedAt:     block.timestamp
        });

        emit BatchDistributed(batchId, listHash, count, total);
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
