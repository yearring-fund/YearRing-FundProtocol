import { useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI, StrategyManager_ABI } from '../contracts/abis'
import { fmtUsdc } from '../utils'

const MODE_LABELS = ['Normal', 'Paused', 'EmergencyExit']
const MODE_BADGES = ['badge-green', 'badge-yellow', 'badge-red']

export default function StrategySection() {
  const enabled  = !!ADDRESSES.YearRingCoreVaultV01

  const { data: totalAssets, refetch: r1 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'totalAssets', query: { enabled },
  })
  const { data: smAddr, refetch: r2 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'strategyManager', query: { enabled },
  })
  const { data: vaultMode, refetch: r3 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'systemMode', query: { enabled },
  })

  const stratAddr = smAddr as `0x${string}` | undefined
  const smEnabled = !!stratAddr && stratAddr !== '0x0000000000000000000000000000000000000000'

  const { data: totalManaged, refetch: r4 } = useReadContract({
    address: stratAddr, abi: StrategyManager_ABI,
    functionName: 'totalManagedAssets', query: { enabled: smEnabled },
  })
  const { data: isPaused, refetch: r5 } = useReadContract({
    address: stratAddr, abi: StrategyManager_ABI,
    functionName: 'paused', query: { enabled: smEnabled },
  })

  const managed = totalManaged as bigint | undefined
  const total   = totalAssets  as bigint | undefined
  const modeNum = typeof vaultMode === 'number' ? vaultMode : (vaultMode !== undefined ? Number(vaultMode) : undefined)
  const modeLabel = modeNum !== undefined ? (MODE_LABELS[modeNum] ?? '–') : '–'
  const modeBadge = modeNum !== undefined ? (MODE_BADGES[modeNum] ?? 'badge-gray') : 'badge-gray'

  const stratPaused = isPaused as boolean | undefined

  const tvlPctBps = managed !== undefined && total !== undefined && total > 0n
    ? (managed * 10000n) / total
    : undefined
  const tvlPct = tvlPctBps !== undefined
    ? `${tvlPctBps / 100n}.${(tvlPctBps % 100n).toString().padStart(2, '0')}%`
    : '–'

  function refetch() { r1(); r2(); r3(); r4(); r5() }

  return (
    <div className="card">
      <div className="card-title">Strategy</div>

      {/* ── Strategy 1 ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Strategy 1 — Aave V3</span>
          <span className={`badge ${stratPaused ? 'badge-red' : 'badge-green'}`}>
            {stratPaused === undefined ? '–' : stratPaused ? 'Paused' : 'Active'}
          </span>
        </div>

        <div className="info-row">
          <span className="info-label">Strategy assets</span>
          <span className="info-value">{fmtUsdc(managed)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">% of total TVL</span>
          <span className="info-value">{tvlPct}</span>
        </div>
        <p className="note" style={{ marginTop: 6 }}>
          Strategy yield is variable and not guaranteed. Reported values may reflect strategy reporting delay.
        </p>
      </div>

      <hr className="divider" />

      {/* ── Strategy 2 ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Strategy 2</span>
          <span className="badge badge-gray">In Development</span>
        </div>
        <p className="note">Coming soon. This strategy is currently under development.</p>
      </div>

      <hr className="divider" />

      {/* ── Vault overview ── */}
      <div className="info-row">
        <span className="info-label">Total vault assets</span>
        <span className="info-value">{fmtUsdc(total)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">System Mode</span>
        <span className={`badge ${modeBadge}`}>{modeLabel}</span>
      </div>

      <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={refetch}>
        ↻ Refresh
      </button>
    </div>
  )
}
