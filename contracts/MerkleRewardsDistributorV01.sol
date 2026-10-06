// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MerkleRewardsDistributorV01
/// @notice Distributes reward tokens to vault shareholders via Merkle proofs
/// @dev Epochs are immutable once set; supports incremental (partial) claims
contract MerkleRewardsDistributorV01 is AccessControl, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error EpochAlreadyExists(uint256 epochId);
    error EpochDoesNotExist(uint256 epochId);
    error EpochTotalExceedsCap(uint256 epochTotal, uint256 cap);
    error InvalidMerkleProof();
    error NothingToClaim();
    error EpochOverflow(uint256 newClaimedTotal, uint256 epochTotal);
    error EpochCapExceedsMax(uint256 cap, uint256 maxCap);
    error ZeroAddress();
    error InvalidRoot();
    error InvalidEpochTotal();
    error InsufficientRewardBalance(uint256 required, uint256 available);
    error EpochAlreadyExpired(uint256 epochId);
    error EpochExpiredCannotClaim(uint256 epochId);
    error NothingToRescue();

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------
    struct EpochInfo {
        bytes32 root;
        uint256 epochTotal;
        uint256 claimedTotal;
        bool exists;
        bool expired;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Reward token distributed to claimants
    IERC20 public immutable rewardToken;

    /// @notice Associated fund vault (for accounting reference)
    address public immutable fundVault;

    /// @notice Maximum allowed epochCap (immutable)
    uint256 public immutable maxEpochCap;

    /// @notice Current per-epoch cap (adjustable by admin, <= maxEpochCap)
    uint256 public epochCap;

    /// @notice Total rewards allocated across all epochs but not yet claimed
    uint256 public totalUnclaimed;

    /// @notice Epoch data by epochId
    mapping(uint256 => EpochInfo) public epochs;

    /// @notice Amount already claimed per epoch per account
    mapping(uint256 => mapping(address => uint256)) public claimed;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event EpochSet(uint256 indexed epochId, bytes32 root, uint256 epochTotal);
    event Claimed(uint256 indexed epochId, address indexed account, uint256 amount);
    event EpochCapUpdated(uint256 oldCap, uint256 newCap);
    event EpochExpired(uint256 indexed epochId, uint256 releasedAmount);
    event TokensRescued(address indexed to, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param rewardToken_ ERC20 reward token address
    /// @param fundVault_ FundVaultV01 address (for reference)
    /// @param epochCap_ Initial per-epoch cap
    /// @param maxEpochCap_ Immutable maximum for epochCap
    /// @param admin_ DEFAULT_ADMIN_ROLE holder (Timelock)
    /// @param guardian_ GUARDIAN_ROLE holder
    constructor(
        address rewardToken_,
        address fundVault_,
        uint256 epochCap_,
        uint256 maxEpochCap_,
        address admin_,
        address guardian_
    ) {
        if (rewardToken_ == address(0) || fundVault_ == address(0)) revert ZeroAddress();
        if (epochCap_ > maxEpochCap_) revert EpochCapExceedsMax(epochCap_, maxEpochCap_);

        rewardToken = IERC20(rewardToken_);
        fundVault = fundVault_;
        maxEpochCap = maxEpochCap_;
        epochCap = epochCap_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, guardian_);
    }

    // -------------------------------------------------------------------------
    // Admin: epoch management
    // -------------------------------------------------------------------------

    /// @notice Register a new reward epoch with a Merkle root
    /// @dev epochId cannot be overwritten once set
    /// @param epochId Unique epoch identifier
    /// @param root Merkle root of (account, amount) leaves
    /// @param epochTotal Total rewards allocated for this epoch
    function setEpoch(
        uint256 epochId,
        bytes32 root,
        uint256 epochTotal
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (epochs[epochId].exists) revert EpochAlreadyExists(epochId);
        if (root == bytes32(0)) revert InvalidRoot();
        if (epochTotal == 0) revert InvalidEpochTotal();
        if (epochTotal > epochCap) revert EpochTotalExceedsCap(epochTotal, epochCap);

        uint256 required = totalUnclaimed + epochTotal;
        uint256 available = rewardToken.balanceOf(address(this));
        if (available < required) revert InsufficientRewardBalance(required, available);

        totalUnclaimed += epochTotal;

        epochs[epochId] = EpochInfo({
            root: root,
            epochTotal: epochTotal,
            claimedTotal: 0,
            exists: true,
            expired: false
        });

        emit EpochSet(epochId, root, epochTotal);
    }

    /// @notice Update the per-epoch cap
    /// @param newCap New cap value; must be <= maxEpochCap
    function setEpochCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCap > maxEpochCap) revert EpochCapExceedsMax(newCap, maxEpochCap);
        emit EpochCapUpdated(epochCap, newCap);
        epochCap = newCap;
    }

    // -------------------------------------------------------------------------
    // Guardian: pause / unpause
    // -------------------------------------------------------------------------

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Claim
    // -------------------------------------------------------------------------

    /// @notice Claim rewards for a given epoch
    /// @param epochId Target epoch
    /// @param account Recipient address (must match leaf)
    /// @param amount Total entitled amount (as encoded in Merkle leaf)
    /// @param proof Merkle proof
    function claim(
        uint256 epochId,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external whenNotPaused {
        EpochInfo storage epoch = epochs[epochId];
        if (!epoch.exists) revert EpochDoesNotExist(epochId);
        if (epoch.expired) revert EpochExpiredCannotClaim(epochId);

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(account, amount));
        if (!MerkleProof.verify(proof, epoch.root, leaf)) revert InvalidMerkleProof();

        // Compute claimable (supports incremental claims)
        uint256 alreadyClaimed = claimed[epochId][account];
        if (amount <= alreadyClaimed) revert NothingToClaim();
        uint256 claimableAmount = amount - alreadyClaimed;

        // Invariant: claimedTotal + claimableAmount <= epochTotal
        uint256 newClaimedTotal = epoch.claimedTotal + claimableAmount;
        if (newClaimedTotal > epoch.epochTotal) revert EpochOverflow(newClaimedTotal, epoch.epochTotal);

        // Update state before transfer
        claimed[epochId][account] = amount; // = alreadyClaimed + claimableAmount
        epoch.claimedTotal = newClaimedTotal;
        totalUnclaimed -= claimableAmount;

        // Transfer rewards
        rewardToken.safeTransfer(account, claimableAmount);

        emit Claimed(epochId, account, claimableAmount);
    }

    // -------------------------------------------------------------------------
    // Admin: epoch expiry + token rescue
    // -------------------------------------------------------------------------

    /// @notice Expire an epoch, releasing its unclaimed allocation from totalUnclaimed
    /// @dev After expiry, users can no longer claim from this epoch.
    ///      Freed tokens become surplus and can be recovered via rescueTokens().
    function expireEpoch(uint256 epochId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        EpochInfo storage epoch = epochs[epochId];
        if (!epoch.exists) revert EpochDoesNotExist(epochId);
        if (epoch.expired) revert EpochAlreadyExpired(epochId);

        uint256 released = epoch.epochTotal - epoch.claimedTotal;
        epoch.expired = true;
        totalUnclaimed -= released;

        emit EpochExpired(epochId, released);
    }

    /// @notice Recover surplus tokens (balance above totalUnclaimed) to a given address
    /// @dev Protects allocated funds: only the excess above totalUnclaimed can be rescued
    function rescueTokens(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 surplus = rewardToken.balanceOf(address(this)) - totalUnclaimed;
        if (surplus == 0 || amount == 0) revert NothingToRescue();
        uint256 transferAmount = amount > surplus ? surplus : amount;
        rewardToken.safeTransfer(to, transferAmount);
        emit TokensRescued(to, transferAmount);
    }

    /// @notice View how much an account can still claim in an epoch
    function claimable(uint256 epochId, address account, uint256 amount) external view returns (uint256) {
        EpochInfo storage epoch = epochs[epochId];
        if (!epoch.exists || epoch.expired) return 0;
        uint256 alreadyClaimed = claimed[epochId][account];
        if (amount <= alreadyClaimed) return 0;
        return amount - alreadyClaimed;
    }
}
