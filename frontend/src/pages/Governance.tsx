import { useState } from 'react'
import { useAccount, useChainId, useReadContract, useWriteContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { Governance_ABI } from '../contracts/abis'
import { fmtTs, fmtPoints, shortErr } from '../utils'
import { BASE_ID } from '../wagmiConfig'

type VoteStep = 'idle' | 'busy' | 'done' | 'error'

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

const STATE_NAMES = ['Pending', 'Active', 'Passed', 'Rejected', 'Expired']
const STATE_BADGE_CLASS = ['badge-gray', 'badge-blue', 'badge-green', 'badge-red', 'badge-gray']

function ProposalCard({ proposalId, userAddr }: { proposalId: bigint; userAddr: `0x${string}` | undefined }) {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const [voteStep, setVoteStep] = useState<VoteStep>('idle')
  const [voteTx, setVoteTx] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const { data: proposal } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI, functionName: 'getProposal',
    args: [proposalId],
    query: { enabled },
  })
  const { data: stateVal } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI, functionName: 'stateOf',
    args: [proposalId],
    query: { enabled },
  })
  const { data: voted } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI, functionName: 'hasVoted',
    args: userAddr ? [proposalId, userAddr] : undefined,
    query: { enabled: enabled && !!userAddr },
  })
  const { data: votingPower } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI, functionName: 'votingPowerAt',
    args: userAddr && proposal ? [proposalId, userAddr] : undefined,
    query: { enabled: enabled && !!userAddr && !!proposal },
  })

  const { writeContractAsync } = useWriteContract()

  if (!proposal) return (
    <div className="proposal-card">
      <div className="note">Loading proposal #{proposalId.toString()}…</div>
    </div>
  )

  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes
  const forPct = totalVotes > 0n ? Number(proposal.forVotes * 1000n / totalVotes) / 10 : 0
  const againstPct = totalVotes > 0n ? Number(proposal.againstVotes * 1000n / totalVotes) / 10 : 0
  const stateNum = stateVal ?? 0
  const isActive = stateNum === 1
  const stateLabel = STATE_NAMES[stateNum] ?? String(stateNum)
  const stateBadge = STATE_BADGE_CLASS[stateNum] ?? 'badge-gray'

  async function castVote(voteType: number) {
    setErrMsg(''); setVoteStep('busy')
    try {
      const hash = await writeContractAsync({
        address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI,
        functionName: 'castVote', args: [proposalId, voteType],
      })
      setVoteTx(hash)
      setVoteStep('done')
    } catch (e) {
      setErrMsg(shortErr(e)); setVoteStep('error')
    }
  }

  return (
    <div className="proposal-card">
      <div className="proposal-card-header">
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            #{proposalId.toString()} — {proposal.title || '(no title)'}
          </div>
          <div className="note" style={{ margin: 0 }}>
            {proposal.description && proposal.description.length > 140
              ? proposal.description.slice(0, 140) + '…'
              : proposal.description}
          </div>
        </div>
        <span className={`badge ${stateBadge}`} style={{ whiteSpace: 'nowrap' }}>{stateLabel}</span>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        <span>Start: {fmtTs(proposal.startTime)}</span>
        <span>End: {fmtTs(proposal.endTime)}</span>
      </div>

      <div className="vote-bar-wrap">
        <div className="vote-bar">
          <div className="vote-bar-for" style={{ width: `${forPct}%` }} />
          <div className="vote-bar-against" style={{ width: `${againstPct}%` }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        <span style={{ color: 'var(--green)' }}>For: {fmtPoints(proposal.forVotes)}</span>
        <span style={{ color: 'var(--red)' }}>Against: {fmtPoints(proposal.againstVotes)}</span>
        <span style={{ color: 'var(--muted)' }}>Abstain: {fmtPoints(proposal.abstainVotes)}</span>
      </div>

      {userAddr && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          Your voting power (snapshot): {votingPower !== undefined ? fmtPoints(votingPower) : '–'}
          {voted && <span className="badge badge-gray" style={{ marginLeft: 8 }}>Voted</span>}
        </div>
      )}

      {isActive && !voted && userAddr && (
        <div className="vote-btns">
          <button
            className="btn-for btn-sm"
            style={{ borderRadius: 6, fontFamily: 'var(--font)', cursor: 'pointer', padding: '5px 14px', fontWeight: 500 }}
            onClick={() => castVote(0)}
            disabled={voteStep === 'busy' || voteStep === 'done'}
          >
            For
          </button>
          <button
            className="btn-against btn-sm"
            style={{ borderRadius: 6, fontFamily: 'var(--font)', cursor: 'pointer', padding: '5px 14px', fontWeight: 500 }}
            onClick={() => castVote(1)}
            disabled={voteStep === 'busy' || voteStep === 'done'}
          >
            Against
          </button>
          <button
            className="btn-abstain btn-sm"
            style={{ borderRadius: 6, fontFamily: 'var(--font)', cursor: 'pointer', padding: '5px 14px', fontWeight: 500 }}
            onClick={() => castVote(2)}
            disabled={voteStep === 'busy' || voteStep === 'done'}
          >
            Abstain
          </button>
          {voteStep === 'busy' && <span className="note" style={{ margin: 0, lineHeight: 2 }}>Submitting…</span>}
          {voteStep === 'done' && <span className="note" style={{ margin: 0, lineHeight: 2, color: 'var(--green)' }}>Vote recorded ✓</span>}
        </div>
      )}

      {errMsg && <div className="status err" style={{ marginTop: 6 }}>{errMsg}</div>}
      {voteTx && voteStep === 'done' && <TxResult hash={voteTx} label="Cast Vote" />}
    </div>
  )
}

export default function Governance() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const { data: nextProposalId } = useReadContract({
    address: ADDRESSES.GovernanceSignalV02, abi: Governance_ABI, functionName: 'nextProposalId',
    query: { enabled },
  })

  const count = nextProposalId !== undefined ? Number(nextProposalId) : 0
  const ids = Array.from({ length: count }, (_, i) => BigInt(i))

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Governance Signal</div>
        <div className="note">{count} proposal(s)</div>
      </div>

      <div className="signal-banner">
        Governance Signal Only — votes recorded here do not directly execute protocol changes.
        Results are advisory inputs to the protocol team. Timelock execution is not exposed to this UI.
      </div>

      {!isConnected && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">Connect wallet to view and vote on proposals.</div>
        </div>
      )}

      {isConnected && count === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">No proposals yet.</div>
        </div>
      )}

      {isConnected && count > 0 && (
        <div>
          {[...ids].reverse().map(id => (
            <ProposalCard key={id.toString()} proposalId={id} userAddr={address} />
          ))}
        </div>
      )}
    </div>
  )
}
