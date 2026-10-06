import { useState, useRef, useEffect } from 'react'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { Governance_ABI, PointsToken_ABI } from '../contracts/abis'
import { fmtPoints, fmtTs, shortErr } from '../utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROPOSAL_TYPE_LABELS = ['Reward Rate Signal', 'Rebate Signal', 'Inactivity Threshold Signal', 'General Signal']
const PROPOSAL_STATE_LABELS = ['Active', 'Succeeded', 'Defeated']
const PROPOSAL_STATE_BADGES = ['badge-blue', 'badge-green', 'badge-red']
const VOTE_TYPE = { For: 0, Against: 1, Abstain: 2 } as const

// ─── ProposalCard ─────────────────────────────────────────────────────────────

type RawProposal = {
  proposer: string; title: string; description: string
  proposalType: number; startTime: bigint; endTime: bigint
  forVotes: bigint; againstVotes: bigint; abstainVotes: bigint; snapshotId: bigint
}

function ProposalCard({ proposalId, address }: { proposalId: bigint; address: `0x${string}` | undefined }) {
  const gov     = ADDRESSES.GovernanceSignalV02
  const enabled = !!gov && !!address

  const { data: raw,      refetch: rp } = useReadContract({ address: gov, abi: Governance_ABI, functionName: 'getProposal',    args: [proposalId], query: { enabled: !!gov } })
  const { data: state,    refetch: rs } = useReadContract({ address: gov, abi: Governance_ABI, functionName: 'stateOf',         args: [proposalId], query: { enabled: !!gov } })
  const { data: voted,    refetch: rv } = useReadContract({ address: gov, abi: Governance_ABI, functionName: 'hasVoted',        args: address ? [proposalId, address] : undefined, query: { enabled } })
  const { data: snapPow,  refetch: rw } = useReadContract({ address: gov, abi: Governance_ABI, functionName: 'votingPowerAt',   args: address ? [proposalId, address] : undefined, query: { enabled } })

  const { writeContract, isPending, data: hash, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const busy    = isPending || isConfirming
  const prevRef = useRef<string | undefined>()

  useEffect(() => {
    if (isSuccess && hash && hash !== prevRef.current) {
      prevRef.current = hash
      rp(); rs(); rv(); rw()
    }
  }, [isSuccess, hash])

  if (!raw) return <div className="proposal-card"><p className="note">Loading…</p></div>

  const p          = raw as RawProposal
  const stateNum   = state as number | undefined
  const hasVoted   = voted as boolean | undefined
  const power      = snapPow as bigint | undefined
  const isActive   = stateNum === 0
  const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes
  const forPct     = totalVotes > 0n ? Number((p.forVotes * 100n) / totalVotes) : 0
  const againstPct = totalVotes > 0n ? Number((p.againstVotes * 100n) / totalVotes) : 0

  function vote(voteType: number) {
    writeContract({ address: gov, abi: Governance_ABI, functionName: 'castVote', args: [proposalId, voteType] })
  }

  return (
    <div className="proposal-card">
      <div className="proposal-card-header">
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>#{proposalId.toString()} — {p.title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {PROPOSAL_TYPE_LABELS[p.proposalType] ?? 'Unknown'} · Ends {fmtTs(p.endTime)}
          </div>
        </div>
        {stateNum !== undefined && (
          <span className={`badge ${PROPOSAL_STATE_BADGES[stateNum] ?? 'badge-gray'}`}>
            {PROPOSAL_STATE_LABELS[stateNum] ?? '–'}
          </span>
        )}
      </div>

      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0' }}>{p.description}</p>

      {/* Vote bar */}
      <div className="vote-bar-wrap">
        <div className="vote-bar">
          <div className="vote-bar-for"     style={{ width: forPct + '%' }} />
          <div className="vote-bar-against" style={{ width: againstPct + '%' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
          <span style={{ color: 'var(--green)' }}>For {fmtPoints(p.forVotes)} ({forPct}%)</span>
          <span>Abstain {fmtPoints(p.abstainVotes)}</span>
          <span style={{ color: 'var(--red)' }}>Against {fmtPoints(p.againstVotes)} ({againstPct}%)</span>
        </div>
      </div>

      {/* Snapshot voting power */}
      {address && (
        <div className="info-row" style={{ marginTop: 6 }}>
          <span className="info-label">Your voting power for this proposal (snapshot)</span>
          <span>{fmtPoints(power)}</span>
        </div>
      )}

      {/* Vote buttons */}
      {isActive && address && !hasVoted && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn-green btn-sm"     disabled={busy} onClick={() => vote(VOTE_TYPE.For)}>For</button>
          <button className="btn-danger btn-sm"    disabled={busy} onClick={() => vote(VOTE_TYPE.Against)}>Against</button>
          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => vote(VOTE_TYPE.Abstain)}>Abstain</button>
        </div>
      )}
      {isActive && hasVoted && (
        <div className="status ok" style={{ marginTop: 6, fontSize: 12 }}>✓ Voted</div>
      )}
      {!isActive && (
        <div className="note" style={{ marginTop: 6 }}>Voting has ended.</div>
      )}

      {busy     && <div className="status info" style={{ fontSize: 11, marginTop: 4 }}>Pending…</div>}
      {error    && <div className="status err"  style={{ fontSize: 11, marginTop: 4 }}>{shortErr(error)}</div>}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DaoBridgeSection() {
  const { address } = useAccount()
  const gov         = ADDRESSES.GovernanceSignalV02
  const govDeployed = !!gov

  // Real-time Points balance (global voting power)
  const { data: rwtBal, refetch: refetchBal } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!ADDRESSES.PointsToken },
  })

  // Proposal count
  const { data: nextId, refetch: refetchIds } = useReadContract({
    address: gov, abi: Governance_ABI, functionName: 'nextProposalId',
    query: { enabled: govDeployed },
  })
  const { data: threshold } = useReadContract({
    address: gov, abi: Governance_ABI, functionName: 'votingThreshold',
    query: { enabled: govDeployed },
  })

  const count      = nextId ? Number(nextId as bigint) : 0
  const proposalIds = Array.from({ length: count }, (_, i) => BigInt(i))
  const thresholdVal = threshold as bigint | undefined

  const [tab, setTab] = useState<'active' | 'all'>('active')

  // Batch-read states to filter by Active
  const { data: stateResults } = useReadContracts({
    contracts: proposalIds.map(id => ({
      address: gov, abi: Governance_ABI, functionName: 'stateOf' as const, args: [id] as const,
    })),
    query: { enabled: govDeployed && count > 0 },
  })

  const visibleIds = proposalIds.filter((id, i) => {
    if (tab === 'all') return true
    const s = stateResults?.[i]?.result as number | undefined
    return s === 0  // Active only
  })

  return (
    <div className="dao-bridge">
      <div className="dao-bridge-header">
        <div>
          <span className="dao-bridge-title">DAO Bridge</span>
          <span className="badge badge-gray" style={{ marginLeft: 8 }}>V2 Signal-only</span>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => { refetchBal(); refetchIds() }}>↻ Refresh</button>
      </div>

      {/* ── Current Points Balance ── */}
      <div className="dao-bridge-power">
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>Current Points Balance</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtPoints(rwtBal as bigint | undefined)}</div>
          {thresholdVal !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Minimum proposal threshold: {fmtPoints(thresholdVal)}
              {rwtBal !== undefined && (rwtBal as bigint) >= thresholdVal
                ? <span style={{ color: 'var(--green)', marginLeft: 6 }}>✓ Eligible</span>
                : <span style={{ color: 'var(--red)',   marginLeft: 6 }}>✗ Insufficient balance</span>
              }
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.6 }}>
          This shows your real-time Points balance, used to determine proposal eligibility.<br />
          Actual voting power is snapshot-locked at each proposal's creation time — see the Snapshot Voting Power field in each proposal card.
        </div>
      </div>

      {/* ── Not deployed placeholder ── */}
      {!govDeployed && (
        <div className="dao-bridge-placeholder">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Governance Contract Not Yet Deployed</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
            GovernanceSignalV02 has not been deployed to the current network.<br />
            Once deployed, this page will automatically enable the proposal list and voting functionality.
          </p>
          <p className="note" style={{ marginTop: 12 }}>
            Deploy command: <code>DEPLOY_OPTIONAL_MODULES=true npx hardhat run scripts/v2/deploy_v2.ts --network baseSepolia</code>
            <br />
            After deployment, update the <code>GovernanceSignalV02</code> address in <code>frontend/src/contracts/addresses.ts</code>.
          </p>
        </div>
      )}

      {/* ── Proposals ── */}
      {govDeployed && (
        <>
          <div className="dao-bridge-tabs">
            <button className={tab === 'active' ? 'tab-active' : 'tab'} onClick={() => setTab('active')}>Active</button>
            <button className={tab === 'all'    ? 'tab-active' : 'tab'} onClick={() => setTab('all')}>All</button>
          </div>

          {count === 0 ? (
            <div className="dao-bridge-placeholder">
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No proposals yet. Proposals are created by the admin.</p>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
                There are no active proposals, so only your real-time Points balance is shown here — it does not represent snapshot voting power for any proposal.
              </p>
            </div>
          ) : visibleIds.length === 0 ? (
            <div className="dao-bridge-placeholder">
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No active proposals at this time.</p>
            </div>
          ) : (
            <div className="proposal-list">
              {visibleIds.map(id => (
                <ProposalCard key={id.toString()} proposalId={id} address={address} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── V3 notice ── */}
      <div className="dao-bridge-v3-note">
        <strong>V2 Governance Scope:</strong>
        Vote results are recorded as signals only and do not trigger any protocol parameter changes. Proposal rights, execution paths, and full proposal lifecycle management will be introduced in V3.
      </div>
    </div>
  )
}
