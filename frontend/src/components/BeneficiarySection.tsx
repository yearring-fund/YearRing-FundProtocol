import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { Beneficiary_ABI } from '../contracts/abis'
import { fmtAddr, fmtTs, shortErr, isZeroAddr } from '../utils'

export default function BeneficiarySection() {
  const { address } = useAccount()
  const [benInput, setBenInput]           = useState('')
  const [claimOwner, setClaimOwner]       = useState('')
  const [claimLockIds, setClaimLockIds]   = useState('')

  const enabled = !!address && !!ADDRESSES.BeneficiaryModuleV02

  const { data: currentBen, refetch: r1 } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'beneficiaryOf',
    args: address ? [address] : undefined, query: { enabled },
  })
  const { data: inactive, refetch: r2 } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'isInactive',
    args: address ? [address] : undefined, query: { enabled },
  })
  const { data: lastActive, refetch: r3 } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'lastActiveAt',
    args: address ? [address] : undefined, query: { enabled },
  })
  const { data: wasClaimed, refetch: r4 } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'claimed',
    args: address ? [address] : undefined, query: { enabled },
  })

  const { writeContract, isPending, data: hash, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const busy = isPending || isConfirming

  function refetch() { r1(); r2(); r3(); r4() }

  const ben = currentBen as `0x${string}` | undefined
  const benSet = ben && !isZeroAddr(ben) && ben.toLowerCase() !== address?.toLowerCase()

  function setBeneficiary() {
    if (!benInput) return
    writeContract({
      address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
      functionName: benSet ? 'updateBeneficiary' : 'setBeneficiary',
      args: [benInput as `0x${string}`],
    })
  }

  function revoke() {
    writeContract({
      address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
      functionName: 'revokeBeneficiary', args: [],
    })
  }

  function heartbeat() {
    writeContract({
      address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
      functionName: 'heartbeat', args: [],
    })
  }

  function executeClaim() {
    if (!claimOwner || !claimLockIds) return
    const ids = claimLockIds.split(',').map(s => BigInt(s.trim()))
    writeContract({
      address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
      functionName: 'executeClaim',
      args: [claimOwner as `0x${string}`, ids],
    })
  }

  return (
    <div className="card">
      <div className="card-title">Beneficiary</div>

      <div className="info-row">
        <span className="info-label">Your beneficiary</span>
        <span className="info-value mono" title={ben}>{fmtAddr(ben)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Your status</span>
        <span className={`badge ${inactive ? 'badge-red' : 'badge-green'}`}>
          {inactive ? 'Inactive' : 'Active'}
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">Last heartbeat</span>
        <span>{fmtTs(lastActive as bigint | undefined)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Positions claimed</span>
        <span>{wasClaimed === undefined ? '–' : wasClaimed ? 'Yes' : 'No'}</span>
      </div>
      <button className="btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={refetch}>↻ Refresh</button>

      <hr className="divider" />

      <div className="field">
        <label>Set / Update beneficiary address</label>
        <input type="text" placeholder="0x…" value={benInput} onChange={e => setBenInput(e.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn-primary"   disabled={busy || !address || !benInput} onClick={setBeneficiary}>
          {benSet ? 'Update Beneficiary' : 'Set Beneficiary'}
        </button>
        <button className="btn-danger"    disabled={busy || !address || !benSet}   onClick={revoke}>Revoke</button>
        <button className="btn-secondary" disabled={busy || !address}              onClick={heartbeat}>Heartbeat ♥</button>
      </div>

      <hr className="divider" />

      <div className="field">
        <label>Execute Claim — inactive user address</label>
        <input type="text" placeholder="0x… (the original lock owner)" value={claimOwner} onChange={e => setClaimOwner(e.target.value)} />
      </div>
      <div className="field">
        <label>Lock IDs to claim (comma-separated)</label>
        <input type="text" placeholder="e.g. 0, 1, 2" value={claimLockIds} onChange={e => setClaimLockIds(e.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn-green" disabled={busy || !address || !claimOwner || !claimLockIds} onClick={executeClaim}>
          Execute Claim
        </button>
      </div>

      {busy     && <div className="status info">Pending…</div>}
      {isSuccess && <div className="status ok">Done!</div>}
      {error    && <div className="status err">{shortErr(error)}</div>}

      <p className="note">
        Heartbeat records your last-active timestamp. Inactivity threshold: 365 days.<br />
        Execute Claim transfers <strong>locked positions only</strong>.
        Free yrCORE shares balance is <strong>not</strong> transferred.
        Fee rebate rights stay with the original lock owner.
      </p>
    </div>
  )
}
