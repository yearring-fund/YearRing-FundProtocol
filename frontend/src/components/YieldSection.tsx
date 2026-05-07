import { formatUnits } from 'viem'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI, LockLedger_ABI, LockPointsRebateManager_ABI, LockBenefit_ABI } from '../contracts/abis'
import { fmtUsdc, fmtShares, fmtPps, fmtBps } from '../utils'

// ─── Mock NAV Sparkline ───────────────────────────────────────────────────────

function NavSparkline({ pps }: { pps: bigint | undefined }) {
  const DAYS        = 30
  const W           = 400
  const H           = 70
  const DAILY_RATE  = 9 / 10_000 / 30   // 9 bps/month ÷ 30 days

  const currentNav = pps ? parseFloat(formatUnits(pps as bigint, 6)) : 1.0

  // Reconstruct 30-day history: work backwards from current NAV
  const points = Array.from({ length: DAYS }, (_, i) => {
    const daysFromEnd = DAYS - 1 - i
    return currentNav / Math.pow(1 + DAILY_RATE, daysFromEnd)
  })

  const minP  = Math.min(...points)
  const maxP  = Math.max(...points)
  const range = maxP - minP || 1e-9

  const coords = points.map((p, i) => {
    const x = (i / (DAYS - 1)) * W
    const y = H - 8 - ((p - minP) / range) * (H - 16)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  // Closed path for gradient fill
  const fillPath =
    `M ${coords[0]} ` +
    coords.slice(1).map(c => `L ${c}`).join(' ') +
    ` L ${W},${H} L 0,${H} Z`

  return (
    <div className="sparkline-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>30-Day NAV Trend</span>
        <span className="demo-tag">Simulated data</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--blue)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#navFill)" />
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

// ─── Mock Daily Yield Table ───────────────────────────────────────────────────

function DailyYieldTable({ currentValueUsdc }: { currentValueUsdc: number }) {
  const DAILY_RATE = 9 / 10_000 / 30
  const today      = new Date()

  const rows = Array.from({ length: 7 }, (_, i) => {
    const d   = new Date(today)
    d.setDate(d.getDate() - (6 - i))
    const daysFromEnd = 6 - i
    const valueOnDay  = currentValueUsdc / Math.pow(1 + DAILY_RATE, daysFromEnd)
    const dailyYield  = valueOnDay * DAILY_RATE
    return {
      date:  d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }),
      yield: dailyYield,
    }
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Last 7-Day Yield Breakdown</span>
        <span className="demo-tag">Simulated data</span>
      </div>
      <table className="yield-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Daily Base Yield</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.date}>
              <td>{r.date}</td>
              <td style={{ color: 'var(--green)' }}>+{r.yield.toFixed(6)} USDC</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function YieldSection() {
  const { address } = useAccount()
  const vaultOk     = !!address && !!ADDRESSES.YearRingCoreVaultV01

  const { data: shares, refetch: r1 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: vaultOk },
  })
  const { data: pps, refetch: r2 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'pricePerShare',
    query: { enabled: !!ADDRESSES.YearRingCoreVaultV01 },
  })
  const { data: currentValue, refetch: r3 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'convertToAssets',
    args: shares ? [shares as bigint] : undefined,
    query: { enabled: vaultOk && !!shares },
  })
  const { data: lockIds, refetch: r4 } = useReadContract({
    address: ADDRESSES.LockLedgerV02,
    abi: LockLedger_ABI,
    functionName: 'userLockIds',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!ADDRESSES.LockLedgerV02 },
  })

  const ids = (lockIds as bigint[] | undefined) ?? []

  // Batch: previewRebate for all locks
  const { data: rebateResults } = useReadContracts({
    contracts: ids.map(id => ({
      address: ADDRESSES.LockPointsRebateManagerV02,
      abi: LockPointsRebateManager_ABI,
      functionName: 'previewRebate' as const,
      args: [id] as const,
    })),
    query: { enabled: ids.length > 0 },
  })

  // Batch: feeDiscountBpsOf for all locks
  const { data: discountResults } = useReadContracts({
    contracts: ids.map(id => ({
      address: ADDRESSES.LockBenefitV02,
      abi: LockBenefit_ABI,
      functionName: 'feeDiscountBpsOf' as const,
      args: [id] as const,
    })),
    query: { enabled: ids.length > 0 },
  })

  function refetch() { r1(); r2(); r3(); r4() }

  // ── Derived values ──────────────────────────────────────────────────────────

  const sharesVal     = shares as bigint | undefined
  const ppsVal        = pps    as bigint | undefined
  const currentVal    = currentValue as bigint | undefined

  // Cost basis at initial PPS = 1.000000: shares(18-dec) / 1e12 = USDC(6-dec)
  const costBasis     = sharesVal !== undefined ? sharesVal / 1_000_000_000_000n : undefined

  // Cumulative yield = current value − cost basis
  const cumulativeYield =
    currentVal !== undefined && costBasis !== undefined
      ? currentVal - costBasis
      : undefined

  // Total pending rebate (sum across all active locks)
  const totalRebate = rebateResults
    ? rebateResults.reduce((sum, r) => sum + ((r.result as bigint | undefined) ?? 0n), 0n)
    : undefined

  // Best (max) fee rebate rate across active locks
  const bestDiscount = discountResults
    ? discountResults.reduce((max, r) => {
        const v = (r.result as bigint | undefined) ?? 0n
        return v > max ? v : max
      }, 0n)
    : undefined

  const currentValueNum = currentVal ? parseFloat(formatUnits(currentVal as bigint, 6)) : 0

  if (!address) {
    return (
      <div className="card">
        <div className="card-title">Base Yield</div>
        <p className="note">Connect wallet to view yield details.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-title">Base Yield</div>

      {/* ── Position Summary ── */}
      <div className="info-row">
        <span className="info-label">Current Position NAV</span>
        <span className="info-value">{fmtUsdc(currentVal)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Shares Held</span>
        <span className="info-value">{fmtShares(sharesVal)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Current NAV Price</span>
        <span className="info-value">{fmtPps(ppsVal)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Cost Basis (initial PPS=1)</span>
        <span className="info-value">{fmtUsdc(costBasis)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Cumulative Base Yield</span>
        <span className="info-value" style={{ color: cumulativeYield !== undefined && cumulativeYield >= 0n ? 'var(--green)' : 'var(--red)' }}>
          {cumulativeYield === undefined
            ? '–'
            : (cumulativeYield >= 0n ? '+' : '') + fmtUsdc(cumulativeYield)}
        </span>
      </div>

      <hr className="divider" />

      {/* ── Management Fee Rebate ── */}
      <div className="info-row">
        <span className="info-label">Mgmt Fee Rebate (best tier)</span>
        <span className="info-value">
          {bestDiscount === undefined || bestDiscount === 0n
            ? <span style={{ color: 'var(--muted)' }}>None (no active lock)</span>
            : fmtBps(bestDiscount)}
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">Pending Fee Rebate (total)</span>
        <span className="info-value" style={{ color: totalRebate && totalRebate > 0n ? 'var(--green)' : undefined }}>
          {totalRebate === undefined ? '–' : fmtShares(totalRebate)}
        </span>
      </div>
      <p className="note">
        Fee rebates are paid in yrCORE shares from Treasury and can be claimed per-lock in the Lock section.
        Rebate is a protocol benefit for eligible locked users. It is not guaranteed yield and may depend on protocol rules and available fee accrual.
      </p>

      <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={refetch}>
        ↻ Refresh
      </button>

      <hr className="divider" />

      {/* ── Daily Yield List (mock) ── */}
      {currentValueNum > 0
        ? <DailyYieldTable currentValueUsdc={currentValueNum} />
        : <p className="note">Deposit funds to view daily yield breakdown.</p>
      }

      <hr className="divider" />

      {/* ── NAV Chart (mock) ── */}
      <NavSparkline pps={ppsVal} />
    </div>
  )
}
