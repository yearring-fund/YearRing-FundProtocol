// Minimal ABI fragments — only functions used by the demo UI.

// Real USDC on Base — standard ERC20 fragments (no mint; closed beta uses real USDC)
export const USDC_ABI = [
  { name: 'approve',   type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const FundVault_ABI = [
  { name: 'deposit',          type: 'function', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'redeem',           type: 'function', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'assets', type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'approve',          type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'balanceOf',        type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'allowance',        type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'totalAssets',      type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'pricePerShare',    type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'convertToAssets',  type: 'function', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'convertToShares',  type: 'function', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'previewDeposit',   type: 'function', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'previewRedeem',    type: 'function', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'strategyManager',        type: 'function', inputs: [], outputs: [{ type: 'address' }],  stateMutability: 'view' },
  { name: 'mgmtFeeBpsPerMonth',     type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'treasury',               type: 'function', inputs: [], outputs: [{ type: 'address' }],  stateMutability: 'view' },
  { name: 'depositsPaused',         type: 'function', inputs: [], outputs: [{ type: 'bool' }],     stateMutability: 'view' },
  { name: 'redeemsPaused',          type: 'function', inputs: [], outputs: [{ type: 'bool' }],     stateMutability: 'view' },
  { name: 'availableToInvest',      type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'reserveRatioBps',        type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'hasRole',                type: 'function', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'isAllowed',              type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'pauseDeposits',          type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'unpauseDeposits',        type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'pauseRedeems',           type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'unpauseRedeems',         type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'accrueManagementFee',    type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'transferToStrategyManager', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'systemMode',             type: 'function', inputs: [], outputs: [{ type: 'uint8' }],     stateMutability: 'view' },
  { name: 'setMode',                type: 'function', inputs: [{ name: 'newMode', type: 'uint8' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'currentRoundId',         type: 'function', inputs: [], outputs: [{ type: 'uint256' }],   stateMutability: 'view' },
  { name: 'openExitModeRound',      type: 'function', inputs: [{ name: 'availableAssets_', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'closeExitModeRound',     type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'exitRounds',             type: 'function', inputs: [{ name: 'roundId', type: 'uint256' }], outputs: [{ name: 'snapshotId', type: 'uint256' }, { name: 'snapshotTotalSupply', type: 'uint256' }, { name: 'availableAssets', type: 'uint256' }, { name: 'totalClaimed', type: 'uint256' }, { name: 'isOpen', type: 'bool' }, { name: 'snapshotTimestamp', type: 'uint256' }], stateMutability: 'view' },
  { name: 'claimExitAssets',        type: 'function', inputs: [{ name: 'roundId', type: 'uint256' }, { name: 'sharesToBurn', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'roundSharesClaimed',     type: 'function', inputs: [{ name: 'roundId', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'totalSupply',            type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'addToAllowlist',         type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'removeFromAllowlist',    type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
] as const

export const StrategyManager_ABI = [
  // ── View ──────────────────────────────────────────────────────────────────────
  { name: 'totalManagedAssets', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'idleUnderlying',     type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'paused',             type: 'function', inputs: [], outputs: [{ type: 'bool' }],    stateMutability: 'view' },
  // Public state variable getters (auto-generated by Solidity)
  { name: 'strategy',           type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'vault',              type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'investCap',          type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'minIdle',            type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // ── Admin operations (DEFAULT_ADMIN_ROLE via Timelock) ────────────────────────
  { name: 'invest',             type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'divest',             type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'nonpayable' },
  { name: 'returnToVault',      type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'partialEmergencyExit', type: 'function', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

// AaveV3StrategyV01 — only read-only fragments needed for status display
// Source: contracts/strategies/AaveV3StrategyV01.sol
export const AaveV3Strategy_ABI = [
  { name: 'totalUnderlying', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'underlying',      type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'manager',         type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'aToken',          type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'lastEmergencyExitAt', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

// TreasuryV02 — minimal read-only ABI for status display
// Source: contracts/TreasuryV02.sol
export const Treasury_ABI = [
  { name: 'rebateBudgetRemaining', type: 'function', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const LockPointsRebateManager_ABI = [
  {
    name: 'lockWithPoints',
    type: 'function',
    inputs: [{ name: 'shares', type: 'uint256' }, { name: 'duration', type: 'uint64' }],
    outputs: [{ name: 'lockId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'claimRebate',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ name: 'rebateShares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'earlyExit',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'previewRebate',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'checkEarlyExit',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [
      { name: 'rebateShares',           type: 'uint256' },
      { name: 'pointsToReturn',         type: 'uint256' },
      { name: 'treasuryShareBalance',   type: 'uint256' },
      { name: 'treasuryShareAllowance', type: 'uint256' },
      { name: 'userPointsBalance',      type: 'uint256' },
      { name: 'userPointsAllowance',    type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'issuedPoints',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const LockLedger_ABI = [
  {
    name: 'unlock',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getLock',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'owner',       type: 'address' },
        { name: 'shares',      type: 'uint256' },
        { name: 'lockedAt',    type: 'uint64'  },
        { name: 'unlockAt',    type: 'uint64'  },
        { name: 'unlocked',    type: 'bool'    },
        { name: 'earlyExited', type: 'bool'    },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'userLockIds',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'activeLockCount',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalLockedShares',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const LockBenefit_ABI = [
  {
    name: 'tierOf',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'feeDiscountBpsOf',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const Beneficiary_ABI = [
  { name: 'setBeneficiary',   type: 'function', inputs: [{ name: 'beneficiary', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'updateBeneficiary',type: 'function', inputs: [{ name: 'newBeneficiary', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'revokeBeneficiary', type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { name: 'heartbeat',        type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  {
    name: 'executeClaim',
    type: 'function',
    inputs: [
      { name: 'originalOwner', type: 'address' },
      { name: 'lockIds', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  { name: 'beneficiaryOf', type: 'function', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'isInactive',    type: 'function', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool'    }], stateMutability: 'view' },
  { name: 'lastActiveAt',  type: 'function', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint64'  }], stateMutability: 'view' },
  { name: 'claimed',       type: 'function', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool'    }], stateMutability: 'view' },
] as const

export const UserState_ABI = [
  {
    name: 'userStateOf',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'lockStateOf',
    type: 'function',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

export const Metrics_ABI = [
  {
    name: 'snapshot',
    type: 'function',
    inputs: [],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'totalTVL',          type: 'uint256' },
        { name: 'totalLockedShares', type: 'uint256' },
        { name: 'lockedRatioBps',    type: 'uint256' },
        { name: 'totalLocksEver',    type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
] as const

export const Governance_ABI = [
  { name: 'nextProposalId',  type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'votingThreshold', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'votingPeriod',    type: 'function', inputs: [], outputs: [{ type: 'uint64'  }], stateMutability: 'view' },
  {
    name: 'getProposal', type: 'function',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'proposer',     type: 'address' },
        { name: 'title',        type: 'string'  },
        { name: 'description',  type: 'string'  },
        { name: 'proposalType', type: 'uint8'   },
        { name: 'startTime',    type: 'uint64'  },
        { name: 'endTime',      type: 'uint64'  },
        { name: 'forVotes',     type: 'uint256' },
        { name: 'againstVotes', type: 'uint256' },
        { name: 'abstainVotes', type: 'uint256' },
        { name: 'snapshotId',   type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
  { name: 'stateOf',        type: 'function', inputs: [{ name: 'proposalId', type: 'uint256' }], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { name: 'hasVoted',       type: 'function', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { name: 'votingPowerAt',  type: 'function', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'voter', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'castVote',       type: 'function', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'voteType', type: 'uint8' }], outputs: [], stateMutability: 'nonpayable' },
] as const

export const PointsToken_ABI = [
  { name: 'balanceOf',   type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'approve',     type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { name: 'allowance',   type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'totalSupply', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'balanceOfAt', type: 'function', inputs: [{ name: 'account', type: 'address' }, { name: 'snapshotId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const ClaimLedger_ABI = [
  {
    name: 'userClaimIds',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'claims',
    type: 'function',
    inputs: [{ name: 'claimId', type: 'uint256' }],
    outputs: [
      { name: 'roundId',       type: 'uint256' },
      { name: 'assetType',     type: 'address' },
      { name: 'nominalAmount', type: 'uint256' },
      { name: 'beneficiary',   type: 'address' },
      { name: 'settled',       type: 'bool'    },
    ],
    stateMutability: 'view',
  },
] as const
