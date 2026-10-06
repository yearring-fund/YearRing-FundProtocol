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

/// @title FundVaultV01
/// @notice 100% reserve ERC4626 vault for on-chain fund V01
/// @dev Inherits ERC4626 + ERC20Snapshot + AccessControl; shares have 18 decimals via _decimalsOffset=12
contract FundVaultV01 is ERC4626, ERC20Snapshot, ERC20Permit, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles (Phase 2)
    // -------------------------------------------------------------------------

    /// @notice Can set mode to Paused and pause deposits/redeems. Cannot reset user balances.
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    /// @notice Reserved for strategy contract upgrade authority. V3 initial scope: strategy contracts only.
    ///         NOTE: FundVaultV01 is non-upgradeable (no proxy). This role constant is defined for
    ///         forward compatibility only and is NOT granted or used in any function in this version.
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");

    /// @notice Reserved for governance signal proposal submission. V3: signal/ranking only, no execution.
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
    error InvalidRatio();
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
    ///         Locked shares are included in snapshot allocation but cannot be burned directly —
    ///         caller must first earlyExitWithReturn() or unlock() to recover free shares.
    error InsufficientFreeBalance(uint256 required, uint256 available);
    /// @notice Thrown when deposit receiver is not on the allowlist.
    ///         Allowlist controls "entry to become a shareholder"; existing holders may still redeem.
    error NotAllowed();

    // -------------------------------------------------------------------------
    // Enums and structs
    // -------------------------------------------------------------------------

    /// @notice Three-state operating mode (V3 frozen spec):
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
        uint256 snapshotTimestamp;  // block.timestamp at snapshot — used to query LockLedger historical balance
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

    /// @notice Whether transferToStrategyManager is enabled
    bool public externalTransfersEnabled;

    /// @notice Address that receives management fees
    address public treasury;

    /// @notice Strategy manager address
    address public strategyManager;

    /// @notice LockLedgerV02 address — used to include locked shares in exit round snapshots.
    ///         Optional: if zero, only free ERC20 balances are counted.
    address public lockLedger;

    /// @notice Invite-only deposit allowlist — controls entry to become a shareholder.
    ///         Only the receiver of new shares is checked; existing holders may always redeem.
    ///         Managed by DEFAULT_ADMIN_ROLE (should be via Timelock per D2 governance rules).
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
    // Reserve band constants (V3 frozen spec)
    // -------------------------------------------------------------------------

    /// @notice Minimum vault reserve ratio; auto-rebalance trigger if reserve falls below this
    uint256 public constant RESERVE_FLOOR_BPS   = 1500;   // 15%

    /// @notice Target vault reserve ratio; rebalance moves toward this point
    uint256 public constant RESERVE_TARGET_BPS  = 3000;   // 30%

    /// @notice Maximum vault reserve ratio before excess is deployed to strategy
    uint256 public constant RESERVE_CEILING_BPS = 3500;   // 35%

    /// @notice Hard cap: strategy deployment must not exceed this fraction of totalAssets
    uint256 public constant MAX_STRATEGY_DEPLOY_BPS = 7000; // 70%

    // -------------------------------------------------------------------------
    // Rebalance state (V3)
    // -------------------------------------------------------------------------

    /// @notice Minimum interval between rebalance() calls (permissionless, cooldown-guarded)
    uint256 public constant REBALANCE_COOLDOWN = 1 hours;

    /// @notice Timestamp of last rebalance execution (0 = never called)
    uint256 public lastRebalanceTime;

    /// @notice Minimum fraction of totalAssets that must remain in vault as liquid reserve (in bps)
    /// @dev 10_000 = 100% (full reserve, no funds leave vault until admin lowers this).
    ///      e.g. set to 3000 = 30% to allow 70% deployment to StrategyManagerV01.
    uint256 public reserveRatioBps = 10_000;

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
    event ReserveRatioUpdated(uint256 oldBps, uint256 newBps);
    event ModeChanged(SystemMode indexed newMode);
    event ExitRoundOpened(uint256 indexed roundId, uint256 snapshotId, uint256 snapshotTotalSupply, uint256 availableAssets);
    event ExitRoundClosed(uint256 indexed roundId, uint256 totalClaimed);
    event ExitAssetsClaimed(uint256 indexed roundId, address indexed user, uint256 shares, uint256 assets);
    event RebalanceTriggered(uint256 reserveBps, uint8 direction, uint256 amount);
    event RebalanceNoOp(uint256 reserveBps);
    event RebalanceDivestFailed(uint256 amountRequested);
    /// @notice Emitted when reserve > RESERVE_CEILING_BPS (35%) but auto-deploy is intentionally
    ///         NOT performed — admin must explicitly re-deploy via transferToStrategyManager().
    event RebalanceNeedsReview(uint256 reserveBps);
    /// @notice Emitted when an address is added to the deposit allowlist
    event AllowlistAdded(address indexed account);
    /// @notice Emitted when an address is removed from the deposit allowlist
    event AllowlistRemoved(address indexed account);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param asset_ Underlying asset (USDC)
    /// @param name_ ERC20 name of shares
    /// @param symbol_ ERC20 symbol of shares
    /// @param treasury_ Initial treasury address
    /// @param admin_ Timelock / DEFAULT_ADMIN_ROLE holder
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address treasury_,
        address admin_
    ) ERC4626(asset_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (treasury_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }

        treasury = treasury_;
        lastFeeAccrual = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // ERC4626 + ERC20Snapshot overrides
    // -------------------------------------------------------------------------

    /// @dev Offset makes shares 18 decimals when underlying is 6 decimals
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }

    /// @dev Required override for ERC20 + ERC20Snapshot multiple inheritance
    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /// @notice Total assets = vault balance + all assets managed by strategyManager
    /// @dev When funds are transferred to strategyManager, vault balance drops but
    ///      strategyManager.totalManagedAssets() increases by the same amount,
    ///      keeping totalAssets() constant and preserving pricePerShare.
    function totalAssets() public view override returns (uint256) {
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (strategyManager == address(0)) return vaultBalance;
        return vaultBalance + IStrategyManagerV01(strategyManager).totalManagedAssets();
    }

    /// @dev Disable mint() — not in V01 spec
    function mint(uint256, address) public pure override returns (uint256) {
        revert FunctionNotSupported();
    }

    /// @dev Disable withdraw() — not in V01 spec
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
    ///      Deposits are blocked in Paused and EmergencyExit modes (V3 frozen spec).
    ///      The receiver must be on the allowlist — allowlist controls entry to become a shareholder.
    ///      Existing shareholders may always redeem regardless of allowlist status.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (depositsPaused || systemMode != SystemMode.Normal) revert DepositsArePaused();
        if (!isAllowed[receiver]) revert NotAllowed();
        accrueManagementFee();
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Hook: check redeemsPaused and system mode before any redeem.
    ///      In EmergencyExit mode, normal redeem() is blocked — users must use claimExitAssets().
    ///      This enforces a single pricing path during emergency wind-down (V3 D1 frozen decision).
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
        super._withdraw(caller, receiver, owner, assets, shares);
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

    /// @notice Price per share expressed in asset decimals (1e6 = 1 USDC)
    /// @dev Equivalent to convertToAssets(1 full share token = 10^decimals())
    function pricePerShare() external view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    // -------------------------------------------------------------------------
    // Management fee
    // -------------------------------------------------------------------------

    /// @notice Accrue management fee by minting shares to treasury
    /// @dev Anyone can call; idempotent if called multiple times within same block.
    ///      No fees are accrued in EmergencyExit mode; clock advances to prevent backdating
    ///      when mode returns to Normal (V3 D2 frozen decision).
    function accrueManagementFee() public {
        // EmergencyExit: advance clock but mint nothing — no backdated fees on mode return
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

        // fee = supply * bps * elapsed / (BPS_DENOMINATOR * SECONDS_PER_MONTH)
        uint256 feeShares = (supply * mgmtFeeBpsPerMonth * elapsed) /
            (BPS_DENOMINATOR * SECONDS_PER_MONTH);

        if (feeShares == 0) return;

        _mint(treasury, feeShares);
        emit ManagementFeeAccrued(feeShares, block.timestamp);
    }

    /// @notice Update management fee rate
    /// @param newBps New rate in basis points per month
    function setMgmtFeeBpsPerMonth(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_MGMT_FEE_BPS_PER_MONTH) revert FeeTooHigh();
        accrueManagementFee(); // settle at old rate first
        emit MgmtFeeUpdated(mgmtFeeBpsPerMonth, newBps);
        mgmtFeeBpsPerMonth = newBps;
    }

    /// @notice Update treasury address
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // -------------------------------------------------------------------------
    // Pause controls
    // EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE can pause.
    // Only DEFAULT_ADMIN_ROLE can unpause (prevents emergency role from cycling).
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
    // Controls deposit entry. Removal does not affect existing holdings or exit rights.
    // Per D2 governance rules, these functions should be called via Timelock in production.
    // -------------------------------------------------------------------------

    /// @notice Add an address to the deposit allowlist
    function addToAllowlist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        isAllowed[account] = true;
        emit AllowlistAdded(account);
    }

    /// @notice Remove an address from the deposit allowlist
    /// @dev Removal only prevents new deposits. Existing shares and exit rights are unaffected.
    function removeFromAllowlist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isAllowed[account] = false;
        emit AllowlistRemoved(account);
    }

    // -------------------------------------------------------------------------
    // Module management (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Update strategy manager address
    function setModules(address strategyManager_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (strategyManager_ == address(0)) revert ZeroAddress();
        strategyManager = strategyManager_;
        emit ModulesUpdated(strategyManager_);
    }

    /// @notice Set the LockLedgerV02 address for exit round economic snapshot
    /// @dev Pass address(0) to disable locked-share inclusion in exit rounds
    function setLockLedger(address lockLedger_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lockLedger = lockLedger_;
        emit LockLedgerSet(lockLedger_);
    }

    /// @notice Enable or disable external transfers to strategy manager
    function setExternalTransfersEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        externalTransfersEnabled = enabled;
        emit ExternalTransfersEnabled(enabled);
    }

    /// @notice How much can be sent to strategyManager while keeping reserve intact
    function availableToInvest() public view returns (uint256) {
        uint256 total = totalAssets();
        uint256 requiredReserve = (total * reserveRatioBps) / BPS_DENOMINATOR;
        uint256 vaultBalance = IERC20(asset()).balanceOf(address(this));
        if (vaultBalance <= requiredReserve) return 0;
        return vaultBalance - requiredReserve;
    }

    /// @notice Transfer USDC to strategy manager
    /// @dev Enforces reserveRatioBps AND MAX_STRATEGY_DEPLOY_BPS hard cap (70%).
    function transferToStrategyManager(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (systemMode != SystemMode.Normal) revert NotInNormalMode();
        if (!externalTransfersEnabled) revert ExternalTransfersDisabled();
        if (strategyManager == address(0)) revert ZeroAddress();
        accrueManagementFee();
        // Hard cap: total strategy deployment must not exceed 70% of totalAssets
        uint256 total = totalAssets();
        if (total > 0) {
            uint256 strategyAssets = IStrategyManagerV01(strategyManager).totalManagedAssets();
            if ((strategyAssets + amount) * BPS_DENOMINATOR > total * MAX_STRATEGY_DEPLOY_BPS)
                revert MaxDeployExceeded();
        }
        if (amount > availableToInvest()) revert ReserveTooLow();
        IERC20(asset()).safeTransfer(strategyManager, amount);
        emit TransferredToStrategyManager(amount);
    }

    /// @notice Update the reserve ratio
    /// @param newBps New reserve ratio in basis points (e.g. 1000 = 10%)
    function setReserveRatioBps(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > BPS_DENOMINATOR) revert InvalidRatio();
        emit ReserveRatioUpdated(reserveRatioBps, newBps);
        reserveRatioBps = newBps;
    }

    // -------------------------------------------------------------------------
    // System Mode controls
    // -------------------------------------------------------------------------

    /// @notice Set the system operating mode.
    ///   EMERGENCY_ROLE may only set Paused (the "brake").
    ///   DEFAULT_ADMIN_ROLE may set any mode, including EmergencyExit.
    ///
    ///   Fee clock rules on mode transition:
    ///   - Entering EmergencyExit: accrueManagementFee() is called first to settle pending fees.
    ///   - Leaving EmergencyExit: lastFeeAccrual is advanced to block.timestamp so the EmergencyExit
    ///     period is not backdated when Normal mode resumes.
    function setMode(SystemMode newMode) external {
        if (newMode == SystemMode.Paused) {
            // Both emergency and admin can hit the brake
            if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
                revert UnauthorizedCaller();
        } else {
            // Normal or EmergencyExit: admin only
            _checkRole(DEFAULT_ADMIN_ROLE);
        }

        SystemMode oldMode = systemMode;

        // Entering EmergencyExit: settle any pending fee at the current rate before fee pause begins
        if (newMode == SystemMode.EmergencyExit && oldMode != SystemMode.EmergencyExit) {
            accrueManagementFee();
        }

        // Leaving EmergencyExit: advance clock so no backdated fee for the paused period
        if (oldMode == SystemMode.EmergencyExit && newMode != SystemMode.EmergencyExit) {
            lastFeeAccrual = block.timestamp;
        }

        systemMode = newMode;
        emit ModeChanged(newMode);
    }

    /// @notice Open an exit round — takes a snapshot of share balances and records available assets
    /// @param availableAssets_ Amount of USDC available in this round for pro-rata claims
    function openExitModeRound(uint256 availableAssets_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (systemMode != SystemMode.EmergencyExit) revert RequiresEmergencyExitMode();
        if (currentRoundId > 0 && exitRounds[currentRoundId].isOpen) revert RoundAlreadyOpen();

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

    /// @notice Close the current exit round, preventing further claims
    function closeExitModeRound() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (currentRoundId == 0 || !exitRounds[currentRoundId].isOpen) revert NoExitRoundOpen();
        exitRounds[currentRoundId].isOpen = false;
        emit ExitRoundClosed(currentRoundId, exitRounds[currentRoundId].totalClaimed);
    }

    /// @notice Claim pro-rata assets from an open exit round by burning shares
    /// @param roundId The round to claim from
    /// @param sharesToBurn Number of shares to burn in exchange for assets
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
    // Permissionless rebalance (V3, Path C)
    // Cooldown-guarded; no-op if within reserve band; only moves toward target.
    // -------------------------------------------------------------------------

    /// @notice Rebalance reserve toward RESERVE_TARGET_BPS (30%).
    ///         Permissionless but enforces REBALANCE_COOLDOWN between calls.
    ///         Pull direction only (reserve < RESERVE_FLOOR_BPS): calls returnForRebalance().
    ///         When reserve > RESERVE_CEILING_BPS, emits RebalanceNeedsReview — admin must
    ///         manually re-deploy via transferToStrategyManager() per §3 spec requirement.
    /// @dev Pull path calls strategyManager.returnForRebalance(); a failure emits
    ///      RebalanceDivestFailed rather than reverting so callers are never griefed.
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

        // No-op if already within the acceptable band
        if (reserveBps >= RESERVE_FLOOR_BPS && reserveBps <= RESERVE_CEILING_BPS) {
            emit RebalanceNoOp(reserveBps);
            return;
        }

        uint256 targetReserve = (total * RESERVE_TARGET_BPS) / BPS_DENOMINATOR;

        if (reserveBps > RESERVE_CEILING_BPS) {
            // Reserve too high: do NOT auto-deploy — requires admin review per §3 spec.
            // Admin must explicitly call transferToStrategyManager() to re-deploy.
            emit RebalanceNeedsReview(reserveBps);
        } else {
            // Reserve too low: request strategy to return funds toward target
            uint256 toPull = targetReserve - vaultBalance;
            try IStrategyManagerV01(strategyManager).returnForRebalance(toPull) {
                emit RebalanceTriggered(reserveBps, 2, toPull);
            } catch {
                emit RebalanceDivestFailed(toPull);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Chainlink Automation V4 interface stubs
    // Enables future keeper integration without code migration.
    // -------------------------------------------------------------------------

    /// @notice Chainlink Automation V4: reports whether rebalance is needed.
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
        // Only signal upkeep for pull direction (< floor); > ceiling requires admin review, not automation.
        upkeepNeeded = (reserveBps < RESERVE_FLOOR_BPS);
        performData  = "";
    }

    /// @notice Chainlink Automation V4: execute rebalance if needed.
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
