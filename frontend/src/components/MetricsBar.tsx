import { useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { Metrics_ABI, FundVault_ABI, USDC_ABI } from '../contracts/abis'
import { fmtUsdc, fmtBps, fmtPps } from '../utils'

const RESERVE_FLOOR_BPS   = 1500n  // 15%
const RESERVE_CEILING_BPS = 3500n  // 35%
const BPS_DENOMINATOR     = 10000n

function reserveBandLabel(bps: bigint): { label: string; cls: string } {
  if (bps < RESERVE_FLOOR_BPS)   return { label: 'Below Floor',   cls: 'badge-red'    }
  if (bps > RESERVE_CEILING_BPS) return { label: 'Above Ceiling', cls: 'badge-yellow' }
  return                                  { label: 'In Target Band', cls: 'badge-green' }
}

export default function MetricsBar() {
  const { data: snap, refetch: r1 } = useReadContract({
    address: ADDRESSES.MetricsLayerV02,
    abi: Metrics_ABI,
    functionName: 'snapshot',
    query: { enabled: !!ADDRESSES.MetricsLayerV02 },
  })
  const { data: pps, refetch: r2 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01,
    abi: FundVault_ABI,
    functionName: 'pricePerShare',
    query: { enabled: !!ADDRESSES.YearRingCoreVaultV01 },
  })
  const { data: totalAssets, refetch: r3 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01,
    abi: FundVault_ABI,
    functionName: 'totalAssets',
    query: { enabled: !!ADDRESSES.YearRingCoreVaultV01 },
  })
  // Vault's own USDC balance — numerator of the actual reserve ratio
  const { data: vaultUsdcBal, refetch: r4 } = useReadContract({
    address: ADDRESSES.USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: ADDRESSES.YearRingCoreVaultV01 ? [ADDRESSES.YearRingCoreVaultV01] : undefined,
    query: { enabled: !!ADDRESSES.USDC && !!ADDRESSES.YearRingCoreVaultV01 },
  })

  const s = snap as { totalTVL: bigint; totalLockedShares: bigint; lockedRatioBps: bigint; totalLocksEver: bigint } | undefined
  const total    = totalAssets as bigint | undefined
  const vaultBal = vaultUsdcBal as bigint | undefined

  // Actual current reserve ratio = vault USDC / totalAssets (in bps)
  const actualReserveBps: bigint | undefined =
    total !== undefined && total > 0n && vaultBal !== undefined
      ? (vaultBal * BPS_DENOMINATOR) / total
      : undefined

  const band = actualReserveBps !== undefined ? reserveBandLabel(actualReserveBps) : null

  function refetch() { r1(); r2(); r3(); r4() }

  return (
    <div className="stats-bar">
      <div className="stat">
        <div className="stat-label">Total Value Locked</div>
        <div className="stat-value">{fmtUsdc(s?.totalTVL)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Price Per Share</div>
        <div className="stat-value">{fmtPps(pps as bigint | undefined)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Locked Ratio</div>
        <div className="stat-value">{fmtBps(s?.lockedRatioBps)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Total Locks Ever</div>
        <div className="stat-value">{s?.totalLocksEver?.toString() ?? '–'}</div>
      </div>

      {/* Reserve band — displays actual vault reserve % vs 15/30/35 reference */}
      <div className="stat" style={{ minWidth: 160 }}>
        <div className="stat-label">Reserve Ratio</div>
        <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{actualReserveBps !== undefined ? (Number(actualReserveBps) / 100).toFixed(1) + '%' : '–'}</span>
          {band && <span className={`badge ${band.cls}`} style={{ fontSize: 10, padding: '2px 6px' }}>{band.label}</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted, #888)', marginTop: 3 }}>
          Floor 15% · Target 30% · Ceiling 35%
        </div>
      </div>

      <div className="stat" style={{ flex: '0 0 auto', padding: '10px 12px' }}>
        <button className="btn-secondary btn-sm" onClick={refetch}>↻</button>
      </div>
    </div>
  )
}
