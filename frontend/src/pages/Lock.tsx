import { useState } from 'react'
import {
  useAccount, useChainId,
  useReadContract,
  useWriteContract,
} from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI, LockLedger_ABI, LockPointsRebateManager_ABI } from '../contracts/abis'
import {
  fmtShares, fmtPoints, fmtUsdc, shortErr,
  DURATION_30D, DURATION_90D, DURATION_180D,
  parseSharesInput,
} from '../utils'
import { BASE_ID } from '../wagmiConfig'

// Tiers
const TIERS = [
  { label: 'Bronze', duration: DURATION_30D,  days: 30,  multiplierBps: 10000, discountLabel: '20%', discountBps: 2000 },
  { label: 'Silver', duration: DURATION_90D,  days: 90,  multiplierBps: 13000, discountLabel: '40%', discountBps: 4000 },
  { label: 'Gold',   duration: DURATION_180D, days: 180, multiplierBps: 18000, discountLabel: '60%', discountBps: 6000 },
]

// Points formula constant: USDC 6-dec × 1e12 × days × multiplierBps / (10000 × 500)
const POINTS_DENOMINATOR = 5_000_000n
const USDC_TO_POINTS_SCALE = 1_000_000_000_000n

type LockStep = 'idle' | 'approving' | 'approve-wait' | 'locking' | 'lock-wait' | 'done' | 'error'

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

