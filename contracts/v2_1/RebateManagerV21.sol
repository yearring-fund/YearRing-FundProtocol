// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./interfaces/IRebateManagerV21.sol";
import "./interfaces/ITreasuryV21.sol";
import "./interfaces/ILockManagerV21.sol";

/// @title RebateManagerV21
/// @notice Orchestrates yrUSDC rebate payouts for YearRing V2.1 lock holders.
///
/// Claim flow (single atomic transaction)
/// ----------------------------------------
/// 1. Verify caller is the lock owner.
/// 2. Verify lock status is Active or Exited (EarlyExited = rebate already forfeited).
/// 3. LockManager.claimRebateOf(lockId):
///      a. Auto-checkpoints bonus Points + rebate (no-op for Exited locks — already done at unlock).
///      b. Zeroes lock.claimableRebateUSDC.
///      c. Returns claimedUSDC (USDC 6-dec).
/// 4. Convert: yrUSDCAmount = CoreVault.convertToShares(claimedUSDC).
/// 5. Treasury.ensureLiquidity(yrUSDCAmount) — attempts to settle fee units if reserve is low.
/// 6. Verify Treasury.yrUSDCBalance() >= yrUSDCAmount.
///    Reverts InsufficientRebateReserve if insufficient.
/// 7. Treasury.withdrawRebate(owner, yrUSDCAmount) — transfers yrUSDC to owner.
///
/// Atomic safety: if any step after (3) reverts, the entire transaction reverts,
/// restoring lock.claimableRebateUSDC to its pre-call value.
contract RebateManagerV21 is IRebateManagerV21, AccessControl, ReentrancyGuard {

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotLockOwner(uint256 lockId, address caller);
    error LockNotClaimable(uint256 lockId);
    error NothingToClaim(uint256 lockId);
    error InsufficientRebateReserve(uint256 required, uint256 available);
    error ZeroAddress();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event RebateClaimed(
        uint256 indexed lockId,
        address indexed owner,
        uint256 claimedUSDC,
        uint256 yrUSDCPaid
    );
    event LockManagerSet(address indexed lockManager_);
    event TreasurySet(address indexed treasury_);

    // -------------------------------------------------------------------------
    // Immutable
    // -------------------------------------------------------------------------

    /// @inheritdoc IRebateManagerV21
    address public immutable override coreVault;

    // -------------------------------------------------------------------------
    // Mutable configuration
    // -------------------------------------------------------------------------

    /// @inheritdoc IRebateManagerV21
    address public override lockManager;

    /// @inheritdoc IRebateManagerV21
    address public override treasury;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param coreVault_   YearRingCoreVaultV21 address (immutable — used for convertToShares)
    /// @param lockManager_ LockManagerV21 address
    /// @param treasury_    TreasuryV21 address
    /// @param admin_       DEFAULT_ADMIN_ROLE holder
    constructor(
        address coreVault_,
        address lockManager_,
        address treasury_,
        address admin_
    ) {
        if (coreVault_ == address(0) || admin_ == address(0)) revert ZeroAddress();

        coreVault   = coreVault_;
        lockManager = lockManager_;
        treasury    = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // IRebateManagerV21 — claim
    // -------------------------------------------------------------------------

    /// @inheritdoc IRebateManagerV21
    function claimRebate(uint256 lockId) external override nonReentrant {
        // ── 1. Load lock and verify caller ────────────────────────────────────
        ILockManagerV21.LockInfo memory lock = ILockManagerV21(lockManager).getLock(lockId);
        if (msg.sender != lock.owner) revert NotLockOwner(lockId, msg.sender);

        // ── 2. Status gate ────────────────────────────────────────────────────
        //    Active  → can claim (may have uncollected rebate)
        //    Exited  → can claim (rebate checkpointed at unlock)
        //    EarlyExited → cannot claim (rebate forfeited at earlyExit)
        //    None    → lock doesn't exist
        if (lock.status == ILockManagerV21.LockStatus.EarlyExited ||
            lock.status == ILockManagerV21.LockStatus.None)
            revert LockNotClaimable(lockId);

        // ── 3. Claim from LockManager (auto-checkpoint + zero + return) ───────
        //    If anything after this line reverts, the tx reverts atomically and
        //    claimableRebateUSDC is restored in LockManager.
        uint256 claimedUSDC = ILockManagerV21(lockManager).claimRebateOf(lockId);
        if (claimedUSDC == 0) revert NothingToClaim(lockId);

        // ── 4. Convert USDC amount to yrUSDC ─────────────────────────────────
        uint256 yrUSDCAmount = IERC4626(coreVault).convertToShares(claimedUSDC);
        if (yrUSDCAmount == 0) revert NothingToClaim(lockId);

        // ── 5. Attempt to top up Treasury from fee units ─────────────────────
        ITreasuryV21(treasury).ensureLiquidity(yrUSDCAmount);

        // ── 6. Verify Treasury has enough yrUSDC ──────────────────────────────
        uint256 bal = ITreasuryV21(treasury).yrUSDCBalance();
        if (bal < yrUSDCAmount)
            revert InsufficientRebateReserve(yrUSDCAmount, bal);

        // ── 7. Pay out ────────────────────────────────────────────────────────
        ITreasuryV21(treasury).withdrawRebate(msg.sender, yrUSDCAmount);

        emit RebateClaimed(lockId, msg.sender, claimedUSDC, yrUSDCAmount);
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    function setLockManager(address lockManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lockManager = lockManager_;
        emit LockManagerSet(lockManager_);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }
}
