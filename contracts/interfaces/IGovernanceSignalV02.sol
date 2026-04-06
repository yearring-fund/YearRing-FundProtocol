// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IGovernanceSignalV02
/// @notice Interface for the V02 signal-only governance module.
///
/// Signal-only: proposals and votes are recorded on-chain for transparency
/// but do not trigger any protocol parameter changes. No execution path exists.
///
/// Explicit design boundaries:
///   - No Pending state: proposals are Active immediately on creation. startTime is a record
///     field only; delayed-start is deferred to a future version.
///   - No quorum: passed = forVotes > againstVotes. A single For vote with no Against is Succeeded.
///     This is intentional for low-friction signaling; it is not a formal binding vote.
///   - Abstain is informational: abstainVotes are accumulated for transparency but do not
///     affect the passed flag in either direction.
///   - Voting power is snapshot-frozen at proposal creation via ERC20Snapshot, preventing
///     the same tokens from being transferred and used to vote twice.
interface IGovernanceSignalV02 {

    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Restricted proposal categories — defines the governance signal scope
    enum ProposalType {
        RewardRateSignal,          // Signal on reward token issuance rate
        FeeDiscountSignal,         // Signal on management fee discount tiers
        InactivityThresholdSignal, // Signal on beneficiary inactivity threshold
        GeneralSignal              // Open-ended protocol signal
    }

    /// @notice Vote direction
    enum VoteType { For, Against, Abstain }

    /// @notice Proposal lifecycle states
    enum ProposalState { Active, Succeeded, Defeated }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct Proposal {
        address      proposer;
        string       title;
        string       description;
        ProposalType proposalType;
        uint64       startTime;
        uint64       endTime;
        uint256      forVotes;
        uint256      againstVotes;
        uint256      abstainVotes;
        uint256      snapshotId;  // ERC20Snapshot id taken at proposal creation time
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalType    proposalType,
        string          title,
        uint64          endTime
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        VoteType        voteType,
        uint256         weight
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error EmptyTitle();
    error ProposalNotFound(uint256 proposalId);
    error ProposalNotActive(uint256 proposalId);
    error AlreadyVoted(uint256 proposalId, address voter);
    error InsufficientVotingPower(address voter, uint256 required, uint256 actual);

    // -------------------------------------------------------------------------
    // Admin operations
    // -------------------------------------------------------------------------

    /// @notice Create a new signal proposal (admin only)
    /// @param title        Short proposal title — must be non-empty
    /// @param description  Full proposal description
    /// @param proposalType Restricted signal category
    /// @return proposalId  Auto-incrementing proposal ID
    function createProposal(
        string calldata title,
        string calldata description,
        ProposalType    proposalType
    ) external returns (uint256 proposalId);

    // -------------------------------------------------------------------------
    // User operations
    // -------------------------------------------------------------------------

    /// @notice Cast a vote on an active proposal
    /// @dev Caller must hold >= votingThreshold RWT at proposal-creation snapshot time.
    ///      Voting weight = rewardToken.balanceOfAt(msg.sender, proposal.snapshotId).
    ///      Each address votes once per proposal.
    /// @param proposalId Target proposal
    /// @param voteType   For / Against / Abstain
    function castVote(uint256 proposalId, VoteType voteType) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Current state of a proposal
    function stateOf(uint256 proposalId) external view returns (ProposalState);

    /// @notice Vote totals and outcome for a proposal
    /// @return forVotes     Total weight voted For
    /// @return againstVotes Total weight voted Against
    /// @return abstainVotes Total weight voted Abstain
    /// @return passed       true if forVotes > againstVotes
    function resultOf(uint256 proposalId) external view returns (
        uint256 forVotes,
        uint256 againstVotes,
        uint256 abstainVotes,
        bool    passed
    );

    /// @notice Current RWT balance of a voter — convenience only.
    /// @dev This is the *current* balance, NOT the snapshot balance used in castVote.
    ///      Do not use this to predict vote weight for an existing proposal.
    ///      Use votingPowerAt(proposalId, voter) for proposal-specific power.
    function votingPowerOf(address voter) external view returns (uint256);

    /// @notice Voting power of an address for a specific proposal — reads the snapshot taken
    ///         at proposal creation time. This is the exact value used by castVote.
    /// @param proposalId The proposal to query
    /// @param voter      The address to check
    function votingPowerAt(uint256 proposalId, address voter) external view returns (uint256);

    /// @notice Full proposal data
    function getProposal(uint256 proposalId) external view returns (Proposal memory);
}
