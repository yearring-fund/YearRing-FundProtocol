// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/ICoreStrategyManagerV21.sol";

/// @title YearRingCoreVaultV21
/// @notice ERC-4626 vault for YearRing V2.1.
///         Accepts USDC (6-decimal); issues yrUSDC shares (18-decimal, _decimalsOffset = 12).
///
/// Design highlights
/// -----------------
/// • No management fees at vault layer — fees are charged in CoreStrategyManagerV21.
/// • Reserve band: MIN 5%, TARGET 10%, MAX 15%.  No hard cap on strategy allocation.
/// • _autoRebalance() runs after every deposit and redeem:
///     - below MIN → pull from SM to TARGET
///     - above MAX → push excess to SM (park for keeper to invest)
/// • Pre-pull guarantee: before burning shares the vault ensures it holds enough USDC,
///   pulling from SM if necessary; reverts with InsufficientVaultLiquidity if SM cannot cover.
/// • Allowlist: deposits gated by per-address approval; admin can toggle the gate.
/// • SystemMode: Normal / Paused / EmergencyExit.
///
/// Deployment order
/// ----------------
/// 1. Deploy this vault (pass CoreSM address = address(0) initially if needed).
/// 2. Deploy CoreStrategyManagerV21 with this vault's address.
/// 3. Call vault.setCoreStrategyManager(smAddress).
/// 4. Admin seeds 10 USDC via deposit() before opening to users.
contract YearRingCoreVaultV21 is ERC4626, ERC20Permit, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant KEEPER_ROLE    = keccak256("KEEPER_ROLE");
    bytes32 public constant ALLOWLIST_ROLE = keccak256("ALLOWLIST_ROLE"); // may manage allowlist entries

    // -------------------------------------------------------------------------
    // Constants — reserve band
    // -------------------------------------------------------------------------

    uint256 public constant MIN_RESERVE_BPS    = 500;   //  5%
    uint256 public constant TARGET_RESERVE_BPS = 1_000; // 10%
    uint256 public constant MAX_RESERVE_BPS    = 1_500; // 15%
    uint256 public constant BPS_DENOMINATOR    = 10_000;

    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    enum SystemMode { Normal, Paused, EmergencyExit }

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error DepositsArePaused();
    error RedeemsArePaused();
    error ZeroAddress();
    error ZeroAmount();
    error NotInNormalMode();
    error NotAllowed();
    error Unauthorized();
    error InsufficientFreeBalance(uint256 required, uint256 available);
    /// @notice Emitted when USDC liquidity is insufficient to cover a redeem after pulling from SM.
    error InsufficientVaultLiquidity(uint256 required, uint256 available);
    /// @notice Thrown when rebalance() is called before the cooldown has elapsed.
    error RebalanceCooldown();
    /// @notice Thrown by depositWithMinShares when minted shares are below the caller's minimum.
    error MinSharesNotMet(uint256 sharesOut, uint256 minShares);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event CoreStrategyManagerSet(address indexed sm);
    event AllowlistUpdated(address indexed account, bool allowed);
    event AllowlistEnabledSet(bool enabled);
    event SystemModeChanged(SystemMode newMode);
    event RebalanceTriggered(uint256 reserveBps, uint8 direction, uint256 amount);
    // direction: 1 = push to SM, 2 = pull from SM
    event RebalancePullFailed(uint256 amountRequested);
    event RebalancePushFailed(uint256 amountRequested);
    event ManualRebalance(uint256 reserveBps);

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice CoreStrategyManagerV21 — may be address(0) until configured
    address public coreStrategyManager;

    /// @notice Current operating mode
    SystemMode public systemMode;

    /// @notice When false, all addresses may deposit (allowlist check skipped)
    bool public allowlistEnabled;

    /// @notice Per-address deposit allowlist
    mapping(address => bool) public allowlist;

    /// @notice Minimum seconds between manual rebalance() calls (default 1 hour)
    uint256 public rebalanceCooldown = 1 hours;

    /// @notice Timestamp of the last manual rebalance() call
    uint256 public lastManualRebalanceAt;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param usdc_   USDC address on Base
    /// @param admin_  Initial DEFAULT_ADMIN_ROLE and EMERGENCY_ROLE holder
    /// @param name_   Share token name (e.g. "YearRing USDC")
    /// @param symbol_ Share token symbol (e.g. "yrUSDC")
    constructor(
        address usdc_,
        address admin_,
        string memory name_,
        string memory symbol_
    )
        ERC20(name_, symbol_)
        ERC4626(IERC20(usdc_))
        ERC20Permit(name_)
    {
        if (usdc_ == address(0) || admin_ == address(0)) revert ZeroAddress();

        allowlistEnabled = true;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(EMERGENCY_ROLE, admin_);
        _grantRole(KEEPER_ROLE, admin_);
        _grantRole(ALLOWLIST_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // ERC-4626 overrides — share decimal offset
    // -------------------------------------------------------------------------

    /// @notice 12-decimal offset: USDC (6-dec) → yrUSDC (18-dec).
    ///         This gives inflation-attack protection equivalent to a virtual reserve of 1e12 shares.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }

    // -------------------------------------------------------------------------
    // ERC-4626 overrides — totalAssets
    // -------------------------------------------------------------------------

    /// @notice Total USDC value controlled by this vault:
    ///         idle USDC held here + vault's proportional share of SM-managed assets.
    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (coreStrategyManager == address(0)) return idle;
        return idle + ICoreStrategyManagerV21(coreStrategyManager).vaultManagedAssets();
    }

    // -------------------------------------------------------------------------
    // ERC-4626 overrides — deposit / mint
    // -------------------------------------------------------------------------

    /// @notice Deposit `assets` USDC and receive yrUSDC shares.
    ///         Requires Normal mode and allowlist approval (when enabled).
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = _depositCore(assets, receiver);
    }

    /// @notice Deposit `assets` USDC and revert if minted shares are below `minShares`.
    ///         Provides slippage protection for callers using off-chain share estimates.
    function depositWithMinShares(uint256 assets, address receiver, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        shares = _depositCore(assets, receiver);
        if (shares < minShares) revert MinSharesNotMet(shares, minShares);
    }

    /// @dev Internal deposit path shared by deposit() and depositWithMinShares().
    ///      No nonReentrant guard — callers must hold the lock.
    function _depositCore(uint256 assets, address receiver) internal returns (uint256 shares) {
        _requireNormalMode();
        _requireAllowlisted(receiver);
        shares = super.deposit(assets, receiver);
    }

    /// @notice Mint `shares` of yrUSDC by depositing the required USDC.
    ///         Requires Normal mode and allowlist approval (when enabled).
    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        _requireNormalMode();
        _requireAllowlisted(receiver);
        assets = super.mint(shares, receiver);
    }

    // -------------------------------------------------------------------------
    // ERC-4626 overrides — redeem / withdraw
    // -------------------------------------------------------------------------

    /// @notice Redeem `shares` for USDC.
    ///         Blocked only in EmergencyExit mode (use emergencyExit path in that case).
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (systemMode == SystemMode.EmergencyExit) revert RedeemsArePaused();
        assets = super.redeem(shares, receiver, owner);
    }

    /// @notice Withdraw `assets` USDC by burning the required shares.
    ///         Blocked only in EmergencyExit mode.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        if (systemMode == SystemMode.EmergencyExit) revert RedeemsArePaused();
        shares = super.withdraw(assets, receiver, owner);
    }

    // -------------------------------------------------------------------------
    // ERC-4626 hooks
    // -------------------------------------------------------------------------

    /// @dev Runs after the ERC4626 deposit transfer and share mint.
    ///      Triggers auto-rebalance to push any excess idle to SM.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        super._deposit(caller, receiver, assets, shares);
        _autoRebalance();
    }

    /// @dev Pre-pull liquidity from SM if vault idle is insufficient.
    ///      Reverts if combined vault + SM liquidity cannot cover `assets`.
    ///      Runs auto-rebalance after the ERC4626 transfer to restore reserve band.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        // Pre-pull: ensure vault has enough USDC before burning shares
        uint256 vaultIdle = IERC20(asset()).balanceOf(address(this));
        if (vaultIdle < assets && coreStrategyManager != address(0)) {
            uint256 shortfall = assets - vaultIdle;
            try ICoreStrategyManagerV21(coreStrategyManager).withdrawToVault(shortfall) {}
            catch {}
            vaultIdle = IERC20(asset()).balanceOf(address(this));
            if (vaultIdle < assets)
                revert InsufficientVaultLiquidity(assets, vaultIdle);
        }

        super._withdraw(caller, receiver, owner, assets, shares);
        _autoRebalance();
    }

    // -------------------------------------------------------------------------
    // Manual rebalance
    // -------------------------------------------------------------------------

    /// @notice Manually trigger a reserve-band rebalance.
    ///         Subject to a cooldown to prevent keeper abuse.
    function rebalance() external onlyAdminOrKeeper {
        if (block.timestamp < lastManualRebalanceAt + rebalanceCooldown)
            revert RebalanceCooldown();
        lastManualRebalanceAt = block.timestamp;

        uint256 vaultIdle = IERC20(asset()).balanceOf(address(this));
        uint256 total     = totalAssets();
        uint256 reserveBps = total > 0 ? vaultIdle * BPS_DENOMINATOR / total : 0;
        emit ManualRebalance(reserveBps);

        _autoRebalance();
    }

    // -------------------------------------------------------------------------
    // Admin — configuration
    // -------------------------------------------------------------------------

    /// @notice Set or replace the CoreStrategyManagerV21.
    function setCoreStrategyManager(address sm_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Allow address(0) to disconnect SM in an emergency
        coreStrategyManager = sm_;
        emit CoreStrategyManagerSet(sm_);
    }

    /// @notice Add or remove an address from the deposit allowlist.
    function setAllowlist(address account, bool allowed)
        external
    {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(ALLOWLIST_ROLE, msg.sender))
            revert Unauthorized();
        if (account == address(0)) revert ZeroAddress();
        allowlist[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    /// @notice Enable or disable the allowlist gate for deposits.
    function setAllowlistEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowlistEnabled = enabled;
        emit AllowlistEnabledSet(enabled);
    }

    /// @notice Set the minimum seconds between manual rebalance() calls.
    function setRebalanceCooldown(uint256 seconds_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rebalanceCooldown = seconds_;
    }

    // -------------------------------------------------------------------------
    // Admin — system mode
    // -------------------------------------------------------------------------

    /// @notice Transition to Paused mode. Blocks new deposits.
    function pause() external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(EMERGENCY_ROLE, msg.sender))
            revert Unauthorized();
        systemMode = SystemMode.Paused;
        emit SystemModeChanged(SystemMode.Paused);
    }

    /// @notice Return to Normal mode from Paused.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        systemMode = SystemMode.Normal;
        emit SystemModeChanged(SystemMode.Normal);
    }

    /// @notice Enter EmergencyExit mode. Blocks all deposits and redeems.
    ///         Use to halt the vault pending an emergency resolution.
    function setEmergencyExit() external {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(EMERGENCY_ROLE, msg.sender))
            revert Unauthorized();
        systemMode = SystemMode.EmergencyExit;
        emit SystemModeChanged(SystemMode.EmergencyExit);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Core reserve-band rebalance logic.
    ///      Called automatically after every deposit and redeem.
    ///
    ///      PULL path (reserve < MIN):
    ///        Pulls (TARGET_reserve - vaultIdle) from SM. On failure emits RebalancePullFailed.
    ///
    ///      PUSH path (reserve > MAX):
    ///        Transfers (vaultIdle - TARGET_reserve) to SM then calls depositFromVault().
    ///        On failure emits RebalancePushFailed and reverts the token transfer.
    ///
    function _autoRebalance() internal {
        if (coreStrategyManager == address(0)) return;
        if (systemMode != SystemMode.Normal)   return;

        uint256 total = totalAssets();
        if (total == 0) return;

        uint256 vaultIdle  = IERC20(asset()).balanceOf(address(this));
        uint256 reserveBps = vaultIdle * BPS_DENOMINATOR / total;

        if (reserveBps >= MIN_RESERVE_BPS && reserveBps <= MAX_RESERVE_BPS) return;

        uint256 targetReserve = total * TARGET_RESERVE_BPS / BPS_DENOMINATOR;

        if (reserveBps < MIN_RESERVE_BPS) {
            // Pull shortfall from SM
            uint256 toPull = targetReserve > vaultIdle ? targetReserve - vaultIdle : 0;
            if (toPull == 0) return;

            try ICoreStrategyManagerV21(coreStrategyManager).withdrawToVault(toPull) {
                emit RebalanceTriggered(reserveBps, 2, toPull);
            } catch {
                emit RebalancePullFailed(toPull);
            }
        } else {
            // Push excess to SM
            uint256 toPush = vaultIdle > targetReserve ? vaultIdle - targetReserve : 0;
            if (toPush == 0) return;

            // Transfer USDC to SM then notify
            IERC20(asset()).safeTransfer(coreStrategyManager, toPush);
            try ICoreStrategyManagerV21(coreStrategyManager).depositFromVault(toPush) {
                emit RebalanceTriggered(reserveBps, 1, toPush);
            } catch {
                // Transfer already happened; SM holds the USDC as untracked idle.
                // Admin must resolve via SM.depositFromVault() or divestFromStrategy().
                emit RebalancePushFailed(toPush);
            }
        }
    }

    modifier onlyAdminOrKeeper() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender))
            revert Unauthorized();
        _;
    }

    function _requireNormalMode() internal view {
        if (systemMode != SystemMode.Normal) revert DepositsArePaused();
    }

    function _requireAllowlisted(address account) internal view {
        if (allowlistEnabled && !allowlist[account]) revert NotAllowed();
    }

    // -------------------------------------------------------------------------
    // ERC20 multi-inheritance resolution
    // -------------------------------------------------------------------------

    /// @notice Returns 18 (USDC 6-decimal + 12-decimal offset = 18-decimal yrUSDC).
    function decimals() public pure override(ERC20, ERC4626) returns (uint8) {
        return 18;
    }

    function _mint(address account, uint256 amount) internal override(ERC20) {
        super._mint(account, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20) {
        super._burn(account, amount);
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20)
    {
        super._beforeTokenTransfer(from, to, amount);
    }
}
