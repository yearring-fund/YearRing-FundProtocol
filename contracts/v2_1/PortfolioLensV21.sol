// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "./RewardsMathV21.sol";
import "./interfaces/IPortfolioLensV21.sol";
import "./interfaces/ILockManagerV21.sol";
import "./interfaces/IAccessStrategyManagerV21.sol";
import "./interfaces/IEligibilityModuleV21.sol";
import "./interfaces/ITreasuryV21.sol";
import "../interfaces/IPointsLedgerV01.sol";

/// @dev Minimal interface for vault fields not in standard IERC4626.
interface IVaultMeta {
    function systemMode() external view returns (uint8);
    function allowlistEnabled() external view returns (bool);
}

/// @title PortfolioLensV21
/// @notice Read-only view aggregator for the YearRing V2.1 protocol.
///
/// Shares RewardsMathV21 with LockManagerV21 so pending reward computations
/// are byte-for-byte identical to what LockManager would credit on the next checkpoint.
///
/// All functions are view — no state is written.  Re-deploy the Lens if
/// any of the immutable addresses below are replaced.
contract PortfolioLensV21 is IPortfolioLensV21 {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant RAY             = 1e27;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    /// @notice YearRingCoreVaultV21 (IERC4626 + IVaultMeta)
    address public immutable coreVault;

    /// @notice LockManagerV21
    address public immutable lockManager;

    /// @notice EligibilityModuleV21 (may be address(0) when not yet deployed)
    address public immutable eligibilityModule;

    /// @notice PointsLedgerV01 (may be address(0) when not yet deployed)
    address public immutable pointsLedger;

    /// @notice TreasuryV21 (may be address(0) when not yet deployed)
    address public immutable treasury;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param coreVault_         YearRingCoreVaultV21 address
    /// @param lockManager_       LockManagerV21 address
    /// @param eligibilityModule_ EligibilityModuleV21 address (pass address(0) to skip)
    /// @param pointsLedger_      PointsLedgerV01 address (pass address(0) to skip)
    /// @param treasury_          TreasuryV21 address (pass address(0) to skip)
    constructor(
        address coreVault_,
        address lockManager_,
        address eligibilityModule_,
        address pointsLedger_,
        address treasury_
    ) {
        require(coreVault_ != address(0),   "Lens: zero coreVault");
        require(lockManager_ != address(0), "Lens: zero lockManager");
        coreVault         = coreVault_;
        lockManager       = lockManager_;
        eligibilityModule = eligibilityModule_;
        pointsLedger      = pointsLedger_;
        treasury          = treasury_;
    }

    // -------------------------------------------------------------------------
    // IPortfolioLensV21 — lock views
    // -------------------------------------------------------------------------

    /// @inheritdoc IPortfolioLensV21
    function getLockView(uint256 lockId)
        external
        view
        override
        returns (LockView memory)
    {
        return _buildLockView(lockId);
    }

    /// @inheritdoc IPortfolioLensV21
    function getUserPortfolio(
        address user,
        uint256 offset,
        uint256 limit
    )
        external
        view
        override
        returns (UserPortfolio memory portfolio)
    {
        (uint256[] memory lockIds, uint256 total) =
            ILockManagerV21(lockManager).getUserLockIds(user, offset, limit);

        portfolio.total = total;

        // Points balance (0 if ledger not configured)
        if (pointsLedger != address(0)) {
            portfolio.totalPointsBalance = IPointsLedgerV01(pointsLedger).balanceOf(user);
        }

        // Build LockView for each returned lockId
        portfolio.locks = new LockView[](lockIds.length);
        for (uint256 i = 0; i < lockIds.length; i++) {
            portfolio.locks[i] = _buildLockView(lockIds[i]);
        }
    }

    // -------------------------------------------------------------------------
    // IPortfolioLensV21 — vault info
    // -------------------------------------------------------------------------

    /// @inheritdoc IPortfolioLensV21
    function getVaultInfo() external view override returns (VaultInfo memory info) {
        IERC4626 vault = IERC4626(coreVault);

        info.vault        = coreVault;
        info.totalAssets  = vault.totalAssets();
        info.totalSupply  = vault.totalSupply();

        // Price per share in ray: convertToAssets(1e18) × RAY / 1e18
        // Using 1e18 as the unit-share normalises against 18-dec yrUSDC
        uint256 oneShare = vault.convertToAssets(1e18);
        info.pricePerShareRay = oneShare * RAY / 1e18;

        info.systemMode       = IVaultMeta(coreVault).systemMode();
        info.allowlistEnabled = IVaultMeta(coreVault).allowlistEnabled();

        // Reserve ratio: idle USDC in vault / totalAssets × BPS
        if (info.totalAssets > 0) {
            address usdc = vault.asset();
            uint256 idleUSDC = IERC20(usdc).balanceOf(coreVault);
            info.reserveRatioBps = idleUSDC * BPS_DENOMINATOR / info.totalAssets;
        }
    }

    // -------------------------------------------------------------------------
    // IPortfolioLensV21 — eligibility check
    // -------------------------------------------------------------------------

    /// @inheritdoc IPortfolioLensV21
    function checkEligibility(uint256 lockId, address manager)
        external
        view
        override
        returns (bool canEnter, bytes32 reason)
    {
        if (eligibilityModule == address(0)) {
            return (false, "MODULE_NOT_SET");
        }

        ILockManagerV21.LockInfo memory info = ILockManagerV21(lockManager).getLock(lockId);

        return IEligibilityModuleV21(eligibilityModule).canEnterManager(
            info.owner,
            lockId,
            manager,
            info.yrUSDCAmount
        );
    }

    // -------------------------------------------------------------------------
    // IPortfolioLensV21 — manager info
    // -------------------------------------------------------------------------

    /// @inheritdoc IPortfolioLensV21
    function getManagerInfo(address manager)
        external
        view
        override
        returns (ManagerInfo memory mi)
    {
        IAccessStrategyManagerV21 asm = IAccessStrategyManagerV21(manager);

        mi.manager                = manager;
        mi.totalManagedAssets     = asm.totalManagedAssets();
        mi.totalUnits             = asm.totalUnits();
        mi.unitPriceRay           = asm.unitPriceRay();
        mi.managementFeeBpsPerYear= asm.managementFeeBpsPerYear();
        mi.strategy               = asm.strategy();
        mi.feeReceiver            = asm.feeReceiver();
        mi.feeReceiverUnits       = asm.feeReceiverUnits();
    }

    // -------------------------------------------------------------------------
    // IPortfolioLensV21 — treasury info
    // -------------------------------------------------------------------------

    /// @inheritdoc IPortfolioLensV21
    function getTreasuryInfo(address[] calldata managers)
        external
        view
        override
        returns (TreasuryInfo memory ti)
    {
        ti.treasury = treasury;

        if (treasury != address(0)) {
            ti.yrUSDCBalance = ITreasuryV21(treasury).yrUSDCBalance();
            // yrUSDC IS the coreVault share token; convertToAssets gives USDC value
            ti.yrUSDCValueUSDC = IERC4626(coreVault).convertToAssets(ti.yrUSDCBalance);
        }

        ti.managerFees = new TreasuryManagerFeeInfo[](managers.length);
        for (uint256 i = 0; i < managers.length; i++) {
            IAccessStrategyManagerV21 asm = IAccessStrategyManagerV21(managers[i]);

            uint256 totalManaged = asm.totalManagedAssets();
            uint256 totalUnits   = asm.totalUnits();
            uint256 feeUnits     = asm.feeReceiverUnits();

            uint256 usdcValue = (totalUnits > 0)
                ? totalManaged * feeUnits / totalUnits
                : 0;

            ti.managerFees[i] = TreasuryManagerFeeInfo({
                manager:          managers[i],
                feeReceiverUnits: feeUnits,
                usdcValue:        usdcValue
            });
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Construct a full LockView for `lockId`, computing pending rewards.
    function _buildLockView(uint256 lockId)
        internal
        view
        returns (LockView memory v)
    {
        ILockManagerV21.LockInfo memory info = ILockManagerV21(lockManager).getLock(lockId);

        v.lockId    = lockId;
        v.info      = info;
        v.isMatured = block.timestamp >= info.minUnlockTime;

        // Tier name based on actual lock age at this moment
        uint256 age = block.timestamp >= info.startTime
            ? block.timestamp - info.startTime
            : 0;
        v.tierName = RewardsMathV21.tierName(age);

        // Pending rewards are only meaningful for Active locks
        if (info.status == ILockManagerV21.LockStatus.Active) {
            uint64 now_ = uint64(block.timestamp);

            // Pending bonus Points since last checkpoint
            if (info.lastBonusPointsCheckpoint < now_) {
                v.pendingBonusPoints = RewardsMathV21.computeSegmentBonusPoints(
                    info.principalAssetsUSDC,
                    info.startTime,
                    info.lastBonusPointsCheckpoint,
                    now_
                );
            }

            // Pending rebate since last checkpoint
            if (info.lastRebateCheckpoint < now_) {
                uint256 feeBps;

                if (info.assetType == ILockManagerV21.LockAssetType.YR_USDC) {
                    feeBps = ILockManagerV21(lockManager).coreSMFeeBpsPerYear();
                } else if (
                    info.assetType == ILockManagerV21.LockAssetType.MANAGER_UNITS &&
                    info.manager != address(0)
                ) {
                    feeBps = IAccessStrategyManagerV21(info.manager).managementFeeBpsPerYear();
                }

                if (feeBps > 0) {
                    v.pendingRebateUSDC = RewardsMathV21.computeSegmentRebate(
                        info.principalAssetsUSDC,
                        info.startTime,
                        info.lastRebateCheckpoint,
                        now_,
                        feeBps
                    );
                }
            }
        }
    }
}
