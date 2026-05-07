import { formatUnits } from 'viem'
import { useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI, PointsToken_ABI } from '../contracts/abis'
import { fmtPoints } from '../utils'

export default function RwtRulesSection() {
  const { data: treasury, refetch: r1 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'treasury',
    query: { enabled: !!ADDRESSES.YearRingCoreVaultV01 },
  })

  const treasuryAddr = treasury as `0x${string}` | undefined

  const { data: treasuryBal, refetch: r2 } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI,
    functionName: 'balanceOf',
    args: treasuryAddr ? [treasuryAddr] : undefined,
    query: { enabled: !!treasuryAddr && !!ADDRESSES.PointsToken },
  })
  const { data: totalSupply, refetch: r3 } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI,
    functionName: 'totalSupply',
    query: { enabled: !!ADDRESSES.PointsToken },
  })

  const bal     = treasuryBal as bigint | undefined
  const supply  = totalSupply as bigint | undefined
  const issued  = bal !== undefined && supply !== undefined ? supply - bal : undefined

  const issuedPctBps = issued !== undefined && supply !== undefined && supply > 0n
    ? (issued * 10000n) / supply
    : undefined
  const issuedPct = issuedPctBps !== undefined
    ? `${issuedPctBps / 100n}.${(issuedPctBps % 100n).toString().padStart(2, '0')}%`
    : '–'

  function refetch() { r1(); r2(); r3() }

  return (
    <div className="card">
      <div className="card-title">Points Rules</div>

      {/* ── Supply ── */}
      <div className="rules-block">
        <div className="rules-block-title">Points Supply</div>
        <div className="info-row">
          <span className="info-label">Total Supply (fixed)</span>
          <span className="info-value">{supply !== undefined ? parseFloat(formatUnits(supply, 18)).toLocaleString() + ' Points' : '–'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Issuance Method</span>
          <span className="info-value">Pre-minted in full to Treasury at deployment</span>
        </div>
        <div className="info-row">
          <span className="info-label">Additional Mint</span>
          <span className="info-value" style={{ color: 'var(--red)' }}>No — supply is permanently fixed</span>
        </div>
        <div className="info-row">
          <span className="info-label">Treasury Balance</span>
          <span className="info-value">{fmtPoints(bal)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Issued to Users</span>
          <span className="info-value">
            {fmtPoints(issued)}
            {issued !== undefined && (
              <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                ({issuedPct})
              </span>
            )}
          </span>
        </div>
      </div>

      <hr className="divider" />

      {/* ── Issuance Rules ── */}
      <div className="rules-block">
        <div className="rules-block-title">Issuance Rules</div>
        <div className="info-row">
          <span className="info-label">Distribution Method</span>
          <span className="info-value">Upfront — issued in full at lock time</span>
        </div>
        <div className="info-row">
          <span className="info-label">Base Issuance Rate</span>
          <span className="info-value">500 USDC principal × 1 day = 1 Point</span>
        </div>
        <div className="info-row">
          <span className="info-label">Calculation Basis</span>
          <span className="info-value">USDC value of yrCORE shares at the time of locking</span>
        </div>
        <p className="note" style={{ marginTop: 6 }}>
          Formula: Points = lockValue(USDC) × lockDays × tierMultiplier ÷ 500
        </p>
      </div>

      <hr className="divider" />

      {/* ── Tier Multipliers ── */}
      <div className="rules-block">
        <div className="rules-block-title">Tier Multipliers</div>
        <table className="yield-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Lock Duration</th>
              <th>Points Multiplier</th>
              <th>Example (1000 USDC × lock period)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge badge-gray">Bronze</span></td>
              <td>30 days</td>
              <td>1.0×</td>
              <td style={{ color: 'var(--muted)' }}>1000 × 30 × 1.0 ÷ 500 = <strong style={{ color: 'var(--text)' }}>60 Points</strong></td>
            </tr>
            <tr>
              <td><span className="badge badge-blue">Silver</span></td>
              <td>90 days</td>
              <td>1.3×</td>
              <td style={{ color: 'var(--muted)' }}>1000 × 90 × 1.3 ÷ 500 = <strong style={{ color: 'var(--text)' }}>234 Points</strong></td>
            </tr>
            <tr>
              <td><span className="badge badge-yellow">Gold</span></td>
              <td>180 days</td>
              <td>1.8×</td>
              <td style={{ color: 'var(--muted)' }}>1000 × 180 × 1.8 ÷ 500 = <strong style={{ color: 'var(--text)' }}>648 Points</strong></td>
            </tr>
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 8 }}>
          Early exit requires returning all issued Points, otherwise the transaction will revert.
          Holding to maturity permanently retains Points — no return required.
        </p>
      </div>

      <hr className="divider" />

      {/* ── Disclaimer ── */}
      <div className="rules-block">
        <p className="note">
          Points are a closed beta commitment incentive. They are <strong>not</strong> the
          protocol's native token and do not constitute guaranteed yield. Once the native token
          launches, early testing rewards will be distributed based on users' Points holdings at
          that time.
        </p>
        <p className="note" style={{ marginTop: 4 }}>
          原生代币上线后，将按用户当时持有的 Points 数量进行早期测试奖励分配。
        </p>
      </div>

      <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={refetch}>
        ↻ Refresh
      </button>
    </div>
  )
}
