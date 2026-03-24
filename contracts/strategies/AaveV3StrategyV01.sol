// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/IStrategyV01.sol";
import "./interfaces/IPool.sol";
import "./interfaces/IAToken.sol";

/// @title AaveV3StrategyV01
/// @notice Deposits USDC into Aave V3 on Base to earn yield.
///         Implements IStrategyV01 for integration with StrategyManagerV01.
/// @dev Push model: StrategyManagerV01 transfers USDC here before calling invest().
///      Only StrategyManagerV01 (manager) may call invest/divest/emergencyExit.
contract AaveV3StrategyV01 is IStrategyV01, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Errors
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
    event EmergencyExit(uint256 withdrawn);

    // -------------------------------------------------------------------------
    // Immutable state
    // -------------------------------------------------------------------------

    /// @notice Underlying asset (Base native USDC)
    IERC20 public immutable underlyingToken;

    /// @notice StrategyManagerV01 — only address allowed to call fund operations
    address public immutable manager;

    /// @notice Aave V3 Pool contract
    IPool public immutable pool;

    /// @notice aUSDC — Aave interest-bearing token; balance grows with yield
    IERC20 public immutable aToken;

    /// @notice Aave referral code (0 for standard usage)
    uint16 public immutable referralCode;

    // -------------------------------------------------------------------------
    // Optional audit state
    // -------------------------------------------------------------------------

    /// @notice Timestamp of the last emergencyExit call (0 if never triggered)
    uint256 public lastEmergencyExitAt;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param underlying_    USDC address on Base
    /// @param manager_       StrategyManagerV01 address
    /// @param pool_          Aave V3 Pool address on Base
    /// @param aToken_        aUSDC address on Base
    /// @param referralCode_  Aave referral code (use 0)
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

        // Verify aToken corresponds to the correct underlying asset
        address aTokenUnderlying = IAToken(aToken_).UNDERLYING_ASSET_ADDRESS();
        if (aTokenUnderlying != underlying_) revert ATokenUnderlyingMismatch(underlying_, aTokenUnderlying);

        underlyingToken = IERC20(underlying_);
        manager         = manager_;
        pool            = IPool(pool_);
        aToken          = IERC20(aToken_);
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
    // IStrategyV01 — view
    // -------------------------------------------------------------------------

    /// @inheritdoc IStrategyV01
    function underlying() external view override returns (address) {
        return address(underlyingToken);
    }

    /// @notice Conservative valuation: aToken balance + any idle USDC not yet supplied
    /// @dev aToken balance grows automatically with Aave yield — no oracle needed.
    ///      Never reverts to keep FundVaultV01.totalAssets() always readable.
    function totalUnderlying() external view override returns (uint256) {
        return aToken.balanceOf(address(this)) + underlyingToken.balanceOf(address(this));
    }

    // -------------------------------------------------------------------------
    // IStrategyV01 — fund operations (onlyManager)
    // -------------------------------------------------------------------------

    /// @notice Supply USDC already held by this contract into Aave V3
    /// @dev PUSH model: StrategyManagerV01 sends USDC here before calling this.
    ///      Approves pool using safe pattern (reset to 0 first, then max).
    function invest(uint256 amount) external override onlyManager nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 idle = underlyingToken.balanceOf(address(this));
        if (idle < amount) revert InsufficientBalance(idle, amount);

        // Safe approve: reset → max (handles USDC non-standard approval)
        uint256 allowance = underlyingToken.allowance(address(this), address(pool));
        if (allowance < amount) {
            underlyingToken.safeApprove(address(pool), 0);
            underlyingToken.safeApprove(address(pool), type(uint256).max);
        }

        pool.supply(address(underlyingToken), amount, address(this), referralCode);

        emit Invested(amount);
    }

    /// @notice Withdraw `amount` of USDC from Aave V3 to this contract, then forward to manager
    /// @dev Two-step: pool.withdraw → address(this), then safeTransfer → manager.
    ///      Actual withdrawn amount is measured by balance diff to account for Aave rounding.
    ///      Aave may return less than requested if pool liquidity is insufficient.
    /// @return withdrawn Actual USDC transferred to manager (may be less than requested)
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

    /// @notice Withdraw full aToken balance from Aave and send all USDC back to manager
    /// @dev Uses type(uint256).max to instruct Aave to redeem the full aToken balance.
    ///      Any idle USDC already held is also forwarded to manager.
    function emergencyExit() external override onlyManager nonReentrant {
        // Withdraw full aToken balance from Aave
        uint256 aTokenBalance = aToken.balanceOf(address(this));
        if (aTokenBalance > 0) {
            pool.withdraw(address(underlyingToken), type(uint256).max, address(this));
        }

        // Forward all underlying to manager (including any pre-existing idle balance)
        uint256 total = underlyingToken.balanceOf(address(this));
        if (total > 0) {
            underlyingToken.safeTransfer(manager, total);
        }

        lastEmergencyExitAt = block.timestamp;

        emit EmergencyExit(total);
    }
}
