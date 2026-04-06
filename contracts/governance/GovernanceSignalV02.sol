// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IGovernanceSignalV02.sol";

/// @dev Minimal interface for ERC20Snapshot methods used by governance
interface ISnapshotToken is IERC20 {
    function snapshot() external returns (uint256);
    function balanceOfAt(address account, uint256 snapshotId) external view returns (uint256);
}

/// @title GovernanceSignalV02
/// @notice Signal-only governance module. RWT snapshot balance = voting power.
/// @dev    TOKEN REQUIREMENT: this contract depends on a snapshot-capable RWT implementation.
///         RewardToken must extend ERC20Snapshot (OZ v4) and expose snapshot() + balanceOfAt().
///         A plain ERC20 RewardToken will compile but castVote will always read balance 0.
///
/// Design constraints:
///   - Proposals are created by admin only; users vote.
///   - Votes are recorded on-chain for public transparency.
///   - Results are never read by any other protocol contract — no execution path.
///   - This contract holds no assets, no protocol roles, no upgrade authority.
///   - Vault / Ledger / RewardManager accounting is completely unaffected.
///
/// Voting rules:
///   - Voter must hold >= votingThreshold RWT at proposal-creation snapshot.
///   - Weight = rewardToken.balanceOfAt(voter, snapshotId) — frozen at proposal creation,
///     preventing the same tokens from voting twice across different addresses.
///   - Each address may cast exactly one vote per proposal.
///   - Passed = forVotes > againstVotes. No quorum required (low-friction signaling only).
///   - abstainVotes are recorded for transparency but do not affect the passed flag.
///
/// Lifecycle notes:
///   - No Pending state: proposals become Active immediately on creation.
///     startTime is a record field only; if delayed-start is needed, extend in a future version.
///   - No Canceled state in V2.
///   - title and description are stored fully on-chain. For lower calldata cost in a future
///     version, consider keeping only title + a metadataURI / ipfsHash.
contract GovernanceSignalV02 is IGovernanceSignalV02, AccessControl {

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Can create signal proposals. Separate from DEFAULT_ADMIN_ROLE so that
    ///         proposal submission authority can be delegated without granting full admin power.
    ///         Granted to admin_ at construction; admin may grant to additional proposers.
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    /// @notice RWT token — snapshot-capable; voting power frozen at proposal creation
    ISnapshotToken public immutable rewardToken;

    /// @notice Minimum RWT balance required to cast a vote
    uint256 public immutable votingThreshold;

    /// @notice Duration of each proposal's voting window (seconds)
    uint64 public immutable votingPeriod;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Auto-incrementing proposal counter
    uint256 public nextProposalId;

    /// @notice Proposal data by ID
    mapping(uint256 => Proposal) private _proposals;

    /// @notice Whether an address has voted on a proposal
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param rewardToken_     RWT token address
    /// @param votingThreshold_ Minimum RWT to cast a vote (e.g. 10e18 for 10 RWT)
    /// @param votingPeriod_    Voting window duration in seconds (e.g. 7 days)
    /// @param admin_           Address granted DEFAULT_ADMIN_ROLE (proposal creation)
    constructor(
        address rewardToken_,
        uint256 votingThreshold_,
        uint64  votingPeriod_,
        address admin_
    ) {
        if (rewardToken_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        rewardToken     = ISnapshotToken(rewardToken_);
        votingThreshold = votingThreshold_;
        votingPeriod    = votingPeriod_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(PROPOSER_ROLE,      admin_);  // admin starts with proposal authority; can delegate
    }

    // -------------------------------------------------------------------------
    // Admin: createProposal
    // -------------------------------------------------------------------------

    /// @inheritdoc IGovernanceSignalV02
    function createProposal(
        string calldata title,
        string calldata description,
        ProposalType    proposalType
    )
        external
        override
        onlyRole(PROPOSER_ROLE)
        returns (uint256 proposalId)
    {
        if (bytes(title).length == 0) revert EmptyTitle();

        proposalId = nextProposalId++;

        uint64  start  = uint64(block.timestamp);
        uint64  end    = start + votingPeriod;
        // No Pending state: proposal is Active immediately. startTime is a record field only.
        uint256 snapId = rewardToken.snapshot();   // freeze all balances now; castVote uses balanceOfAt

        _proposals[proposalId] = Proposal({
            proposer:     msg.sender,
            title:        title,
            description:  description,
            proposalType: proposalType,
            startTime:    start,
            endTime:      end,
            forVotes:     0,
            againstVotes: 0,
            abstainVotes: 0,
            snapshotId:   snapId
        });

        emit ProposalCreated(proposalId, msg.sender, proposalType, title, end);
    }

    // -------------------------------------------------------------------------
    // User: castVote
    // -------------------------------------------------------------------------

    /// @inheritdoc IGovernanceSignalV02
    function castVote(uint256 proposalId, VoteType voteType) external override {
        if (proposalId >= nextProposalId) revert ProposalNotFound(proposalId);
        if (stateOf(proposalId) != ProposalState.Active) revert ProposalNotActive(proposalId);
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted(proposalId, msg.sender);

        uint256 power = rewardToken.balanceOfAt(msg.sender, _proposals[proposalId].snapshotId);
        if (power < votingThreshold)
            revert InsufficientVotingPower(msg.sender, votingThreshold, power);

        hasVoted[proposalId][msg.sender] = true;

        if (voteType == VoteType.For) {
            _proposals[proposalId].forVotes += power;
        } else if (voteType == VoteType.Against) {
            _proposals[proposalId].againstVotes += power;
        } else {
            _proposals[proposalId].abstainVotes += power;
        }

        emit VoteCast(proposalId, msg.sender, voteType, power);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc IGovernanceSignalV02
    /// @dev No quorum: a proposal with 1 For and 0 Against is Succeeded.
    ///      abstainVotes do not affect the outcome — they are recorded for transparency only.
    function stateOf(uint256 proposalId) public view override returns (ProposalState) {
        if (proposalId >= nextProposalId) revert ProposalNotFound(proposalId);
        Proposal storage p = _proposals[proposalId];
        if (block.timestamp < p.endTime) return ProposalState.Active;
        return p.forVotes > p.againstVotes ? ProposalState.Succeeded : ProposalState.Defeated;
    }

    /// @inheritdoc IGovernanceSignalV02
    /// @dev passed = forVotes > againstVotes only. abstainVotes are informational and do not
    ///      reduce the For side or contribute to a quorum (no quorum exists in this module).
    function resultOf(uint256 proposalId) external view override returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        bool    passed
    ) {
        if (proposalId >= nextProposalId) revert ProposalNotFound(proposalId);
        Proposal storage p = _proposals[proposalId];
        forVotes     = p.forVotes;
        againstVotes = p.againstVotes;
        abstainVotes = p.abstainVotes;
        passed       = p.forVotes > p.againstVotes;
    }

    /// @inheritdoc IGovernanceSignalV02
    /// @dev Returns *current* balance — not the snapshot value used in castVote.
    ///      For proposal-specific power use votingPowerAt(proposalId, voter).
    function votingPowerOf(address voter) external view override returns (uint256) {
        return rewardToken.balanceOf(voter);
    }

    /// @inheritdoc IGovernanceSignalV02
    function votingPowerAt(uint256 proposalId, address voter) external view override returns (uint256) {
        if (proposalId >= nextProposalId) revert ProposalNotFound(proposalId);
        return rewardToken.balanceOfAt(voter, _proposals[proposalId].snapshotId);
    }

    /// @inheritdoc IGovernanceSignalV02
    function getProposal(uint256 proposalId) external view override returns (Proposal memory) {
        if (proposalId >= nextProposalId) revert ProposalNotFound(proposalId);
        return _proposals[proposalId];
    }
}
