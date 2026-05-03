import { useAccount, useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { RewardToken_ABI } from '../contracts/abis'
import { fmtRwt } from '../utils'

export default function IncentiveSection() {
  const { address } = useAccount()

  const { data: rwtBal, refetch } = useReadContract({
    address: ADDRESSES.RewardToken, abi: RewardToken_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!ADDRESSES.RewardToken },
  })

  return (
    <div className="card">
      <div className="card-title">Incentives</div>

      <div className="info-row">
        <span className="info-label">RWT Balance</span>
        <span className="info-value">{fmtRwt(rwtBal as bigint | undefined)}</span>
      </div>
      <button className="btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => refetch()}>↻ Refresh</button>

      <hr className="divider" />

      <div className="note">
        <strong>RWT (Reward Token)</strong> is issued upfront at lock time.
        Issuance formula: 500 USDC principal × 1 day = 1 RWT × tier multiplier.
        Total supply is fixed at 20,000,000 RWT — V2 does not mint additional tokens.
        See the RWT Rules section for full details.
        <br /><br />
        <strong>Fee Rebate</strong> accrues linearly over the lock duration
        and is paid in fbUSDC shares from Treasury, claimable per-lock in the Lock section at any time.
        <br /><br />
        Tier discounts:
        <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 11 }}>
          <li>Bronze (30d): 1.0× RWT · 20% management fee rebate</li>
          <li>Silver (90d): 1.3× RWT · 40% management fee rebate</li>
          <li>Gold (180d): 1.8× RWT · 60% management fee rebate</li>
        </ul>
      </div>
    </div>
  )
}
