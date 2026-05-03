import { useNavigate } from 'react-router-dom'
import { useAccount, useChainId, useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import {
  FundVault_ABI,
  Metrics_ABI,
  UserState_ABI,
  RewardToken_ABI,
  Governance_ABI,
  ClaimLedger_ABI,
} from '../contracts/abis'
import {
  fmtUsdc, fmtShares, fmtRwt, fmtPps, fmtBps,
} from '../utils'
import { BASE_ID } from '../wagmiConfig'

const USDC_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

function userStateName(s: number | undefined): string {
  if (s === undefined) return '–'
  return ['Normal', 'Locked (Active)', 'Matured', 'Exited'][s] ?? String(s)
}

function systemModeName(m: number | undefined): string {
  if (m === undefined) return '–'
  return ['Normal', 'Deposits Paused', 'Emergency Exit'][m] ?? String(m)
}

function systemModeBadge(m: number | undefined) {
  if (m === 2) return <span className="badge badge-red">Emergency Exit</span>
  if (m === 1) return <span className="badge badge-yellow">Deposits Paused</span>
  return <span className="badge badge-green">Normal</span>
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  // Protocol stats
  const { data: snapshot } = useReadContract({
    address: ADDRESSES.MetricsLayerV02,
    abi: Metrics_ABI,
    functionName: 'snapshot',
    query: { enabled },
  })
  const { data: pps } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'pricePerShare',
    query: { enabled },
  })
  const { data: systemMode } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'systemMode',
    query: { enabled },
  })
  const { data: depositsPaused } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'depositsPaused',
    query: { enabled },
  })
  const { data: redeemsPaused } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'redeemsPaused',
    query: { enabled },
  })

  // My stats
  const { data: usdcBal } = useReadContract({
    address: ADDRESSES.USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: fbUsdcBal } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: rwtBal } = useReadContract({
    address: ADDRESSES.RewardToken,
    abi: RewardToken_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: isAllowed } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'isAllowed',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: userState } = useReadContract({
    address: ADDRESSES.UserStateEngineV02,
    abi: UserState_ABI,
    functionName: 'userStateOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  // Locked shares from MetricsLayer
  const lockedShares = snapshot?.totalLockedShares ?? 0n
  const freeShares = fbUsdcBal !== undefined && fbUsdcBal > lockedShares
    ? fbUsdcBal - lockedShares
    : fbUsdcBal ?? 0n

  // Claims count
  const { data: claimIds } = useReadContract({
    address: ADDRESSES.ClaimLedger,
    abi: ClaimLedger_ABI,
    functionName: 'userClaimIds',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  // Governance proposal count
  const { data: nextProposalId } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02,
    abi: Governance_ABI,
    functionName: 'nextProposalId',
    query: { enabled },
  })

  if (!isConnected) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 18, marginBottom: 12, color: 'var(--blue)' }}>
            Connect your wallet to access YearRing Fund
          </div>
          <div className="note">
            This is an invite-only protocol. You must be whitelisted to deposit or lock funds.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Dashboard</div>
        <div className="note">Overview of protocol state and your portfolio</div>
      </div>

      {/* Protocol Stats */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Protocol</div>
        <div className="info-row">
          <span className="info-label">Total TVL</span>
          <span className="info-value">{fmtUsdc(snapshot?.totalTVL)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Price Per Share</span>
          <span className="info-value">{fmtPps(pps)} <span className="note" style={{ display: 'inline', margin: 0 }}>(current estimate)</span></span>
        </div>
        <div className="info-row">
          <span className="info-label">Lock Ratio</span>
          <span className="info-value">{fmtBps(snapshot?.lockedRatioBps)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Total Locks Ever</span>
          <span className="info-value">{snapshot?.totalLocksEver?.toString() ?? '–'}</span>
        </div>
        <hr className="divider" />
        <div className="info-row">
          <span className="info-label">System Mode</span>
          <span className="info-value">{systemModeBadge(systemMode)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Deposits</span>
          <span className="info-value">
            {depositsPaused ? <span className="badge badge-yellow">Paused</span> : <span className="badge badge-green">Open</span>}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Redeems</span>
          <span className="info-value">
            {redeemsPaused ? <span className="badge badge-yellow">Paused</span> : <span className="badge badge-green">Open</span>}
          </span>
        </div>
      </div>

      {/* My Portfolio */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">My Portfolio</div>
        <div className="info-row">
          <span className="info-label">Whitelist Status</span>
          <span className="info-value">
            {isAllowed === undefined
              ? '–'
              : isAllowed
              ? <span className="badge badge-green">Whitelisted</span>
              : <span className="badge badge-red">Not Whitelisted</span>
            }
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">User State</span>
          <span className="info-value">
            <span className="badge badge-blue">{userStateName(userState)}</span>
          </span>
        </div>
        <hr className="divider" />
        <div className="info-row">
          <span className="info-label">USDC Balance</span>
          <span className="info-value">{fmtUsdc(usdcBal)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">fbUSDC (Total)</span>
          <span className="info-value">{fmtShares(fbUsdcBal)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">fbUSDC (Free)</span>
          <span className="info-value">{fmtShares(freeShares)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">fbUSDC (Locked)</span>
          <span className="info-value">{fmtShares(lockedShares)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">RWT Balance</span>
          <span className="info-value">{fmtRwt(rwtBal)}</span>
        </div>
        <hr className="divider" />
        <div className="info-row">
          <span className="info-label">Pending Claims</span>
          <span className="info-value">{claimIds?.length ?? 0}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Governance Proposals</span>
          <span className="info-value">{nextProposalId?.toString() ?? '0'}</span>
        </div>
      </div>

      {/* CTAs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn-primary"
          style={{ flex: 1, minWidth: 120, padding: '10px 20px' }}
          onClick={() => navigate('/deposit')}
          disabled={!!depositsPaused || systemMode === 2}
        >
          → Deposit
        </button>
        <button
          className="btn-secondary"
          style={{ flex: 1, minWidth: 120, padding: '10px 20px' }}
          onClick={() => navigate('/lock')}
        >
          → Lock
        </button>
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        YearRing Fund is an invite-only, early-stage protocol. No yield is guaranteed.
        Price per share is a current estimate based on on-chain data and may not reflect pending accruals.
      </div>
    </div>
  )
}