export default function Lock() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [tierIdx, setTierIdx] = useState(0)
  const [sharesInput, setSharesInput] = useState('')
  const [step, setStep] = useState<LockStep>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [txHashApprove, setTxHashApprove] = useState('')
  const [txHashLock, setTxHashLock] = useState('')

  const tier = TIERS[tierIdx]
  const sharesBn = parseSharesInput(sharesInput)

  const { data: yrCoreBal } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: yrCoreAllowance } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'allowance',
    args: address ? [address, ADDRESSES.LockPointsRebateManagerV02] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: activeLockCount } = useReadContract({
    address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI, functionName: 'activeLockCount',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: usdcValue } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'convertToAssets',
    args: sharesBn > 0n ? [sharesBn] : undefined,
    query: { enabled: enabled && sharesBn > 0n },
  })

  // Preview Points: usdcValue(6dec) × 1e12 × durationDays × multiplierBps / (10000 × 500)
  const previewPoints = usdcValue && usdcValue > 0n
    ? usdcValue * USDC_TO_POINTS_SCALE * BigInt(tier.days) * BigInt(tier.multiplierBps) / (POINTS_DENOMINATOR * 10000n)
    : 0n

  const unlockDate = sharesBn > 0n
    ? new Date(Date.now() + tier.duration * 1000).toLocaleDateString()
    : '–'

  const { writeContractAsync } = useWriteContract()

  const needsApprove = yrCoreAllowance !== undefined && sharesBn > 0n && yrCoreAllowance < sharesBn

  function validate(): string | null {
    if (!isConnected) return 'Connect wallet first'
    if (!sharesBn || sharesBn <= 0n) return 'Enter a valid share amount'
    if (yrCoreBal !== undefined && sharesBn > yrCoreBal) return 'Exceeds available yrCORE balance'
    if (activeLockCount !== undefined && Number(activeLockCount) >= 5) return 'Maximum 5 active locks reached'
    return null
  }

  async function handleMain() {
    const err = validate()
    if (err) { setErrMsg(err); return }
    setErrMsg('')
    try {
      if (needsApprove) {
        setStep('approving')
        const hash = await writeContractAsync({
          address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'approve',
          args: [ADDRESSES.LockPointsRebateManagerV02, sharesBn],
        })
        setTxHashApprove(hash)
        setStep('approve-wait')
        // Small wait for approval to confirm
        await new Promise(r => setTimeout(r, 3000))
      }
      setStep('locking')
      const hash = await writeContractAsync({
        address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI, functionName: 'lockWithPoints',
        args: [sharesBn, BigInt(tier.duration)],
      })
      setTxHashLock(hash)
      setStep('lock-wait')
      await new Promise(r => setTimeout(r, 3000))
      setStep('done')
    } catch (e) {
      setErrMsg(shortErr(e))
      setStep('error')
    }
  }

  function btnLabel() {
    if (step === 'approving' || step === 'approve-wait') return 'Approving yrCORE shares…'
    if (step === 'locking' || step === 'lock-wait') return 'Locking + issuing Points…'
    if (step === 'done') return 'Locked ✓'
    if (needsApprove) return 'Approve yrCORE shares'
    return 'Lock + Earn Points'
  }

  const busy = step === 'approving' || step === 'approve-wait' || step === 'locking' || step === 'lock-wait'
  const done = step === 'done'

  function reset() {
    setStep('idle'); setSharesInput(''); setTxHashApprove(''); setTxHashLock(''); setErrMsg('')
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Lock yrCORE shares</div>
        <div className="note">Lock shares for a fixed duration to receive Points and become eligible for management fee rebates.</div>
      </div>

      <div className="card">
        <div className="card-title">Lock Settings</div>

        {/* Portfolio info */}
        <div className="info-row">
          <span className="info-label">Available yrCORE</span>
          <span className="info-value">{fmtShares(yrCoreBal)}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Active Locks</span>
          <span className="info-value">
            {activeLockCount?.toString() ?? '–'} / 5
            {activeLockCount !== undefined && Number(activeLockCount) >= 5 && (
              <span className="badge badge-red" style={{ marginLeft: 8 }}>Full</span>
            )}
          </span>
        </div>

        <hr className="divider" />

        {/* Tier selection */}
        <div style={{ marginBottom: 10 }}>
          <div className="info-label" style={{ marginBottom: 8 }}>Select Tier</div>
          <div className="tier-btns">
            {TIERS.map((t, i) => (
              <button
                key={t.label}
                className={'tier-btn' + (tierIdx === i ? ' selected' : '')}
                onClick={() => { setTierIdx(i); setStep('idle'); setErrMsg('') }}
                disabled={busy || done}
              >
                <div style={{ fontWeight: 700 }}>{t.label}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{t.days}d · {t.discountLabel} fee rebate</div>
              </button>
            ))}
          </div>
        </div>

        {/* Shares input */}
        <div className="field">
          <label>yrCORE shares to lock</label>
          <input
            type="number" min="0" step="0.000001"
            placeholder="0.000000"
            value={sharesInput}
            onChange={e => { setSharesInput(e.target.value); setStep('idle'); setErrMsg('') }}
            disabled={busy || done}
          />
        </div>

        {/* Preview block */}
        {sharesBn > 0n && (
          <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
              Lock Preview
            </div>
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Tier</span>
              <span>{tier.label}</span>
            </div>
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Duration</span>
              <span>{tier.days} days</span>
            </div>
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Multiplier</span>
              <span>{(tier.multiplierBps / 100).toFixed(1)}×</span>
            </div>
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Fee Rebate</span>
              <span style={{ color: 'var(--green)' }}>{tier.discountLabel}</span>
            </div>
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Upfront Points</span>
              <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{fmtPoints(previewPoints)}</span>
            </div>
            {usdcValue !== undefined && (
              <div className="info-row" style={{ padding: '3px 0' }}>
                <span className="info-label">Underlying USDC Value</span>
                <span>{fmtUsdc(usdcValue)}</span>
              </div>
            )}
            <div className="info-row" style={{ padding: '3px 0' }}>
              <span className="info-label">Unlock Date</span>
              <span>{unlockDate}</span>
            </div>
            <div className="note" style={{ marginTop: 8, color: 'var(--yellow)' }}>
              Warning: Early exit may remove the Points associated with this lock before returning vault shares or assets. Locked shares cannot be redeemed until unlock.
            </div>
          </div>
        )}

        <div className="note" style={{ marginTop: 12 }}>
          This is a long-term commitment. Locked shares are not available for ordinary redemption during the lock period.
          Early exit is possible but requires returning all issued Points.
          Rebate is a protocol benefit for eligible locked users. It is not guaranteed yield and may depend on protocol rules and available fee accrual.
          Points are an internal closed beta accounting mechanism and are not a live tradable token.
        </div>

        <div className="btn-row">
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={handleMain}
            disabled={busy || done || (activeLockCount !== undefined && Number(activeLockCount) >= 5)}
          >
            {btnLabel()}
          </button>
          {(done || step === 'error') && (
            <button className="btn-secondary" onClick={reset}>Reset</button>
          )}
        </div>

        {errMsg && <div className="status err">{errMsg}</div>}
        {txHashApprove && <TxResult hash={txHashApprove} label="Approve yrCORE shares" />}
        {txHashLock && done && <TxResult hash={txHashLock} label="Lock + Issue Points" />}
      </div>
    </div>
  )
}
