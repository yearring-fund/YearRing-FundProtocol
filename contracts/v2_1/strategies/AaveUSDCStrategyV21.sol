// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/IStrategyV21.sol";

// ---------------------------------------------------------------------------
// Aave V3 interfaces (minimal — only functions used by this strategy)
// ---------------------------------------------------------------------------

interface IAavePoolV3 {
    /// @notice Supply `amount` of `asset` into Aave on behalf of `onBehalfOf`
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /// @notice Withdraw `amount` of `asset` from Aave to `to`.
    ///         Pass type(uint256).max to redeem the full aToken balance.
    /// @return withdrawn Actual amount withdrawn
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256 withdrawn);
}

interface IATokenV3 {
    /// @notice Returns the address of the underlying asset for this aToken
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);

    /// @notice Current aToken balance of `account` (includes accrued interest)
    function balanceOf(address account) external view returns (uint256);
}

/// @title AaveUSDCStrategyV21
/// @notice Deposits USDC into Aave V3 to earn yield on behalf of CoreStrategyManagerV21.
///
/// @dev Push model: CoreStrategyManagerV21 transfers USDC here before calling invest().
///      divest() and emergencyExit() withdraw from Aave and return USDC directly to manager.
///      Only the manager may call invest / divest / emergencyExit.
///
///      aToken address is supplied at construction and verified against the underlying asset
///      to prevent misconfiguration.
contract AaveUSDCStrategyV21 is IStrategyV21, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error OnlyManager();
    error ZeroAmount();
    error ZeroAddress();
    error ATokenUnderlyingMismatch(address expected, address actual);
    error InsufficientBalance(uint256 available, uint256 required);

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event Invested(uint256 amount);
    event Divested(uint256 requested, uint256 withdrawn);
    event EmergencyExited(uint256 withdrawn);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice Underlying asset — Base native USDC
    IERC20 public immutable underlyingToken;

    /// @notice CoreStrategyManagerV21 — only address allowed to call fund operations
    address public immutable manager;

    /// @notice Aave V3 Pool on Base
    IAavePoolV3 public immutable pool;

    /// @notice aUSDC — interest-bearing token; balance grows with Aave yield
    IATokenV3 public immutable aToken;

    /// @notice Aave referral code (use 0 for standard deployments)
    uint16 public immutable referralCode;

    // -------------------------------------------------------------------------
    // Optional audit state
    // -------------------------------------------------------------------------

    /// @notice Timestamp of the last emergencyExit call (0 = never triggered)
    uint256 public lastEmergencyExitAt;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param underlying_   USDC address on Base
    /// @param manager_      CoreStrategyManagerV21 address
    /// @param pool_         Aave V3 Pool address on Base
    /// @param aToken_       aUSDC address on Base
    /// @param referralCode_ Aave referral code (use 0)
    constructor(
        address underlying_,
        address manager_,
        address pool_,
        address aToken_,
        uint16 referralCode_
    ) {
        if (
            underlying_ == address(0) ||
            manager_    == address(0) ||
            pool_       == address(0) ||
            aToken_     == address(0)
        ) revert ZeroAddress();

        // Verify aToken corresponds to the correct underlying to catch misconfiguration
        address aTokenUnderlying = IATokenV3(aToken_).UNDERLYING_ASSET_ADDRESS();
        if (aTokenUnderlying != underlying_)
            revert ATokenUnderlyingMismatch(underlying_, aTokenUnderlying);

        underlyingToken = IERC20(underlying_);
        manager         = manager_;
        pool            = IAavePoolV3(pool_);
        aToken          = IATokenV3(aToken_);
        referralCode    = referralCode_;
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyManager() {
        if (msg.sender != manager) revert OnlyManager();
        _;
    }

    // -------------------------------------------------------------------------
    // IStrategyV21 — view
    // -------------------------------------------------------------------------

    /// @inheritdoc IStrategyV21
    function underlying() external view override returns (address) {
        return address(underlyingToken);
    }

    /// @notice Total USDC equivalent: aToken balance (principal + yield) + any idle USDC
    ///         held by this contract that has not yet been supplied to Aave.
    ///         Never reverts so CoreStrategyManagerV21.totalManagedAssets() stays readable.
    function totalUnderlying() external view override returns (uint256) {
        return aToken.balanceOf(address(this)) + underlyingToken.balanceOf(address(this));
    }

    // -------------------------------------------------------------------------
    // IStrategyV21 — fund operations (onlyManager)
    // -------------------------------------------------------------------------

    /// @notice Supply USDC already held by this contract into Aave V3.
    /// @dev Safe-approve pattern: reset to 0 then set to max, required for USDC non-standard approval.
    function invest(uint256 amount) external override onlyManager nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 idle = underlyingToken.balanceOf(address(this));
        if (idle < amount) revert InsufficientBalance(idle, amount);

        uint256 allowance = underlyingToken.allowance(address(this), address(pool));
        if (allowance < amount) {
            underlyingToken.safeApprove(address(pool), 0);
            underlyingToken.safeApprove(address(pool), type(uint256).max);
        }

        pool.supply(address(underlyingToken), amount, address(this), referralCode);

        emit Invested(amount);
    }

    /// @notice Withdraw `amount` of USDC from Aave V3 and forward to manager.
    /// @dev Actual withdrawn amount is measured via balance diff to account for Aave rounding.
    ///      Aave may return less than requested if pool liquidity is constrained.
    /// @return withdrawn Actual USDC transferred to manager
    function divest(uint256 amount) external override onlyManager nonReentrant returns (uint256 withdrawn) {
        if (amount == 0) revert ZeroAmount();

        uint256 before = underlyingToken.balanceOf(address(this));
        pool.withdraw(address(underlyingToken), amount, address(this));
        withdrawn = underlyingToken.balanceOf(address(this)) - before;

        if (withdrawn > 0) {
            underlyingToken.safeTransfer(manager, withdrawn);
        }

        emit Divested(amount, withdrawn);
    }

    /// @notice Withdraw the full aToken balance from Aave and send all USDC to manager.
    ///         Also forwards any idle USDC not yet supplied.
    /// @return withdrawn Total USDC transferred to manager
    function emergencyExit() external override onlyManager nonReentrant returns (uint256 withdrawn) {
        uint256 aBalance = aToken.balanceOf(address(this));
        if (aBalance > 0) {
            pool.withdraw(address(underlyingToken), type(uint256).max, address(this));
        }

        withdrawn = underlyingToken.balanceOf(address(this));
        if (withdrawn > 0) {
            underlyingToken.safeTransfer(manager, withdrawn);
        }

        lastEmergencyExitAt = block.timestamp;

        emit EmergencyExited(withdrawn);
    }
}
