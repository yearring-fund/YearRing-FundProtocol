import { useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI } from '../contracts/abis'

export default function FeeRulesSection() {
  const { data: feeBps, refetch } = useReadContract({
    address: ADDRESSES.FundVaultV01, abi: FundVault_ABI,
    functionName: 'mgmtFeeBpsPerMonth',
    query: { enabled: !!ADDRESSES.FundVaultV01 },
  })

  const bps        = feeBps as bigint | undefined
  const annualPct  = bps !== undefined ? ((Number(bps) / 10_000) * 12 * 100).toFixed(2) + '%' : '–'
  const monthlyPct = bps !== undefined ? ((Number(bps) / 10_000) * 100).toFixed(4) + '%' : '–'

  return (
    <div className="card">
      <div className="card-title">Management Fee Rules</div>

      {/* ── Base Rate ── */}
      <div className="rules-block">
        <div className="rules-block-title">Base Rate</div>
        <div className="info-row">
          <span className="info-label">Annualized Management Fee</span>
          <span className="info-value">{annualPct}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Monthly Rate (on-chain param)</span>
          <span className="info-value">{monthlyPct}
            {bps !== undefined && (
              <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                ({bps.toString()} bps/month)
              </span>
            )}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Collection Method</span>
          <span className="info-value">Linearly accrued per second, minting fbUSDC shares to Treasury</span>
        </div>
        <div className="info-row">
          <span className="info-label">Settlement Trigger</span>
          <span className="info-value">Auto-settled on deposit / redeem; admin can also call Accrue Fee manually</span>
        </div>
        <p className="note" style={{ marginTop: 6 }}>
          V2 fee rate is fixed and not user-adjustable. Rate changes must be executed by the admin via the Admin Console.
        </p>
      </div>

      <hr className="divider" />

      {/* ── Lock Discount Tiers ── */}
      <div className="rules-block">
        <div className="rules-block-title">Lock Discount &amp; Fee Rebate</div>
        <p className="note" style={{ marginBottom: 8 }}>
          Locking fbUSDC entitles you to a partial management fee rebate. The discount applies to the management fee itself and is paid in fbUSDC shares.
        </p>
        <table className="yield-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Lock Duration</th>
              <th>Mgmt Fee Discount</th>
              <th>RWT Multiplier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge badge-gray">Bronze</span></td>
              <td>30 days</td>
              <td style={{ color: 'var(--green)' }}>20%</td>
              <td>1.0×</td>
            </tr>
            <tr>
              <td><span className="badge badge-blue">Silver</span></td>
              <td>90 days</td>
              <td style={{ color: 'var(--green)' }}>40%</td>
              <td>1.3×</td>
            </tr>
            <tr>
              <td><span className="badge badge-yellow">Gold</span></td>
              <td>180 days</td>
              <td style={{ color: 'var(--green)' }}>60%</td>
              <td>1.8×</td>
            </tr>
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 8 }}>
          On-chain rebate formula (accrued per second):<br />
          <code>rebate(fbUSDC) = lockedShares × (mgmtBps ÷ 10,000) × (discountBps ÷ 10,000) × (elapsedSeconds ÷ 2,592,000)</code>
          <br /><br />
          Example: Bronze, 1000 fbUSDC, full 30 days →<br />
          1000 × (9÷10000) × (2000÷10000) × 1 = <strong>0.18 fbUSDC</strong> (≈ 20% of management fee)
          <br /><br />
          Early exit requires returning all issued RWT; fee rebate is settled based on actual lock duration and can be claimed at any time.
        </p>
      </div>

      <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => refetch()}>
        ↻ Refresh
      </button>
    </div>
  )
}
