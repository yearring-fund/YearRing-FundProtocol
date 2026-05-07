import { useState } from 'react'
import {
  useAccount, useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI } from '../contracts/abis'
import { parseUsdcInput, parseSharesInput, formatSharesForInput, fmtUsdc, fmtShares, fmtPps, shortErr } from '../utils'
import { BASE_ID } from '../wagmiConfig'

const USDC_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'allowance', type: 'function', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { name: 'approve',   type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
] as const

type DepositStep = 'idle' | 'approving' | 'approve-wait' | 'depositing' | 'deposit-wait' | 'done' | 'error'
type RedeemStep = 'idle' | 'redeeming' | 'redeem-wait' | 'done' | 'error'

function TxResult({ hash, label }: { hash: string; label: string }) {
  return (
    <div className="result-card">
      <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>{label} — Confirmed</div>
      <div className="note">
        tx: <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer"
          style={{ color: 'var(--green)' }}>
          {hash.slice(0, 10)}…{hash.slice(-8)}
        </a>
        <span style={{ marginLeft: 8, opacity: 0.7 }}>↗ Basescan</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Deposit Section
// ────────────────────────────────────────────────────────────
function DepositSection() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<DepositStep>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [txHashApprove, setTxHashApprove] = useState('')
  const [txHashDeposit, setTxHashDeposit] = useState('')

  const amountBn = parseUsdcInput(amount)

  const { data: usdcBal, refetch: refetchBal } = useReadContract({
    address: ADDRESSES.USDC, abi: USDC_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: ADDRESSES.USDC, abi: USDC_ABI, functionName: 'allowance',
    args: address ? [address, ADDRESSES.YearRingCoreVaultV01] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: depositsPaused } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'depositsPaused',
    query: { enabled },
  })
  const { data: systemMode } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'systemMode',
    query: { enabled },
  })
  const { data: isAllowed } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'isAllowed',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: pps } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'pricePerShare',
    query: { enabled },
  })
  const { data: preview } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'previewDeposit',
    args: amountBn > 0n ? [amountBn] : undefined,
    query: { enabled: enabled && amountBn > 0n },
  })

  const { writeContractAsync } = useWriteContract()
  const { data: approveReceipt } = useWaitForTransactionReceipt({
    hash: txHashApprove as `0x${string}` | undefined,
  })
  const { data: depositReceipt } = useWaitForTransactionReceipt({
    hash: txHashDeposit as `0x${string}` | undefined,
  })

  const isEmergency = systemMode === 2

  function validate(): string | null {
    if (!isConnected) return 'Connect wallet first'
    if (!isAllowed) return 'Your address is not whitelisted'
    if (depositsPaused) return 'Deposits are currently paused'
    if (isEmergency) return 'System is in Emergency Exit mode — deposits disabled'
    if (!amountBn || amountBn <= 0n) return 'Enter a valid amount'
    if (usdcBal !== undefined && amountBn > usdcBal) return 'Insufficient USDC balance'
    return null
  }

  const needsApprove = usdcAllowance !== undefined && amountBn > 0n && usdcAllowance < amountBn

  async function handleMain() {
    const err = validate()
    if (err) { setErrMsg(err); return }
    setErrMsg('')
    try {
      if (needsApprove) {
        setStep('approving')
        const hash = await writeContractAsync({
          address: ADDRESSES.USDC, abi: USDC_ABI, functionName: 'approve',
          args: [ADDRESSES.YearRingCoreVaultV01, amountBn],
        })
        setTxHashApprove(hash)
        setStep('approve-wait')
        // Wait for approval then deposit
        let waited = 0
        while (!approveReceipt && waited < 120) {
          await new Promise(r => setTimeout(r, 1000))
          waited++
          await refetchAllowance()
        }
      }
      setStep('depositing')
      const hash = await writeContractAsync({
        address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'deposit',
        args: [amountBn, address!],
      })
      setTxHashDeposit(hash)
      setStep('deposit-wait')
      await refetchBal()
      setStep('done')
    } catch (e) {
      setErrMsg(shortErr(e))
      setStep('error')
    }
  }

  function btnLabel() {
    if (step === 'approving' || step === 'approve-wait') return 'Approving USDC…'
    if (step === 'depositing' || step === 'deposit-wait') return 'Depositing…'
    if (step === 'done') return 'Completed ✓'
    if (needsApprove) return 'Approve USDC'
    return 'Deposit'
  }

  const busy = step === 'approving' || step === 'approve-wait' || step === 'depositing' || step === 'deposit-wait'
  const done = step === 'done'

  function reset() { setStep('idle'); setAmount(''); setTxHashApprove(''); setTxHashDeposit(''); setErrMsg('') }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">Deposit USDC</div>

      {isEmergency && (
        <div className="signal-banner" style={{ marginBottom: 12 }}>
          System is in Emergency Exit mode. Deposits are disabled.
        </div>
      )}
      {depositsPaused && !isEmergency && (
        <div className="signal-banner" style={{ marginBottom: 12 }}>
          Deposits are currently paused by the protocol.
        </div>
      )}
      {isAllowed === false && (
        <div className="signal-banner" style={{ marginBottom: 12 }}>
          Your address is not on the whitelist. Contact the protocol admin.
        </div>
      )}

      <div className="info-row">
        <span className="info-label">USDC Balance</span>
        <span className="info-value">{fmtUsdc(usdcBal)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Price Per Share</span>
        <span className="info-value">{fmtPps(pps)}</span>
      </div>

      <div className="field">
        <label>Amount (USDC)</label>
        <input
          type="number" min="0" step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={e => { setAmount(e.target.value); setStep('idle'); setErrMsg('') }}
          disabled={busy || done}
        />
      </div>

      {amountBn > 0n && preview !== undefined && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div className="info-row" style={{ padding: 0 }}>
            <span className="info-label">You will receive (est.)</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)' }}>{fmtShares(preview)}</span>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          onClick={handleMain}
          disabled={busy || done || isEmergency === true || depositsPaused === true || isAllowed === false}
        >
          {btnLabel()}
        </button>
        {(done || step === 'error') && (
          <button className="btn-secondary" onClick={reset}>Reset</button>
        )}
      </div>

      {errMsg && <div className="status err">{errMsg}</div>}

      {txHashApprove && <TxResult hash={txHashApprove} label="USDC Approve" />}
      {txHashDeposit && step === 'done' && <TxResult hash={txHashDeposit} label="Deposit" />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
//  Redeem Section
// ────────────────────────────────────────────────────────────
function RedeemSection() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [shares, setShares] = useState('')
  const [step, setStep] = useState<RedeemStep>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [txHash, setTxHash] = useState('')

  const sharesBn = parseSharesInput(shares)

  const { data: yrCoreBal, refetch: refetchBal } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: redeemsPaused } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'redeemsPaused',
    query: { enabled },
  })
  const { data: systemMode } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'systemMode',
    query: { enabled },
  })
  const { data: preview } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'previewRedeem',
    args: sharesBn > 0n ? [sharesBn] : undefined,
    query: { enabled: enabled && sharesBn > 0n },
  })

  // Free shares = total bal (for simplicity: full balance, locked amounts will revert at contract)
  const freeBal = yrCoreBal ?? 0n

  const { writeContractAsync } = useWriteContract()
  const isEmergency = systemMode === 2

  function setPct(pct: number) {
    if (!freeBal) return
    const val = freeBal * BigInt(pct) / 100n
    setShares(formatSharesForInput(val))
    setStep('idle')
    setErrMsg('')
  }

  function validate(): string | null {
    if (!isConnected) return 'Connect wallet first'
    if (redeemsPaused) return 'Redeems are currently paused'
    if (isEmergency) return 'Emergency Exit active — use claimExitAssets path'
    if (!sharesBn || sharesBn <= 0n) return 'Enter a valid amount'
    if (sharesBn > freeBal) return 'Exceeds available yrCORE balance'
    return null
  }

  async function handleRedeem() {
    const err = validate()
    if (err) { setErrMsg(err); return }
    setErrMsg('')
    setStep('redeeming')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI, functionName: 'redeem',
        args: [sharesBn, address!, address!],
      })
      setTxHash(hash)
      setStep('redeem-wait')
      await refetchBal()
      setStep('done')
    } catch (e) {
      setErrMsg(shortErr(e))
      setStep('error')
    }
  }

  function btnLabel() {
    if (step === 'redeeming' || step === 'redeem-wait') return 'Redeeming…'
    if (step === 'done') return 'Completed ✓'
    return 'Redeem'
  }

  const busy = step === 'redeeming' || step === 'redeem-wait'
  const done = step === 'done'

  function reset() { setStep('idle'); setShares(''); setTxHash(''); setErrMsg('') }

  return (
    <div className="card">
      <div className="card-title">Redeem yrCORE shares</div>

      {isEmergency && (
        <div className="signal-banner" style={{ background: '#2d0b0b', border: '1px solid #5c1010', color: 'var(--red)', marginBottom: 12 }}>
          Emergency Exit mode is active. Do not use standard redeem.
          Use <strong>claimExitAssets</strong> through the Claim page.
        </div>
      )}
      {redeemsPaused && !isEmergency && (
        <div className="signal-banner" style={{ marginBottom: 12 }}>
          Redeems are currently paused by the protocol.
        </div>
      )}

      <div className="info-row">
        <span className="info-label">Available yrCORE (free)</span>
        <span className="info-value">{fmtShares(freeBal)}</span>
      </div>
      <div className="note" style={{ marginBottom: 8 }}>
        Locked shares cannot be redeemed until unlocked. Use Positions to unlock.
      </div>

      <div className="field">
        <label>Shares to Redeem (yrCORE)</label>
        <input
          type="number" min="0" step="0.000001"
          placeholder="0.000000"
          value={shares}
          onChange={e => { setShares(e.target.value); setStep('idle'); setErrMsg('') }}
          disabled={busy || done}
        />
        <div className="pct-btns">
          {[25, 50, 100].map(p => (
            <button key={p} className="btn-secondary btn-sm" onClick={() => setPct(p)} disabled={busy || done}>
              {p}%
            </button>
          ))}
        </div>
      </div>

      {sharesBn > 0n && preview !== undefined && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <div className="info-row" style={{ padding: 0 }}>
            <span className="info-label">You will receive (est.)</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>{fmtUsdc(preview)}</span>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn-green"
          style={{ flex: 1, borderRadius: 6, fontFamily: 'var(--font)', fontWeight: 500, cursor: 'pointer' }}
          onClick={handleRedeem}
          disabled={busy || done || redeemsPaused === true || isEmergency === true}
        >
          {btnLabel()}
        </button>
        {(done || step === 'error') && (
          <button className="btn-secondary" onClick={reset}>Reset</button>
        )}
      </div>

      {errMsg && <div className="status err">{errMsg}</div>}
      {txHash && done && <TxResult hash={txHash} label="Redeem" />}
    </div>
  )
}

export default function DepositRedeem() {
  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Deposit / Redeem</div>
        <div className="note">Deposit USDC to receive yrCORE shares, or redeem yrCORE shares for USDC.</div>
      </div>

      {/* ── Closed Beta Risk Notice ── */}
      <div style={{
        marginBottom: 16,
        padding: '10px 14px',
        background: '#1a1200',
        border: '1px solid #5c3a00',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--yellow)',
        lineHeight: 1.6,
      }}>
        <strong>Closed Beta — Use small test amounts only.</strong>{' '}
        YearRing is an early-stage, invite-only protocol running on Base Mainnet with real USDC.
        It has not completed a third-party audit. Strategy yield is variable and not guaranteed.
        No principal protection. Only deposit amounts you are comfortable losing in a worst-case scenario.
      </div>

      <DepositSection />
      <RedeemSection />
    </div>
  )
}
