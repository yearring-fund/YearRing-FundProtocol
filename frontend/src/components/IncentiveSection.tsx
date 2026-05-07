import { useAccount, useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { PointsToken_ABI } from '../contracts/abis'
import { fmtPoints } from '../utils'

export default function IncentiveSection() {
  const { address } = useAccount()

  const { data: pointsBal, refetch } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!ADDRESSES.PointsToken },
  })

  return (
    <div className="card">
      <div className="card-title">Incentives</div>

      <div className="info-row">
        <span className="info-label">Points Balance</span>
        <span className="info-value">{fmtPoints(pointsBal as bigint | undefined)}</span>
      </div>
      <button className="btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => refetch()}>↻ Refresh</button>

      <hr className="divider" />

      <div className="note">
        <strong>Points</strong> are issued upfront at lock time.
        Issuance formula: 500 USDC principal × 1 day = 1 Point × tier multiplier.
        Total supply is fixed at 20,000,000 Points — no additional minting.
        See the Points Rules section for full details.
        <br /><br />
        <strong>Fee Rebate</strong> accrues linearly over the lock duration
        and is paid in yrCORE shares from Treasury, claimable per-lock in the Lock section at any time.
        <br /><br />
        Tier discounts:
        <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 11 }}>
          <li>Bronze (30d): 1.0× Points · 20% management fee rebate</li>
          <li>Silver (90d): 1.3× Points · 40% management fee rebate</li>
          <li>Gold (180d): 1.8× Points · 60% management fee rebate</li>
        </ul>
        <br />
        <em>原生代币上线后，将按用户当时持有的 Points 数量进行早期测试奖励分配。</em>
      </div>
    </div>
  )
}
