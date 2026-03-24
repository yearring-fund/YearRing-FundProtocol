// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./interfaces/IStrategyManagerV01.sol";

/// @title FundVaultV01
/// @notice 100% reserve ERC4626 vault for on-chain fund V01
/// @dev Inherits ERC4626 + AccessControl; shares have 18 decimals via _decimalsOffset=12
contract FundVaultV01 is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

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

    /// @notice Monthly management fee in basis points (1 bps = 0.01%)
    uint256 public mgmtFeeBpsPerMonth;

    /// @notice Timestamp of last fee accrual
    uint256 public lastFeeAccrual;

    /// @notice Maximum management fee: 2% per month = 200 bps
    uint256 public constant MAX_MGMT_FEE_BPS_PER_MONTH = 200;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

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
    event TransferredToStrategyManager(uint256 amount);
    event ReserveRatioUpdated(uint256 oldBps, uint256 newBps);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param asset_ Underlying asset (USDC)
    /// @param name_ ERC20 name of shares
    /// @param symbol_ ERC20 symbol of shares
    /// @param treasury_ Initial treasury address
    /// @param guardian_ Initial guardian address
    /// @param admin_ Timelock / DEFAULT_ADMIN_ROLE holder
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address treasury_,
        address guardian_,
        address admin_
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        if (treasury_ == address(0) || guardian_ == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }

        treasury = treasury_;
        lastFeeAccrual = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, guardian_);
    }

    // -------------------------------------------------------------------------
    // ERC4626 overrides
    // -------------------------------------------------------------------------

    /// @dev Offset makes shares 18 decimals when underlying is 6 decimals
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
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

    /// @dev Hook: check depositsPaused before any deposit
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (depositsPaused) revert DepositsArePaused();
        accrueManagementFee();
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Hook: check redeemsPaused before any redeem
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (redeemsPaused) revert RedeemsArePaused();
        accrueManagementFee();
        super._withdraw(caller, receiver, owner, assets, shares);
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
    /// @dev Anyone can call; idempotent if called multiple times within same block
    function accrueManagementFee() public {
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
    // Pause controls (GUARDIAN_ROLE)
    // -------------------------------------------------------------------------

    function pauseDeposits() external onlyRole(GUARDIAN_ROLE) {
        depositsPaused = true;
        emit DepositsPaused();
    }

    function unpauseDeposits() external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositsPaused = false;
        emit DepositsUnpaused();
    }

    function pauseRedeems() external onlyRole(GUARDIAN_ROLE) {
        redeemsPaused = true;
        emit RedeemsPaused();
    }

    function unpauseRedeems() external onlyRole(DEFAULT_ADMIN_ROLE) {
        redeemsPaused = false;
        emit RedeemsUnpaused();
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
    /// @dev Enforces reserveRatioBps: vault must retain at least that fraction of totalAssets
    function transferToStrategyManager(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (!externalTransfersEnabled) revert ExternalTransfersDisabled();
        if (strategyManager == address(0)) revert ZeroAddress();
        accrueManagementFee();
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
