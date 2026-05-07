import { useState } from 'react'
import {
  useAccount, useChainId,
  useReadContract,
  useWriteContract,
} from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import {
  FundVault_ABI,
  LockLedger_ABI,
  LockBenefit_ABI,
  LockPointsRebateManager_ABI,
  UserState_ABI,
  PointsToken_ABI,
} from '../contracts/abis'
import { fmtShares, fmtPoints, fmtTs, shortErr, tierName, lockStateName } from '../utils'
import { BASE_ID } from '../wagmiConfig'

function TxResult({ hash, label }: { hash: string; label: string }) {
  return (
    <div className="result-card">
      <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>{label} — Confirmed</div>
      <div className="note">
        tx: <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer"
          style={{ color: 'var(--green)' }}>
          {hash.slice(0, 10)}…{hash.slice(-8)}
        </a>
        {' '}↗ Basescan
      </div>
    </div>
  )
}

type CardStep = 'idle' | 'busy' | 'done' | 'error'
type EarlyExitStep = 'idle' | 'approving' | 'exiting' | 'done' | 'error'

function PositionCard({ lockId }: { lockId: bigint }) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [rebaseStep, setRebaseStep] = useState<CardStep>('idle')
  const [rebaseTx, setRebaseTx] = useState('')
  const [unlockStep, setUnlockStep] = useState<CardStep>('idle')
  const [unlockTx, setUnlockTx] = useState('')
  const [exitStep, setExitStep] = useState<EarlyExitStep>('idle')
  const [exitTx, setExitTx] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  const { data: lock } = useReadContract({
    address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI, functionName: 'getLock',
    args: [lockId],
    query: { enabled },
  })
  const { data: tier } = useReadContract({
    address: ADDRESSES.LockBenefitV02, abi: LockBenefit_ABI, functionName: 'tierOf',
    args: [lockId],
    query: { enabled },
  })
  const { data: rebate } = useReadContract({
    address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI, functionName: 'previewRebate',
    args: [lockId],
    query: { enabled },
  })
  const { data: issuedPoints } = useReadContract({
    address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI, functionName: 'issuedPoints',
    args: [lockId],
    query: { enabled },
  })
  const { data: lockState } = useReadContract({
    address: ADDRESSES.UserStateEngineV02, abi: UserState_ABI, functionName: 'lockStateOf',
    args: [lockId],
    query: { enabled },
  })
  const { data: earlyExitInfo } = useReadContract({
    address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI, functionName: 'checkEarlyExit',
    args: [lockId],
    query: { enabled },
  })
  const { data: pointsAllowance } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI, functionName: 'allowance',
    args: address ? [address, ADDRESSES.LockPointsRebateManagerV02] : undefined,
    query: { enabled: enabled && !!address },
  })

  const { writeContractAsync } = useWriteContract()

  if (!lock) {
    return (
      <div className="lock-row">
        <div className="note">Loading lock #{lockId.toString()}…</div>
      </div>
    )
  }

  const isSettled = lock.unlocked || lock.earlyExited
  const canUnlock = !isSettled && Number(lock.unlockAt) * 1000 <= Date.now()
  const pointsToReturn = earlyExitInfo?.[1] ?? 0n
  const needsPointsApprove = pointsAllowance !== undefined && pointsToReturn > 0n && pointsAllowance < pointsToReturn

  function tierBadge(t: number | undefined) {
    const name = tierName(t)
    if (name === 'Gold')   return <span className="badge badge-yellow">Gold</span>
    if (name === 'Silver') return <span className="badge badge-gray">Silver</span>
    if (name === 'Bronze') return <span className="badge" style={{ background: '#2a1a0a', color: '#cd7f32', border: '1px solid #7a4010' }}>Bronze</span>
    return <span className="badge badge-gray">{name}</span>
  }

  function stateBadge(s: number | undefined) {
    if (s === 0) return <span className="badge badge-blue">Normal</span>
    if (s === 1) return <span className="badge badge-blue">Active Lock</span>
    if (s === 2) return <span className="badge badge-green">Matured</span>
    if (s === 3) return <span className="badge badge-gray">Exited</span>
    return <span className="badge badge-gray">–</span>
  }

  async function handleClaimRebate() {
    setErrMsg(''); setRebaseStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI,
        functionName: 'claimRebate', args: [lockId],
      })
      setRebaseTx(hash)
      setRebaseStep('done')
    } catch (e) {
      setErrMsg(shortErr(e)); setRebaseStep('error')
    }
  }

  async function handleUnlock() {
    setErrMsg(''); setUnlockStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI,
        functionName: 'unlock', args: [lockId],
      })
      setUnlockTx(hash)
      setUnlockStep('done')
    } catch (e) {
      setErrMsg(shortErr(e)); setUnlockStep('error')
    }
  }

  async function handleEarlyExit() {
    setErrMsg(''); setShowExitConfirm(false)
    try {
      if (needsPointsApprove) {
        setExitStep('approving')
        await writeContractAsync({
          address: ADDRESSES.PointsToken, abi: PointsToken_ABI,
          functionName: 'approve', args: [ADDRESSES.LockPointsRebateManagerV02, pointsToReturn],
        })
        await new Promise(r => setTimeout(r, 3000))
      }
      setExitStep('exiting')
      const hash = await writeContractAsync({
        address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI,
        functionName: 'earlyExit', args: [lockId],
      })
      setExitTx(hash)
      setExitStep('done')
    } catch (e) {
      setErrMsg(shortErr(e)); setExitStep('error')
    }
  }

  return (
    <div className="lock-row" style={{ marginBottom: 12 }}>
      <div className="lock-row-header">
        <span className="lock-id">Lock #{lockId.toString()}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {tierBadge(tier)}
          {isSettled
            ? <span className="badge badge-gray">Settled</span>
            : stateBadge(lockState)}
        </div>
      </div>

      <div className="info-row">
        <span className="info-label">Shares</span>
        <span>{fmtShares(lock.shares)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Locked At</span>
        <span>{fmtTs(lock.lockedAt)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Unlock At</span>
        <span>{fmtTs(lock.unlockAt)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Points issued</span>
        <span>{fmtPoints(issuedPoints)}</span>
      </div>
      {!isSettled && (
        <div className="info-row">
          <span className="info-label">Pending Rebate</span>
          <span style={{ color: 'var(--green)' }}>{fmtShares(rebate)}</span>
        </div>
      )}

      {!isSettled && (
        <>
          {/* Early exit info */}
          {earlyExitInfo && pointsToReturn > 0n && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: '#2d0b0b', border: '1px solid #5c1010', borderRadius: 6 }}>
              <div className="note" style={{ color: 'var(--red)', margin: 0 }}>
                Early exit may remove the Points associated with this lock. Must return <strong>{fmtPoints(pointsToReturn)}</strong> Points
              </div>
            </div>
          )}

          <div className="btn-row" style={{ marginTop: 10 }}>
            {/* Claim Rebate */}
            <button
              className="btn-green"
              style={{ borderRadius: 6, fontFamily: 'var(--font)', fontWeight: 500, cursor: 'pointer' }}
              onClick={handleClaimRebate}
              disabled={rebaseStep === 'busy' || rebaseStep === 'done' || !rebate || rebate === 0n}
            >
              {rebaseStep === 'busy' ? 'Claiming…' : rebaseStep === 'done' ? 'Claimed ✓' : 'Claim Rebate'}
            </button>

            {/* Unlock */}
            <button
              className="btn-secondary"
              onClick={handleUnlock}
              disabled={!canUnlock || unlockStep === 'busy' || unlockStep === 'done'}
              title={!canUnlock ? 'Not mature yet' : ''}
            >
              {unlockStep === 'busy' ? 'Unlocking…' : unlockStep === 'done' ? 'Unlocked ✓' : 'Unlock'}
            </button>

            {/* Early Exit */}
            {!lock.earlyExited && !lock.unlocked && (
              <button
                className="btn-danger"
                onClick={() => setShowExitConfirm(true)}
                disabled={exitStep === 'approving' || exitStep === 'exiting' || exitStep === 'done'}
              >
                {exitStep === 'approving' ? 'Approving Points…'
                  : exitStep === 'exiting' ? 'Exiting…'
                  : exitStep === 'done' ? 'Exited ✓'
                  : 'Early Exit'}
              </button>
            )}
          </div>

          {/* Early Exit confirmation */}
          {showExitConfirm && (
            <div style={{ marginTop: 10, padding: '12px', background: '#2d0b0b', border: '1px solid #5c1010', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Confirm Early Exit</div>
              <div className="note" style={{ color: 'var(--text)', marginBottom: 10 }}>
                Early exit may remove the Points associated with this lock before returning vault shares or assets.
                You will lose part of your rebate and must return <strong>{fmtPoints(pointsToReturn)}</strong> Points.
                This action cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-danger" onClick={handleEarlyExit}>
                  {needsPointsApprove ? '1. Approve Points → Exit' : 'Confirm Early Exit'}
                </button>
                <button className="btn-secondary" onClick={() => setShowExitConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {errMsg && <div className="status err" style={{ marginTop: 6 }}>{errMsg}</div>}
      {rebaseTx && rebaseStep === 'done' && <TxResult hash={rebaseTx} label="Claim Rebate" />}
      {unlockTx && unlockStep === 'done' && <TxResult hash={unlockTx} label="Unlock" />}
      {exitTx && exitStep === 'done' && <TxResult hash={exitTx} label="Early Exit" />}
    </div>
  )
}

export default function Positions() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const { data: lockIds } = useReadContract({
    address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI, functionName: 'userLockIds',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  if (!isConnected) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">Connect wallet to view positions.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>My Positions</div>
        <div className="note">
          {lockIds ? `${lockIds.length} lock(s) found` : 'Loading…'}
        </div>
      </div>

      {lockIds && lockIds.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">No lock positions found. Go to Lock to create one.</div>
        </div>
      )}

      {lockIds && lockIds.length > 0 && (
        <div className="card">
          <div className="card-title">Lock Positions</div>
          {lockIds.map((id: bigint) => (
            <PositionCard key={id.toString()} lockId={id} />
          ))}
          <p className="note" style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            Rebate is a protocol benefit for eligible locked users. It is not guaranteed yield and may depend on protocol rules and available fee accrual.
            Points are an internal closed beta accounting mechanism and are not a live tradable token.
          </p>
        </div>
      )}
    </div>
  )
}
