import { useState } from 'react'
import { useAccount, useChainId, useReadContract, useWriteContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { Beneficiary_ABI } from '../contracts/abis'
import { fmtTs, fmtAddr, isZeroAddr, shortErr } from '../utils'
import { BASE_ID } from '../wagmiConfig'
import { isAddress } from 'viem'

type BenStep = 'idle' | 'busy' | 'done' | 'error'

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

export default function Beneficiary() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [benInput, setBenInput] = useState('')
  const [setStep, setSetStep] = useState<BenStep>('idle')
  const [setTx, setSetTx] = useState('')
  const [revokeStep, setRevokeStep] = useState<BenStep>('idle')
  const [revokeTx, setRevokeTx] = useState('')
  const [heartStep, setHeartStep] = useState<BenStep>('idle')
  const [heartTx, setHeartTx] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [pendingBenAddr, setPendingBenAddr] = useState('')

  const { data: currentBen, refetch: refetchBen } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'beneficiaryOf',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: isInactive } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'isInactive',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })
  const { data: lastActiveAt } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI, functionName: 'lastActiveAt',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  const { writeContractAsync } = useWriteContract()

  const hasBeneficiary = currentBen && !isZeroAddr(currentBen)

  function handleSetClick() {
    setErrMsg('')
    if (!benInput || !isAddress(benInput)) {
      setErrMsg('Enter a valid Ethereum address')
      return
    }
    if (!hasBeneficiary) {
      setPendingBenAddr(benInput)
      setShowDisclaimer(true)
    } else {
      doUpdate(benInput)
    }
  }

  async function doSet(addr: string) {
    setShowDisclaimer(false)
    setSetStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
        functionName: 'setBeneficiary', args: [addr as `0x${string}`],
      })
      setSetTx(hash)
      setSetStep('done')
      await refetchBen()
    } catch (e) {
      setErrMsg(shortErr(e)); setSetStep('error')
    }
  }

  async function doUpdate(addr: string) {
    setSetStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
        functionName: 'updateBeneficiary', args: [addr as `0x${string}`],
      })
      setSetTx(hash)
      setSetStep('done')
      await refetchBen()
    } catch (e) {
      setErrMsg(shortErr(e)); setSetStep('error')
    }
  }

  async function handleRevoke() {
    setErrMsg(''); setRevokeStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
        functionName: 'revokeBeneficiary', args: [],
      })
      setRevokeTx(hash)
      setRevokeStep('done')
      await refetchBen()
    } catch (e) {
      setErrMsg(shortErr(e)); setRevokeStep('error')
    }
  }

  async function handleHeartbeat() {
    setErrMsg(''); setHeartStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
        functionName: 'heartbeat', args: [],
      })
      setHeartTx(hash)
      setHeartStep('done')
    } catch (e) {
      setErrMsg(shortErr(e)); setHeartStep('error')
    }
  }

  if (!isConnected) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">Connect wallet to manage beneficiary settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      {/* Disclaimer modal */}
      {showDisclaimer && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--blue)' }}>
              Beneficiary — Important Notice
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', marginBottom: 14 }}>
              This module handles on-chain inheritance logic only — it is <strong>not a legal trust</strong> and does not represent any offline legal arrangement.
            </p>
            <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, marginBottom: 16, color: 'var(--muted)' }}>
              <li>Setting a beneficiary records an address on-chain.</li>
              <li>If your account is deemed inactive (no heartbeat for a defined period), the beneficiary may claim your locked positions.</li>
              <li>This does not constitute a will or legal inheritance document.</li>
              <li>Consult legal counsel for formal estate planning.</li>
            </ul>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => doSet(pendingBenAddr)}>
                I understand — Set Beneficiary
              </button>
              <button className="btn-secondary" onClick={() => setShowDisclaimer(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Beneficiary</div>
        <div className="note">Manage your on-chain inheritance designation.</div>
      </div>

      {/* Current status */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Current Status</div>
        <div className="info-row">
          <span className="info-label">Current Beneficiary</span>
          <span className="info-value mono">
            {hasBeneficiary ? fmtAddr(currentBen) : <span className="badge badge-gray">Not Set</span>}
          </span>
        </div>
        {hasBeneficiary && (
          <div className="info-row">
            <span className="info-label">Full Address</span>
            <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{currentBen}</span>
          </div>
        )}
        <div className="info-row">
          <span className="info-label">Activity Status</span>
          <span className="info-value">
            {isInactive
              ? <span className="badge badge-red">Inactive</span>
              : <span className="badge badge-green">Active</span>}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Last Heartbeat</span>
          <span className="info-value">{fmtTs(lastActiveAt)}</span>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          If no heartbeat is recorded for the required inactivity period, your beneficiary may
          be eligible to claim your locked positions. Submit a heartbeat periodically to confirm activity.
        </div>
      </div>

      {/* Set / Update beneficiary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{hasBeneficiary ? 'Update Beneficiary' : 'Set Beneficiary'}</div>
        <div className="field">
          <label>Beneficiary Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={benInput}
            onChange={e => { setBenInput(e.target.value); setErrMsg('') }}
            disabled={setStep === 'busy'}
          />
        </div>
        <div className="btn-row">
          <button
            className="btn-primary"
            onClick={handleSetClick}
            disabled={setStep === 'busy'}
          >
            {setStep === 'busy' ? 'Submitting…' : setStep === 'done' ? 'Done ✓' : hasBeneficiary ? 'Update Beneficiary' : 'Set Beneficiary'}
          </button>
          {hasBeneficiary && (
            <button
              className="btn-danger"
              onClick={handleRevoke}
              disabled={revokeStep === 'busy' || revokeStep === 'done'}
            >
              {revokeStep === 'busy' ? 'Revoking…' : revokeStep === 'done' ? 'Revoked ✓' : 'Revoke'}
            </button>
          )}
        </div>
        {errMsg && <div className="status err">{errMsg}</div>}
        {setTx && setStep === 'done' && <TxResult hash={setTx} label={hasBeneficiary ? 'Update Beneficiary' : 'Set Beneficiary'} />}
        {revokeTx && revokeStep === 'done' && <TxResult hash={revokeTx} label="Revoke Beneficiary" />}
      </div>

      {/* Heartbeat */}
      <div className="card">
        <div className="card-title">Heartbeat</div>
        <div className="note" style={{ marginBottom: 12 }}>
          Submit a heartbeat to confirm your account is still active and reset the inactivity timer.
          Do this periodically (e.g., once per month) to prevent your beneficiary from claiming your positions prematurely.
        </div>
        <button
          className="btn-secondary"
          onClick={handleHeartbeat}
          disabled={heartStep === 'busy'}
        >
          {heartStep === 'busy' ? 'Submitting…' : heartStep === 'done' ? 'Heartbeat Sent ✓' : 'Send Heartbeat'}
        </button>
        {heartTx && heartStep === 'done' && <TxResult hash={heartTx} label="Heartbeat" />}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        This module handles on-chain inheritance logic only — not a legal trust.
        It does not represent any offline legal arrangement or promise.
        executeClaim is managed by the protocol; this page covers user-side setup only.
      </div>
    </div>
  )
}
