import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { DEMO_PERSONAS } from '../contracts/demoPersonas'
import { UserState_ABI, FundVault_ABI, Beneficiary_ABI, LockLedger_ABI, LockPointsRebateManager_ABI, PointsToken_ABI } from '../contracts/abis'
import { fmtShares, fmtAddr, fmtTs, fmtPoints, lockStateName } from '../utils'

const STATE_BADGE: Record<number, string> = {
  0: 'badge-gray',
  1: 'badge-blue',
  2: 'badge-yellow',
  3: 'badge-red',
}

function LockSummary({ lockId }: { lockId: bigint }) {
  const { data: pos } = useReadContract({
    address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI,
    functionName: 'getLock', args: [lockId],
  })
  const { data: rebate } = useReadContract({
    address: ADDRESSES.LockPointsRebateManagerV02, abi: LockPointsRebateManager_ABI,
    functionName: 'previewRebate', args: [lockId],
  })
  const p = pos as { owner: `0x${string}`; shares: bigint; unlockAt: bigint; unlocked: boolean; earlyExited: boolean } | undefined
  if (!p || p.unlocked) return null
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, paddingLeft: 4 }}>
      Lock #{lockId.toString()} · {fmtShares(p.shares)} · unlocks {fmtTs(p.unlockAt)}
      {' · '}rebate {fmtShares(rebate as bigint | undefined)}
      {' · '}owner <span className="mono" title={p.owner}>{fmtAddr(p.owner)}</span>
    </div>
  )
}

interface PersonaCardProps {
  name: string
  address: string
  scenario: string
}

function PersonaCard({ name, address, scenario }: PersonaCardProps) {
  const addr = address as `0x${string}`
  const enabled = !!address && address.startsWith('0x') && address.length === 42

  const { data: state } = useReadContract({
    address: ADDRESSES.UserStateEngineV02, abi: UserState_ABI,
    functionName: 'userStateOf', args: [addr], query: { enabled },
  })
  const { data: shares } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'balanceOf', args: [addr], query: { enabled },
  })
  const { data: rwt } = useReadContract({
    address: ADDRESSES.PointsToken, abi: PointsToken_ABI,
    functionName: 'balanceOf', args: [addr], query: { enabled },
  })
  const { data: ben } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
    functionName: 'beneficiaryOf', args: [addr], query: { enabled },
  })
  const { data: lockIds } = useReadContract({
    address: ADDRESSES.LockLedgerV02, abi: LockLedger_ABI,
    functionName: 'userLockIds', args: [addr], query: { enabled },
  })
  const { data: inactive } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
    functionName: 'isInactive', args: [addr], query: { enabled },
  })
  const { data: lastActive } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
    functionName: 'lastActiveAt', args: [addr], query: { enabled },
  })
  const { data: claimed } = useReadContract({
    address: ADDRESSES.BeneficiaryModuleV02, abi: Beneficiary_ABI,
    functionName: 'claimed', args: [addr], query: { enabled },
  })

  // Stable bigint → number conversion (avoids TS `as number` cast)
  const stateNum = state !== undefined ? Number(state) : undefined
  const ids      = (lockIds as bigint[] | undefined) ?? []
  const benAddr  = ben as string | undefined

  if (!enabled) {
    return (
      <div className="card" style={{ opacity: 0.4 }}>
        <div className="card-title">{name}</div>
        <div className="note">Address not configured.</div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{name}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <span className={`badge ${inactive ? 'badge-red' : 'badge-green'}`}>
            {inactive ? 'Inactive' : 'Active'}
          </span>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{address}</div>
      <div className="note" style={{ marginBottom: 8, fontStyle: 'italic' }}>{scenario}</div>

      <div className="info-row">
        <span className="info-label">User state</span>
        <span className={`badge ${STATE_BADGE[stateNum ?? 0] ?? 'badge-gray'}`}>
          {lockStateName(stateNum)}
        </span>
      </div>
      <div className="info-row"><span className="info-label">yrCORE balance</span>   <span>{fmtShares(shares as bigint | undefined)}</span></div>
      <div className="info-row"><span className="info-label">Points balance</span>      <span>{fmtPoints(rwt as bigint | undefined)}</span></div>
      <div className="info-row">
        <span className="info-label">Beneficiary</span>
        <span className="mono" style={{ fontSize: 11 }} title={benAddr}>{fmtAddr(benAddr)}</span>
      </div>
      <div className="info-row"><span className="info-label">Last heartbeat</span>  <span>{fmtTs(lastActive as bigint | undefined)}</span></div>
      <div className="info-row">
        <span className="info-label">Positions claimed</span>
        <span>{claimed === undefined ? '–' : claimed ? <span className="badge badge-yellow">Yes</span> : 'No'}</span>
      </div>

      {ids.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Locks ({ids.length}):</div>
          {ids.map(id => <LockSummary key={id.toString()} lockId={id} />)}
        </>
      )}
    </div>
  )
}

const PERSONA_META = [
  { key: 'alice', name: 'Alice', scenario: 'Scene B — Gold 180d lock, LockedAccumulating' },
  { key: 'bob',   name: 'Bob',   scenario: 'Scene A/C — yrCORE holder, Carol\'s beneficiary' },  // TODO: re-seed demo wallets for cleaner 3-scenario split
  { key: 'carol', name: 'Carol', scenario: 'Scene C — Silver 90d lock, admin-marked inactive' },
]

const allConfigured =
  !!DEMO_PERSONAS.alice && !!DEMO_PERSONAS.bob && !!DEMO_PERSONAS.carol

export default function DemoStateSection() {
  const [manualMode, setManualMode] = useState(!allConfigured)
  const [addrs, setAddrs] = useState<Record<string, string>>({
    alice: DEMO_PERSONAS.alice || '',
    bob:   DEMO_PERSONAS.bob   || '',
    carol: DEMO_PERSONAS.carol || '',
  })

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Seeded Demo State — Alice / Bob / Carol</span>
        <button
          className="btn-secondary btn-sm"
          onClick={() => setManualMode(m => !m)}
        >
          {manualMode ? 'Hide Inputs' : 'Edit Addresses'}
        </button>
      </div>

      <p className="note" style={{ marginBottom: 12 }}>
        Read-only inspection view — these are seeded demo wallets. You do not need to control them.
        {allConfigured && !manualMode
          ? ' Addresses auto-loaded from deployment config.'
          : ' Enter addresses from '}{' '}
        {(!allConfigured || manualMode) && (
          <><code>deployments/baseSepolia.json</code> → <code>seed.*</code></>
        )}
      </p>

      {manualMode && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          {PERSONA_META.map(p => (
            <div key={p.key} style={{ flex: 1, minWidth: 220 }}>
              <div className="field">
                <label>{p.name} address</label>
                <input
                  type="text"
                  placeholder="0x…"
                  value={addrs[p.key]}
                  onChange={e => setAddrs(prev => ({ ...prev, [p.key]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="demo-grid">
        {PERSONA_META.map(p => (
          <PersonaCard
            key={p.key}
            name={p.name}
            address={addrs[p.key]}
            scenario={p.scenario}
          />
        ))}
      </div>
    </div>
  )
}
