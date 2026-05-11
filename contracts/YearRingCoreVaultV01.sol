// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IStrategyManagerV01.sol";
import "./interfaces/ILockLedgerV02.sol";

/// @title YearRingCoreVaultV01
/// @notice ERC4626 core vault for YearRing Fund Protocol closed beta.
///         Closed beta: single vault for USDC (yrUSDC shares). Future versions deploy
///         separate vault instances per underlying asset (yrUSDT, etc.).
/// @dev Inherits ERC4626 + ERC20Snapshot + AccessControl; shares have 18 decimals via _decimalsOffset=12.
///      Management fee is initialized at deploy time (closed beta default: 4 bps/month).
///      Treasury must be TreasuryV02 contract — not an EOA.
///
///      Reserve band (applies to all auto and manual capital movements):
///        MIN_RESERVE_BPS  =  5%  — auto pull from strategy if reserve falls below
///        TARGET_RESERVE_BPS = 10% — rebalance target
///        MAX_RESERVE_BPS  = 15%  — auto push to strategy if reserve exceeds
///        MAX_STRATEGY_DEPLOY_BPS = 70% — hard cap on total strategy allocation
contract YearRingCoreVaultV01 is ERC4626, ERC20Snapshot, ERC20Permit, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Can set mode to Paused and pause deposits/redeems. Cannot reset user balances.
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    /// @notice Reserved for strategy contract upgrade authority. Non-upgradeable vault;
    ///         defined for forward compatibility only — not granted or used in this version.
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");

    /// @notice Reserved for governance signal proposal submission (signal-only, no execution).
    bytes32 public constant PROPOSER_ROLE  = keccak256("PROPOSER_ROLE");

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error DepositsArePaused();
    error RedeemsArePaused();
    error ExternalTransfersDisabled();
    error FunctionNotSupported();
    error ZeroAddress();
    error FeeTooHigh();
    error ReserveTooLow();
    error NotInNormalMode();
    error RequiresEmergencyExitMode();
    error MaxDeployExceeded();
    error RebalanceCooldown();
    error UnauthorizedCaller();
    error ExitRoundNotOpen();
    error RoundAlreadyOpen();
    error NoExitRoundOpen();
    error InsufficientSnapshotAllocation();
    error InsufficientRoundAssets();
    /// @notice Thrown when redeem() is called in EmergencyExit mode; use claimExitAssets() instead.
    error UseClaimExitAssets();
    /// @notice Thrown when sharesToBurn exceeds the caller's free (unlocked) balance.
    error InsufficientFreeBalance(uint256 required, uint256 available);
    /// @notice Thrown when deposit receiver is not on the allowlist.
    error NotAllowed();
    /// @notice Thrown when vault + strategy cannot supply enough USDC to cover a redeem.
    ///         Burns are blocked until sufficient liquidity is available.
    error InsufficientVaultLiquidity(uint256 required, uint256 available);

    // -------------------------------------------------------------------------
    // Enums and structs
    // -------------------------------------------------------------------------

    /// @notice Three-state operating mode:
    ///   Normal       — all operations permitted within configured limits
    ///   Paused       — new deposits blocked; redemptions and emergency paths remain open
    ///   EmergencyExit — deposits and normal redeem() blocked; only claimExitAssets() allowed;
    ///                   management fee accrual paused; no new strategy deployment
    enum SystemMode { Normal, Paused, EmergencyExit }
    SystemMode public systemMode;

    struct ExitRound {
        uint256 snapshotId;
        uint256 snapshotTotalSupply;
        uint256 availableAssets;
        uint256 totalClaimed;
        bool    isOpen;
        uint256 snapshotTimestamp;
    }

    mapping(uint256 => ExitRound) public exitRounds;
    uint256 public currentRoundId;
    mapping(uint256 => mapping(address => uint256)) public roundSharesClaimed;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Whether new deposits are paused
    bool public depositsPaused;

    /// @notice Whether redemptions are paused
    bool public redeemsPaused;

    /// @notice Whether transferToStrategyManager and auto-push are enabled
    bool public externalTransfersEnabled;

    /// @notice Address that receives management fees (must be TreasuryV02)
    address public treasury;

    /// @notice Strategy manager address
    address public strategyManager;

    /// @notice LockLedger address — used to include locked yrCORE shares in exit round snapshots.
    ///         Optional: if zero, only free ERC20 balances are counted.
    address public lockLedger;

    /// @notice Invite-only deposit allowlist — controls entry to become a shareholder.
    ///         Only the receiver of new shares is checked; existing holders may always redeem.
    mapping(address => bool) public isAllowed;

    /// @notice Monthly management fee in basis points (1 bps = 0.01%)
    uint256 public mgmtFeeBpsPerMonth;

    /// @notice Timestamp of last fee accrual
    uint256 public lastFeeAccrual;

    /// @notice Maximum management fee: 2% per month = 200 bps
    uint256 public constant MAX_MGMT_FEE_BPS_PER_MONTH = 200;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // -------------------------------------------------------------------------
    // Reserve band constants
    // -------------------------------------------------------------------------

    /// @notice Minimum vault reserve ratio (5%); auto pull from strategy if reserve falls below
    uint256 public constant MIN_RESERVE_BPS    = 500;

    /// @notice Target vault reserve ratio (10%); rebalance moves toward this point
    uint256 public constant TARGET_RESERVE_BPS = 1000;

    /// @notice Maximum vault reserve ratio (15%); auto push excess to strategy if reserve exceeds
    uint256 public constant MAX_RESERVE_BPS    = 1500;

    /// @notice Hard cap: strategy deployment must not exceed this fraction of totalAssets (70%)
    uint256 public constant MAX_STRATEGY_DEPLOY_BPS = 7000;

    // -------------------------------------------------------------------------
    // Rebalance state
    // -------------------------------------------------------------------------

    /// @notice Minimum interval between standalone rebalance() calls
    uint256 public constant REBALANCE_COOLDOWN = 1 hours;

    /// @notice Timestamp of last standalone rebalance() execution (0 = never called)
    uint256 public lastRebalanceTime;

    /// @notice Seconds per month (30 days)
    uint256 public constant SECONDS_PER_MONTH = 30 days;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event DepositsPaused();
    event DepositsUnpaused();
    event RedeemsPaused();
    event RedeemsUnpaused();
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event MgmtFeeUpdated(uint256 oldBps, uint256 newBps);
    event ManagementFeeAccrued(uint256 feeShares, uint256 timestamp);
    event ExternalTransfersEnabled(bool enabled);
    event ModulesUpdated(address strategyManager);
    event LockLedgerSet(address indexed lockLedger);
    event TransferredToStrategyManager(uint256 amount);
    event ModeChanged(SystemMode indexed newMode);
    event ExitRoundOpened(uint256 indexed roundId, uint256 snapshotId, uint256 snapshotTotalSupply, uint256 availableAssets);
    event ExitRoundClosed(uint256 indexed roundId, uint256 totalClaimed);
    event ExitAssetsClaimed(uint256 indexed roundId, address indexed user, uint256 shares, uint256 assets);
    event RebalanceTriggered(uint256 reserveBps, uint8 direction, uint256 amount);
    event RebalanceNoOp(uint256 reserveBps);
    event RebalanceDivestFailed(uint256 amountRequested);
    event RebalanceDeployFailed(uint256 amountRequested);
    event RebalanceNeedsReview(uint256 reserveBps);
    event AllowlistAdded(address indexed account);
    event AllowlistRemoved(address indexed account);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param asset_       Underlying asset (Base USDC)
    /// @param name_        ERC20 name of shares (e.g. "YearRing USDC Core Vault")
    /// @param symbol_      ERC20 symbol of shares (e.g. "yrUSDC")
    /// @param treasury_    TreasuryV02 contract address — receives management fee shares
    /// @param admin_       DEFAULT_ADMIN_ROLE holder (Timelock in production)
    /// @param mgmtFeeBps_  Initial management fee in bps/month (closed beta default: 4)
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address treasury_,
        address admin_,
        uint256 mgmtFeeBps_
    ) ERC4626(asset_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (treasury_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        if (mgmtFeeBps_ > MAX_MGMT_FEE_BPS_PER_MONTH) revert FeeTooHigh();

        treasury          = treasury_;
        mgmtFeeBpsPerMonth = mgmtFeeBps_;
        lastFeeAccrual    = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // ERC4626 + ERC20Snapshot overrides
    // -------------------------------------------------------------------------

    /// @dev Offset makes yrUSDC shares 18 decimals when underlying USDC is 6 decimals
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }

    /// @dev Required override for ERC20 + ERC20Snapshot multiple inheritance
    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /// @notice Total assets = vault USDC balance + all assets managed by strategyManager
    /// @dev When funds are transferred to strategyManager, vault balance drops but
    ///      strategyManager.totalManagedAssets() increases by the same amount,
    ///      keeping totalAssets() constant and preserving pricePerShare.
    function totalAssets() public view override returns (uint256) {
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (strategyManager == address(0)) return vaultBalance;
        return vaultBalance + IStrategyManagerV01(strategyManager).totalManagedAssets();
    }

    /// @dev Disable mint() — not supported
    function mint(uint256, address) public pure override returns (uint256) {
        revert FunctionNotSupported();
    }

    /// @dev Disable withdraw() — not supported
    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert FunctionNotSupported();
    }

    /// @inheritdoc ERC4626
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    /// @inheritdoc ERC4626
    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256) {
        return super.redeem(shares, receiver, owner);
    }

    /// @dev Hook: check depositsPaused, system mode, and allowlist before any deposit.
    ///      Deposits blocked in Paused and EmergencyExit modes.
    ///      Receiver must be on the allowlist — existing holders may always redeem.
    ///      Auto-rebalance runs after the deposit to push excess reserve to strategy.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (depositsPaused || systemMode != SystemMode.Normal) revert DepositsArePaused();
        if (!isAllowed[receiver]) revert NotAllowed();
        accrueManagementFee();
        super._deposit(caller, receiver, assets, shares);
        _autoRebalance();
    }

    /// @dev Hook: check redeemsPaused and system mode before any redeem.
    ///      In EmergencyExit mode, normal redeem() is blocked — users must use claimExitAssets().
    ///
    ///      Pre-pull liquidity guarantee:
    ///        If vault USDC balance < assets required for this redeem, first attempt to pull
    ///        the shortfall from strategyManager. If after the pull the vault still lacks
    ///        sufficient funds, revert BEFORE burning shares — user keeps their position.
    ///
    ///      Auto-rebalance runs after the redeem to pull reserve back toward TARGET if needed.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (redeemsPaused) revert RedeemsArePaused();
        if (systemMode == SystemMode.EmergencyExit) revert UseClaimExitAssets();
        accrueManagementFee();

        // Pre-pull: ensure vault has enough USDC to cover this redeem before burning shares.
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (vaultBalance < assets && strategyManager != address(0)) {
            uint256 shortfall = assets - vaultBalance;
            try IStrategyManagerV01(strategyManager).returnForRebalance(shortfall) {} catch {}
            vaultBalance = IERC20(asset()).balanceOf(address(this));
            if (vaultBalance < assets)
                revert InsufficientVaultLiquidity(assets, vaultBalance);
        }

        super._withdraw(caller, receiver, owner, assets, shares);
        _autoRebalance();
    }

    // -------------------------------------------------------------------------
    // ERC20 decimals override (required due to multiple inheritance)
    // -------------------------------------------------------------------------

    function decimals() public view override(ERC4626, ERC20) returns (uint8) {
        return ERC4626.decimals();
    }

    // -------------------------------------------------------------------------
    // Price / conversion helpers
    // -------------------------------------------------------------------------

    /// @notice Price per share expressed in USDC (6 decimals)
    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    // -------------------------------------------------------------------------
    // Management fee
    // -------------------------------------------------------------------------

    /// @notice Accrue management fee by minting shares to TreasuryV02.
    /// @dev Anyone can call; idempotent if called multiple times within same block.
    ///      No fees accrued in EmergencyExit mode; clock advances to prevent backdating.
    function accrueManagementFee() public {
        if (systemMode == SystemMode.EmergencyExit) {
            lastFeeAccrual = block.timestamp;
            return;
        }
        if (mgmtFeeBpsPerMonth == 0) {
            lastFeeAccrual = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - lastFeeAccrual;
        if (elapsed == 0) return;

        lastFeeAccrual = block.timestamp;

        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 feeShares = (supply * mgmtFeeBpsPerMonth * elapsed) /
            (BPS_DENOMINATOR * SECONDS_PER_MONTH);

        if (feeShares == 0) return;

        _mint(treasury, feeShares);
        emit ManagementFeeAccrued(feeShares, block.timestamp);
    }

    /// @notice Update management fee rate (settles at old rate first)
    function setMgmtFeeBpsPerMonth(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_MGMT_FEE_BPS_PER_MONTH) revert FeeTooHigh();
        accrueManagementFee();
        emit MgmtFeeUpdated(mgmtFeeBpsPerMonth, newBps);
        mgmtFeeBpsPerMonth = newBps;
    }

    /// @notice Update treasury address (should point to TreasuryV02)
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // -------------------------------------------------------------------------
    // Pause controls
    // EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE can pause.
    // Only DEFAULT_ADMIN_ROLE can unpause.
    // -------------------------------------------------------------------------

    function pauseDeposits() external {
        if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert UnauthorizedCaller();
        depositsPaused = true;
        emit DepositsPaused();
    }

    function unpauseDeposits() external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositsPaused = false;
        emit DepositsUnpaused();
    }

    function pauseRedeems() external {
        if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert UnauthorizedCaller();
        redeemsPaused = true;
        emit RedeemsPaused();
    }

    function unpauseRedeems() external onlyRole(DEFAULT_ADMIN_ROLE) {
        redeemsPaused = false;
        emit RedeemsUnpaused();
    }

    // -------------------------------------------------------------------------
    // Allowlist management (DEFAULT_ADMIN_ROLE)
    // Controls deposit entry only. Removal does not affect exit rights.
    // -------------------------------------------------------------------------

    function addToAllowlist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        isAllowed[account] = true;
        emit AllowlistAdded(account);
    }

    function removeFromAllowlist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isAllowed[account] = false;
        emit AllowlistRemoved(account);
    }

    // -------------------------------------------------------------------------
    // Module management (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Set strategy manager address
    function setModules(address strategyManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (strategyManager_ == address(0)) revert ZeroAddress();
        strategyManager = strategyManager_;
        emit ModulesUpdated(strategyManager_);
    }

    /// @notice Set the LockLedger address for exit round snapshot (pass address(0) to disable)
    function setLockLedger(address lockLedger_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lockLedger = lockLedger_;
        emit LockLedgerSet(lockLedger_);
    }

    /// @notice Enable or disable external transfers to strategy manager (affects auto-push and manual transfer)
    function setExternalTransfersEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        externalTransfersEnabled = enabled;
        emit ExternalTransfersEnabled(enabled);
    }

    /// @notice Manually transfer USDC to strategy manager (admin / timelock override).
    ///         Use for special cases: keeper failure, strategy migration, emergency recovery.
    /// @dev Enforces the same rules as auto-push:
    ///      (1) externalTransfersEnabled must be true
    ///      (2) strategy allocation must not exceed MAX_STRATEGY_DEPLOY_BPS (70%)
    ///      (3) vault reserve after transfer must remain >= MIN_RESERVE_BPS (5%)
    function transferToStrategyManager(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (systemMode != SystemMode.Normal) revert NotInNormalMode();
        if (!externalTransfersEnabled) revert ExternalTransfersDisabled();
        if (strategyManager == address(0)) revert ZeroAddress();
        accrueManagementFee();

        uint256 total = totalAssets();
        if (total > 0) {
            uint256 strategyAssets = IStrategyManagerV01(strategyManager).totalManagedAssets();
            if ((strategyAssets + amount) * BPS_DENOMINATOR > total * MAX_STRATEGY_DEPLOY_BPS)
                revert MaxDeployExceeded();
            uint256 minReserve = (total * MIN_RESERVE_BPS) / BPS_DENOMINATOR;
            uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
            if (vaultBalance < amount + minReserve) revert ReserveTooLow();
        }

        IERC20(asset()).safeTransfer(strategyManager, amount);
        emit TransferredToStrategyManager(amount);
    }

    // -------------------------------------------------------------------------
    // System Mode controls
    // -------------------------------------------------------------------------

    /// @notice Set operating mode.
    ///   EMERGENCY_ROLE may only set Paused.
    ///   DEFAULT_ADMIN_ROLE may set any mode including EmergencyExit.
    ///   Fee clock rules:
    ///   - Entering EmergencyExit: accrueManagementFee() called first to settle pending fees.
    ///   - Leaving EmergencyExit: lastFeeAccrual advanced to prevent backdating.
    function setMode(SystemMode newMode) external {
        if (newMode == SystemMode.Paused) {
            if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
                revert UnauthorizedCaller();
        } else {
            _checkRole(DEFAULT_ADMIN_ROLE);
        }

        SystemMode oldMode = systemMode;

        if (newMode == SystemMode.EmergencyExit && oldMode != SystemMode.EmergencyExit) {
            accrueManagementFee();
        }
        if (oldMode == SystemMode.EmergencyExit && newMode != SystemMode.EmergencyExit) {
            lastFeeAccrual = block.timestamp;
        }

        systemMode = newMode;
        emit ModeChanged(newMode);
    }

    /// @notice Open an emergency exit round — snapshots share balances and records available USDC
    function openExitModeRound(uint256 availableAssets_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (systemMode != SystemMode.EmergencyExit) revert RequiresEmergencyExitMode();
        if (currentRoundId > 0 && exitRounds[currentRoundId].isOpen) revert RoundAlreadyOpen();
        accrueManagementFee(); // advances clock even in EmergencyExit (no fee minted)

        currentRoundId++;
        uint256 snapId = _snapshot();
        uint256 snapTimestamp = block.timestamp;
        exitRounds[currentRoundId] = ExitRound({
            snapshotId:          snapId,
            snapshotTotalSupply: totalSupplyAt(snapId),
            availableAssets:     availableAssets_,
            totalClaimed:        0,
            isOpen:              true,
            snapshotTimestamp:   snapTimestamp
        });

        emit ExitRoundOpened(currentRoundId, snapId, totalSupplyAt(snapId), availableAssets_);
    }

    /// @notice Close the current exit round
    function closeExitModeRound() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (currentRoundId == 0 || !exitRounds[currentRoundId].isOpen) revert NoExitRoundOpen();
        accrueManagementFee(); // advances clock even in EmergencyExit (no fee minted)
        exitRounds[currentRoundId].isOpen = false;
        emit ExitRoundClosed(currentRoundId, exitRounds[currentRoundId].totalClaimed);
    }

    /// @notice Claim pro-rata USDC from an open exit round by burning shares.
    ///         Locked shares at snapshot time are included in the user's eligible allocation.
    /// @param roundId      The exit round to claim from
    /// @param sharesToBurn Number of free shares to burn
    function claimExitAssets(uint256 roundId, uint256 sharesToBurn) external nonReentrant {
        ExitRound storage round = exitRounds[roundId];
        if (!round.isOpen) revert ExitRoundNotOpen();

        uint256 freeSnapshotBalance   = balanceOfAt(msg.sender, round.snapshotId);
        uint256 lockedSnapshotBalance = lockLedger != address(0)
            ? ILockLedgerV02(lockLedger).lockedSharesOfAt(msg.sender, round.snapshotTimestamp)
            : 0;
        uint256 snapshotBalance = freeSnapshotBalance + lockedSnapshotBalance;
        uint256 eligible = snapshotBalance - roundSharesClaimed[roundId][msg.sender];
        if (sharesToBurn > eligible) revert InsufficientSnapshotAllocation();

        uint256 assets = (sharesToBurn * round.availableAssets) / round.snapshotTotalSupply;
        if (round.totalClaimed + assets > round.availableAssets) revert InsufficientRoundAssets();

        roundSharesClaimed[roundId][msg.sender] += sharesToBurn;
        round.totalClaimed += assets;

        uint256 freeBalance = balanceOf(msg.sender);
        if (sharesToBurn > freeBalance)
            revert InsufficientFreeBalance(sharesToBurn, freeBalance);

        accrueManagementFee();
        _burn(msg.sender, sharesToBurn);
        IERC20(asset()).safeTransfer(msg.sender, assets);

        emit ExitAssetsClaimed(roundId, msg.sender, sharesToBurn, assets);
    }

    // -------------------------------------------------------------------------
    // Internal auto-rebalance
    // -------------------------------------------------------------------------

    /// @notice Shared reserve rebalance logic used by _deposit, _withdraw, and rebalance().
    ///
    ///   Reserve zones (based on vaultBalance / totalAssets):
    ///     < MIN_RESERVE_BPS  (5%)  → pull from strategy toward TARGET (10%)
    ///     5% – 15%                 → no action
    ///     > MAX_RESERVE_BPS  (15%) → push to strategy toward TARGET (10%)
    ///
    ///   Push path:
    ///     Silently skipped if externalTransfersEnabled == false or systemMode != Normal.
    ///     Capped at MAX_STRATEGY_DEPLOY_BPS (70%); emits RebalanceNeedsReview if cap hit.
    ///     Vault transfers USDC to strategyManager, then calls deployForRebalance().
    ///     If deployForRebalance reverts, USDC stays idle in strategyManager (still tracked).
    ///
    ///   Pull path:
    ///     Uses try/catch — failure emits RebalanceDivestFailed, does not revert.
    ///     (Pre-pull in _withdraw is a separate hard check; this is a best-effort reserve top-up.)
    function _autoRebalance() internal {
        if (strategyManager == address(0)) return;
        if (systemMode != SystemMode.Normal) return;

        uint256 total = totalAssets();
        if (total == 0) return;

        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        uint256 reserveBps   = (vaultBalance * BPS_DENOMINATOR) / total;

        // Within band — nothing to do
        if (reserveBps >= MIN_RESERVE_BPS && reserveBps <= MAX_RESERVE_BPS) return;

        uint256 targetReserve = (total * TARGET_RESERVE_BPS) / BPS_DENOMINATOR;

        if (reserveBps < MIN_RESERVE_BPS) {
            // Pull: reserve too low — pull shortfall from strategy
            uint256 toPull = targetReserve > vaultBalance ? targetReserve - vaultBalance : 0;
            if (toPull == 0) return;
            try IStrategyManagerV01(strategyManager).returnForRebalance(toPull) {
                emit RebalanceTriggered(reserveBps, 2, toPull);
            } catch {
                emit RebalanceDivestFailed(toPull);
            }
        } else {
            // Push: reserve too high — push excess to strategy
            if (!externalTransfersEnabled) return; // silently skip; admin deliberately disabled

            uint256 toPush = vaultBalance > targetReserve ? vaultBalance - targetReserve : 0;
            if (toPush == 0) return;

            // Enforce 70% strategy hard cap
            uint256 strategyAssets = IStrategyManagerV01(strategyManager).totalManagedAssets();
            uint256 maxDeploy = (total * MAX_STRATEGY_DEPLOY_BPS) / BPS_DENOMINATOR;
            if (strategyAssets >= maxDeploy) {
                emit RebalanceNeedsReview(reserveBps);
                return;
            }
            if (strategyAssets + toPush > maxDeploy) {
                toPush = maxDeploy - strategyAssets;
            }
            if (toPush == 0) return;

            // Transfer first, then notify strategy manager to invest
            IERC20(asset()).safeTransfer(strategyManager, toPush);
            try IStrategyManagerV01(strategyManager).deployForRebalance(toPush) {
                emit RebalanceTriggered(reserveBps, 1, toPush);
            } catch {
                // USDC is idle in strategyManager — totalManagedAssets() still tracks it
                emit RebalanceDeployFailed(toPush);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Permissionless rebalance (cooldown-guarded)
    // Shares the same _autoRebalance() logic as deposit/withdraw hooks.
    // Useful as a manual fallback, keeper trigger, or Chainlink Automation target.
    // -------------------------------------------------------------------------

    /// @notice Trigger reserve rebalance manually or via keeper.
    ///         Cooldown-guarded (1 hour) to limit gas costs from external calls.
    ///         Uses the same reserve band logic as deposit/redeem auto-rebalance.
    function rebalance() public nonReentrant {
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) revert RebalanceCooldown();
        lastRebalanceTime = block.timestamp;

        uint256 total = totalAssets();
        if (total == 0 || strategyManager == address(0)) {
            emit RebalanceNoOp(0);
            return;
        }

        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        uint256 reserveBps   = (vaultBalance * BPS_DENOMINATOR) / total;

        if (reserveBps >= MIN_RESERVE_BPS && reserveBps <= MAX_RESERVE_BPS) {
            emit RebalanceNoOp(reserveBps);
            return;
        }

        _autoRebalance();
    }

    // -------------------------------------------------------------------------
    // Chainlink Automation V4 interface stubs
    // -------------------------------------------------------------------------

    function checkUpkeep(bytes calldata)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) return (false, "");
        uint256 total = totalAssets();
        if (total == 0) return (false, "");
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        uint256 reserveBps   = (vaultBalance * BPS_DENOMINATOR) / total;
        upkeepNeeded = (reserveBps < MIN_RESERVE_BPS || reserveBps > MAX_RESERVE_BPS);
        performData  = "";
    }

    function performUpkeep(bytes calldata) external {
        rebalance();
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
