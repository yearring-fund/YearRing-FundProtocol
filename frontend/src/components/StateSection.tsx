import { useAccount, useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { UserState_ABI, FundVault_ABI } from '../contracts/abis'
import { fmtShares, lockStateName } from '../utils'

const STATE_BADGE: Record<number, string> = {
  0: 'badge-gray',
  1: 'badge-blue',
  2: 'badge-yellow',
  3: 'badge-red',
}

export default function StateSection() {
  const { address } = useAccount()
  const enabled = !!address

  const { data: state, refetch: r1 } = useReadContract({
    address: ADDRESSES.UserStateEngineV02, abi: UserState_ABI,
    functionName: 'userStateOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!ADDRESSES.UserStateEngineV02 },
  })

  const { data: totalShares, refetch: r2 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!ADDRESSES.YearRingCoreVaultV01 },
  })

  // userLockedSharesOf(address) is a confirmed view on LockLedgerV02 — sums active locked shares on-chain
  const { data: lockedShares, refetch: r3 } = useReadContract({
    address: ADDRESSES.LockLedgerV02,
    abi: [{ name: 'userLockedSharesOf', type: 'function', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as const,
    functionName: 'userLockedSharesOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!ADDRESSES.LockLedgerV02 },
  })

  const stateNum   = state !== undefined ? Number(state) : undefined
  const total      = totalShares as bigint | undefined
  const locked     = lockedShares as bigint | undefined
  const free       = total !== undefined && locked !== undefined ? total - locked : undefined

  function refetch() { r1(); r2(); r3() }

  if (!address) {
    return (
      <div className="card">
        <div className="card-title">User State</div>
        <p className="note">Connect wallet to view your state.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-title">User State</div>

      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="info-label">State:</span>
        <span className={`badge ${stateNum !== undefined ? (STATE_BADGE[stateNum] ?? 'badge-gray') : 'badge-gray'}`}>
          {lockStateName(stateNum)}
        </span>
      </div>

      <div className="info-row"><span className="info-label">Total yrCORE</span>  <span>{fmtShares(total)}</span></div>
      <div className="info-row"><span className="info-label">Locked shares</span> <span>{fmtShares(locked)}</span></div>
      <div className="info-row"><span className="info-label">Free shares</span>   <span>{fmtShares(free)}</span></div>
      <button className="btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={refetch}>↻ Refresh</button>

      <hr className="divider" />

      <p className="note">
        <strong>Normal</strong> — no active lock.<br />
        <strong>Locked (Accumulating)</strong> — lock live, rebate accruing.<br />
        <strong>Matured</strong> — past unlockAt, ready to unlock via Lock section.<br />
        <strong>Early Exited</strong> — exited before maturity; Points were deducted.
      </p>
    </div>
  )
}
