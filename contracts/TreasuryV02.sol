// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title TreasuryV02
/// @notice Protocol treasury for YearRing Fund Protocol closed beta.
///         Receives management fee shares minted by YearRingCoreVaultV01.
///         Holds rebate budget (yrCORE shares) and authorises the rebate manager to pull them.
///         Tracks rebate spend per asset to enforce budget caps.
///
/// @dev STRICT SCOPE — this contract must NOT:
///      - Control user principal in any vault
///      - Call invest / divest on any strategy
///      - Act as a DAO spending treasury
///      - Perform token buybacks or native token distribution
///
///      All token movements emit events. Budget cap is enforced on recordRebateSpent().
///      The rebate payment flow is:
///        1. Admin calls approveSpender(yrCORE, rebateManager, amount) to pre-authorise.
///        2. rebateManager calls safeTransferFrom(treasury, user, rebateShares).
///        3. rebateManager calls recordRebateSpent(yrCORE, user, rebateShares) to debit budget.
contract TreasuryV02 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Can call operator-level functions: setRebateBudget, approveSpender,
    ///         setApprovedAsset, setApprovedModule. Separate from admin to allow
    ///         day-to-day treasury ops without full admin rights.
    bytes32 public constant TREASURY_OPERATOR_ROLE = keccak256("TREASURY_OPERATOR_ROLE");

    /// @notice Can trigger emergency revoke of any outstanding allowance.
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    /// @notice Granted to the active rebate manager; allows it to call recordRebateSpent.
    bytes32 public constant REBATE_MANAGER_ROLE = keccak256("REBATE_MANAGER_ROLE");

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error ZeroAddress();
    error ZeroAmount();
    error NotApprovedAsset(address asset);
    error NotApprovedModule(address module);
    error RebateBudgetExceeded(address asset, uint256 requested, uint256 remaining);
    error UnauthorizedCaller();

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Approved assets that this treasury can hold / disburse as rebate
    mapping(address => bool) public approvedAssets;

    /// @notice Approved modules (e.g. LockPointsRebateManagerV02) allowed to interact with treasury
    mapping(address => bool) public approvedModules;

    /// @notice Current rebate manager address (single active manager)
    address public rebateManager;

    /// @notice Total rebate budget allocated per asset
    mapping(address => uint256) public rebateBudgetOf;

    /// @notice Total rebate already paid out per asset
    mapping(address => uint256) public rebateSpentOf;

    // -------------------------------------------------------------------------
    // Events (Step 12)
    // -------------------------------------------------------------------------
    event ApprovedAssetUpdated(address indexed asset, bool approved);
    event ApprovedModuleUpdated(address indexed module, bool approved);
    event RebateManagerUpdated(address indexed oldManager, address indexed newManager);
    event RebateBudgetUpdated(address indexed asset, uint256 oldBudget, uint256 newBudget);
    event RebateSpent(address indexed asset, address indexed user, uint256 amount);
    event AllowanceApproved(address indexed token, address indexed spender, uint256 amount);
    event AllowanceRevoked(address indexed token, address indexed spender);
    event EmergencyRevoke(address indexed token, address indexed spender);
    event TreasuryTokenRescued(address indexed token, address indexed to, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param admin_ DEFAULT_ADMIN_ROLE holder (Timelock in production)
    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // -------------------------------------------------------------------------
    // Step 4: Approved asset management (DEFAULT_ADMIN_ROLE or TREASURY_OPERATOR_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Set whether an asset (token) is approved for treasury operations
    function setApprovedAsset(address token, bool approved)
        external
        onlyAdminOrOperator
    {
        if (token == address(0)) revert ZeroAddress();
        approvedAssets[token] = approved;
        emit ApprovedAssetUpdated(token, approved);
    }

    // -------------------------------------------------------------------------
    // Step 5: Approved module management (DEFAULT_ADMIN_ROLE or TREASURY_OPERATOR_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Set whether a module address is approved to interact with this treasury
    function setApprovedModule(address module, bool approved)
        external
        onlyAdminOrOperator
    {
        if (module == address(0)) revert ZeroAddress();
        approvedModules[module] = approved;
        emit ApprovedModuleUpdated(module, approved);
    }

    // -------------------------------------------------------------------------
    // Step 6: Rebate manager (DEFAULT_ADMIN_ROLE)
    // Sets the single active rebate manager; grants / revokes REBATE_MANAGER_ROLE atomically.
    // -------------------------------------------------------------------------

    /// @notice Set the active rebate manager.
    ///         Revokes REBATE_MANAGER_ROLE from the previous manager and grants to the new one.
    /// @param manager New rebate manager address (e.g. LockPointsRebateManagerV02)
    function setRebateManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (manager == address(0)) revert ZeroAddress();
        address old = rebateManager;
        if (old != address(0)) {
            _revokeRole(REBATE_MANAGER_ROLE, old);
        }
        rebateManager = manager;
        _grantRole(REBATE_MANAGER_ROLE, manager);
        emit RebateManagerUpdated(old, manager);
    }

    // -------------------------------------------------------------------------
    // Steps 7–8: Rebate budget management
    // -------------------------------------------------------------------------

    /// @notice Set absolute rebate budget for an asset (overwrites previous value)
    /// @dev Only approved assets accepted. Settles budget regardless of current spend.
    function setRebateBudget(address asset, uint256 amount)
        external
        onlyAdminOrOperator
    {
        if (!approvedAssets[asset]) revert NotApprovedAsset(asset);
        uint256 old = rebateBudgetOf[asset];
        rebateBudgetOf[asset] = amount;
        emit RebateBudgetUpdated(asset, old, amount);
    }

    /// @notice Increase rebate budget for an asset by `delta`
    function increaseRebateBudget(address asset, uint256 delta)
        external
        onlyAdminOrOperator
    {
        if (!approvedAssets[asset]) revert NotApprovedAsset(asset);
        if (delta == 0) revert ZeroAmount();
        uint256 old = rebateBudgetOf[asset];
        uint256 newBudget = old + delta;
        rebateBudgetOf[asset] = newBudget;
        emit RebateBudgetUpdated(asset, old, newBudget);
    }

    /// @notice Record rebate paid out by the active rebate manager.
    ///         Reverts if the total spend would exceed the allocated budget.
    /// @dev Called by rebate manager AFTER it has transferred shares from treasury to user.
    ///      The actual token transfer happens via the pre-approved ERC20 allowance;
    ///      this function enforces the budget cap and emits the audit trail.
    /// @param asset  Token address (must be approved asset)
    /// @param user   Recipient of the rebate
    /// @param amount Amount of `asset` paid to `user`
    function recordRebateSpent(address asset, address user, uint256 amount)
        external
        onlyRole(REBATE_MANAGER_ROLE)
    {
        if (!approvedAssets[asset]) revert NotApprovedAsset(asset);
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 newSpent = rebateSpentOf[asset] + amount;
        if (newSpent > rebateBudgetOf[asset]) {
            revert RebateBudgetExceeded(asset, amount, rebateBudgetOf[asset] - rebateSpentOf[asset]);
        }

        rebateSpentOf[asset] = newSpent;
        emit RebateSpent(asset, user, amount);
    }

    /// @notice Remaining rebate budget for an asset (budget minus spent)
    function rebateBudgetRemaining(address asset) external view returns (uint256) {
        uint256 budget = rebateBudgetOf[asset];
        uint256 spent  = rebateSpentOf[asset];
        return budget > spent ? budget - spent : 0;
    }

    // -------------------------------------------------------------------------
    // Step 9: Allowance management
    // -------------------------------------------------------------------------

    /// @notice Approve a spender to pull `amount` of `token` from this treasury.
    ///         Used to pre-authorise the rebate manager to transfer yrCORE shares to users.
    /// @dev Only approved assets and approved modules accepted as spender.
    function approveSpender(address token, address spender, uint256 amount)
        external
        onlyAdminOrOperator
    {
        if (!approvedAssets[token]) revert NotApprovedAsset(token);
        if (!approvedModules[spender]) revert NotApprovedModule(spender);
        IERC20(token).approve(spender, amount);
        emit AllowanceApproved(token, spender, amount);
    }

    /// @notice Revoke all allowance granted to `spender` for `token`.
    ///         Intentionally does NOT require `token` to be an approvedAsset or
    ///         `spender` to be an approvedModule — revoke must remain possible even
    ///         after an asset or module has been removed from the approved sets.
    function revokeAllowance(address token, address spender)
        external
        onlyAdminOrOperator
    {
        if (token == address(0) || spender == address(0)) revert ZeroAddress();
        IERC20(token).approve(spender, 0);
        emit AllowanceRevoked(token, spender);
    }

    /// @notice Emergency revoke — callable by EMERGENCY_ROLE or DEFAULT_ADMIN_ROLE.
    ///         Sets allowance to 0 immediately.
    ///         Intentionally does NOT require approved asset/module — must work for
    ///         any historical allowance regardless of current approval state.
    function emergencyRevoke(address token, address spender)
        external
    {
        if (!hasRole(EMERGENCY_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert UnauthorizedCaller();
        if (token == address(0) || spender == address(0)) revert ZeroAddress();
        IERC20(token).approve(spender, 0);
        emit EmergencyRevoke(token, spender);
    }

    // -------------------------------------------------------------------------
    // Step 10–11: rescueToken
    // -------------------------------------------------------------------------

    /// @notice Rescue any ERC20 token held by this treasury to a non-zero address.
    ///         Restricted to DEFAULT_ADMIN_ROLE or TREASURY_OPERATOR_ROLE.
    ///         Cannot send to zero address. Always emits TreasuryTokenRescued.
    /// @dev Intentionally does NOT require `token` to be an approvedAsset — enables
    ///      recovery of accidentally sent or unknown tokens.
    ///      Role control (admin/operator) and event emission are the sole guardrails.
    ///      Does NOT dispatch Vault principal — can only move tokens held by this contract.
    function rescueToken(address token, address to, uint256 amount)
        external
        nonReentrant
        onlyAdminOrOperator
    {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit TreasuryTokenRescued(token, to, amount);
    }

    // -------------------------------------------------------------------------
    // Internal modifier helpers
    // -------------------------------------------------------------------------

    modifier onlyAdminOrOperator() {
        if (
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender) &&
            !hasRole(TREASURY_OPERATOR_ROLE, msg.sender)
        ) {
            revert UnauthorizedCaller();
        }
        _;
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
