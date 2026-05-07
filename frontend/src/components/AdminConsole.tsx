import { useState, useEffect, useRef } from 'react'
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits } from 'viem'
import { ADDRESSES } from '../contracts/addresses'
import { FundVault_ABI, StrategyManager_ABI, USDC_ABI } from '../contracts/abis'
import { fmtUsdc, shortErr } from '../utils'
import { BASE_ID } from '../wagmiConfig'

// DEFAULT_ADMIN_ROLE in OpenZeppelin AccessControl = bytes32(0)
const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const
// EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE")
const EMERGENCY_ROLE = '0xbf233dd2aafeb4d50879c4aa5c81e96d92f6e6945c906a58f9f2d1c1631b4b26' as const

type OpType = 'pauseDeposits' | 'unpauseDeposits' | 'pauseRedeems' | 'unpauseRedeems' | 'accrue' | 'setMode' | null

const MODE_LABELS = ['Normal', 'Paused', 'EmergencyExit']
const MODE_BADGE_CLASSES = ['badge-green', 'badge-yellow', 'badge-red']

function AddrRow({ label, addr, note }: { label: string; addr: string; note?: string }) {
  const isUnconfigured = addr === 'Not configured'
  return (
    <div className="info-row" style={{ alignItems: 'flex-start' }}>
      <span className="info-label" style={{ minWidth: 160 }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', textAlign: 'right' }}>
        {isUnconfigured
          ? <span className="badge badge-gray">Not configured</span>
          : <>{addr.slice(0, 10)}…{addr.slice(-6)}</>}
        {note && <span className="note" style={{ display: 'block', fontSize: 10, margin: '2px 0 0', textAlign: 'right' }}>{note}</span>}
      </span>
    </div>
  )
}

export default function AdminConsole() {
  const { address } = useAccount()
  const chainId = useChainId()
  const vaultOk = !!address && chainId === BASE_ID

  // ── Role checks ────────────────────────────────────────────────────────────
  const { data: hasEmergencyRoleData } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'hasRole',
    args: address ? [EMERGENCY_ROLE, address] : undefined,
    query: { enabled: vaultOk },
  })
  const { data: hasAdminRoleData } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'hasRole',
    args: address ? [DEFAULT_ADMIN_ROLE, address] : undefined,
    query: { enabled: vaultOk },
  })

  const isGuardian = !!hasEmergencyRoleData
  const isAdmin    = !!hasAdminRoleData

  // ── Vault state ────────────────────────────────────────────────────────────
  const { data: depositsPaused, refetch: r1 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'depositsPaused', query: { enabled: vaultOk },
  })
  const { data: redeemsPaused, refetch: r2 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'redeemsPaused', query: { enabled: vaultOk },
  })
  const { data: available, refetch: r3 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'availableToInvest', query: { enabled: vaultOk },
  })
  const { data: vaultMode, refetch: r4 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'systemMode', query: { enabled: vaultOk },
  })
  const { data: currentRoundId, refetch: r5 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'currentRoundId', query: { enabled: vaultOk },
  })
  const { data: reserveRatioBps } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'reserveRatioBps', query: { enabled: vaultOk },
  })

  const currentMode = vaultMode !== undefined ? Number(vaultMode) : undefined
  const roundId = currentRoundId as bigint | undefined

  const roundEnabled = vaultOk && roundId !== undefined && roundId > 0n
  const { data: currentRound, refetch: r6 } = useReadContract({
    address: ADDRESSES.YearRingCoreVaultV01, abi: FundVault_ABI,
    functionName: 'exitRounds',
    args: roundId !== undefined ? [roundId] : undefined,
    query: { enabled: roundEnabled },
  })

  // ── Strategy Manager reads ─────────────────────────────────────────────────
  const { data: totalManagedAssets, refetch: r7 } = useReadContract({
    address: ADDRESSES.StrategyManagerV01, abi: StrategyManager_ABI,
    functionName: 'totalManagedAssets', query: { enabled: vaultOk },
  })
  const { data: idleUnderlying, refetch: r8 } = useReadContract({
    address: ADDRESSES.StrategyManagerV01, abi: StrategyManager_ABI,
    functionName: 'idleUnderlying', query: { enabled: vaultOk },
  })
  const { data: strategyAddrData } = useReadContract({
    address: ADDRESSES.StrategyManagerV01, abi: StrategyManager_ABI,
    functionName: 'strategy', query: { enabled: vaultOk },
  })
  const { data: investCapData } = useReadContract({
    address: ADDRESSES.StrategyManagerV01, abi: StrategyManager_ABI,
    functionName: 'investCap', query: { enabled: vaultOk },
  })

  // ── Treasury USDC balance ──────────────────────────────────────────────────
  const { data: treasuryUsdcBal, refetch: r9 } = useReadContract({
    address: ADDRESSES.USDC, abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [ADDRESSES.TreasuryV02],
    query: { enabled: vaultOk },
  })

  // ── Write ──────────────────────────────────────────────────────────────────
  const [opType, setOpType] = useState<OpType>(null)
  const { writeContract, isPending, data: hash, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const busy = isPending || isConfirming
  const prevHash = useRef<string | undefined>(undefined)

  function refetchAll() { r1(); r2(); r3(); r4(); r5(); r6(); r7(); r8(); r9() }

  useEffect(() => {
    if (isSuccess && hash && hash !== prevHash.current) {
      prevHash.current = hash
      refetchAll()
    }
  }, [isSuccess, hash])

  function exec(op: OpType, fn: string, args: unknown[] = []) {
    setOpType(op)
    writeContract({
      address: ADDRESSES.YearRingCoreVaultV01,
      abi: FundVault_ABI,
      functionName: fn as never,
      args: args as never,
    })
  }

  if (!address) {
    return (
      <div className="admin-console">
        <div className="note" style={{ padding: 20, textAlign: 'center' }}>Connect wallet to view admin console.</div>
      </div>
    )
  }

  // Derived display values
  const dp = depositsPaused as boolean | undefined
  const rp = redeemsPaused  as boolean | undefined
  const av = available      as bigint  | undefined
  const avFmt = av !== undefined ? parseFloat(formatUnits(av, 6)).toFixed(2) : '–'

  const modeLabelText  = currentMode !== undefined ? (MODE_LABELS[currentMode]       ?? '–')         : '–'
  const modeBadgeClass = currentMode !== undefined ? (MODE_BADGE_CLASSES[currentMode] ?? 'badge-gray') : 'badge-gray'

  const roundData   = currentRound as readonly [bigint, bigint, bigint, bigint, boolean, bigint] | undefined
  const roundIsOpen = roundData ? roundData[4] : false

  const reservePct    = reserveRatioBps !== undefined ? `${(Number(reserveRatioBps as bigint) / 100).toFixed(0)}%` : '–'
  const managedFmt    = fmtUsdc(totalManagedAssets as bigint | undefined)
  const idleFmt       = fmtUsdc(idleUnderlying     as bigint | undefined)
  const investCapFmt  = fmtUsdc(investCapData      as bigint | undefined)
  const stratAddr     = strategyAddrData as string | undefined
  const stratDisplay  = stratAddr && stratAddr !== '0x0000000000000000000000000000000000000000'
    ? stratAddr.slice(0, 10) + '…' + stratAddr.slice(-6)
    : '–'

  return (
    <div className="admin-console">
      <div className="admin-console-header">
        <span>Admin / Operator Console</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isAdmin    && <span className="badge badge-red">DEFAULT_ADMIN</span>}
          {isGuardian && <span className="badge badge-yellow">EMERGENCY_ROLE</span>}
          {!isAdmin && !isGuardian && <span className="badge badge-gray">Read-only</span>}
        </div>
      </div>

      <div className="admin-grid">

        {/* ── Protocol Infrastructure ── */}
        <div className="card">
          <div className="card-title">Protocol Infrastructure</div>
          <AddrRow label="Vault (YearRingCoreVaultV01)" addr={ADDRESSES.YearRingCoreVaultV01} />
          <AddrRow label="StrategyManagerV01"           addr={ADDRESSES.StrategyManagerV01} />
          <AddrRow label="AaveV3StrategyV01"            addr={ADDRESSES.AaveV3StrategyV01} />
          <AddrRow label="TreasuryV02"                  addr={ADDRESSES.TreasuryV02}
            note="Handles protocol fees & rebate reserves — does not control user principal" />
          <AddrRow label="ProtocolTimelockV02"          addr={ADDRESSES.ProtocolTimelockV02}
            note="Holds DEFAULT_ADMIN_ROLE — 24h timelock delay" />
          <AddrRow label="Guardian"                     addr={ADDRESSES.Guardian}
            note="Holds EMERGENCY_ROLE — can pause deposits/redeems immediately" />
          <AddrRow label="Safe / Multisig"              addr="Not configured"
            note="No multisig deployed for closed beta" />
        </div>

        {/* ── Role / Admin Status ── */}
        <div className="card">
          <div className="card-title">Role & Admin Status</div>
          <div className="info-row">
            <span className="info-label">DEFAULT_ADMIN_ROLE</span>
            <span style={{ fontSize: 12 }}>
              ProtocolTimelockV02
              <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Based on migration record</span>
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Deployer admin</span>
            <span className="badge badge-gray">Removed</span>
          </div>
          <div className="info-row">
            <span className="info-label">EMERGENCY_ROLE</span>
            <span style={{ fontSize: 12 }}>
              Guardian
              <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>Based on migration record</span>
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Safe / Multisig</span>
            <span className="badge badge-gray">Not configured</span>
          </div>
          <div className="info-row">
            <span className="info-label">Your wallet role</span>
            <span>
              {isAdmin    ? <span className="badge badge-red">DEFAULT_ADMIN</span>
               : isGuardian ? <span className="badge badge-yellow">EMERGENCY_ROLE (Guardian)</span>
               : <span className="badge badge-gray">No role — read-only</span>}
            </span>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Non-emergency protocol operations must be scheduled and executed via ProtocolTimelockV02 with a 24-hour delay.
            No EOA holds DEFAULT_ADMIN_ROLE directly in this closed beta deployment.
          </p>
        </div>

        {/* ── Strategy Status ── */}
        <div className="card">
          <div className="card-title">Strategy Status</div>
          <div className="info-row">
            <span className="info-label">Active Strategy</span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>{stratDisplay}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Total Managed</span>
            <span className="info-value">{managedFmt}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Idle Underlying</span>
            <span className="info-value">{idleFmt}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Available to Invest (Vault)</span>
            <span className="info-value">{avFmt !== '–' ? avFmt + ' USDC' : '–'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Invest Cap</span>
            <span className="info-value">{investCapFmt}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Reserve Ratio</span>
            <span className="info-value">{reservePct}</span>
          </div>
          <p className="note" style={{ marginTop: 6, color: 'var(--yellow)' }}>
            invest / divest / returnToVault require Timelock execution. Use admin scripts or governance process.
          </p>
        </div>

        {/* ── Treasury Status ── */}
        <div className="card">
          <div className="card-title">Treasury Status</div>
          <AddrRow label="Treasury address" addr={ADDRESSES.TreasuryV02} />
          <div className="info-row">
            <span className="info-label">Treasury USDC Balance</span>
            <span className="info-value">{fmtUsdc(treasuryUsdcBal as bigint | undefined)}</span>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Treasury handles protocol fees, rebate reserves, and protocol income.
            It does not control user principal. User funds are held in the vault contract (YearRingCoreVaultV01)
            and managed by the strategy layer. Treasury is a separate accounting contract for fee and rebate flows.
          </p>
        </div>

        {/* ── Emergency Pause ── */}
        <div className="card">
          <div className="card-title">Emergency Pause</div>

          <div className="info-row">
            <span className="info-label">Deposits</span>
            <span className={`badge ${dp ? 'badge-red' : 'badge-green'}`}>
              {dp === undefined ? '–' : dp ? 'PAUSED' : 'Active'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Redeems</span>
            <span className={`badge ${rp ? 'badge-red' : 'badge-green'}`}>
              {rp === undefined ? '–' : rp ? 'PAUSED' : 'Active'}
            </span>
          </div>

          <div className="btn-row" style={{ marginTop: 10 }}>
            {!dp
              ? <button className="btn-danger btn-sm"
                  disabled={busy || !isGuardian}
                  title={!isGuardian ? 'Requires EMERGENCY_ROLE (Guardian)' : ''}
                  onClick={() => exec('pauseDeposits', 'pauseDeposits')}>
                  {busy && opType === 'pauseDeposits' ? 'Pausing…' : 'Pause Deposits'}
                </button>
              : <button className="btn-green btn-sm" disabled
                  title="Unpause requires Timelock execution">
                  Unpause Deposits
                </button>
            }
            {!rp
              ? <button className="btn-danger btn-sm"
                  disabled={busy || !isGuardian}
                  title={!isGuardian ? 'Requires EMERGENCY_ROLE (Guardian)' : ''}
                  onClick={() => exec('pauseRedeems', 'pauseRedeems')}>
                  {busy && opType === 'pauseRedeems' ? 'Pausing…' : 'Pause Redeems'}
                </button>
              : <button className="btn-green btn-sm" disabled
                  title="Unpause requires Timelock execution">
                  Unpause Redeems
                </button>
            }
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Pause Deposits/Redeems: callable by <strong>EMERGENCY_ROLE</strong> (Guardian) immediately.
            Unpause: requires <strong>Timelock execution</strong> (24h delay).
          </p>
        </div>

        {/* ── System Mode ── */}
        <div className="card">
          <div className="card-title">System Mode</div>
          <div className="info-row">
            <span className="info-label">Current Mode</span>
            <span className={`badge ${modeBadgeClass}`}>{modeLabelText}</span>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn-green btn-sm" disabled
              title="Requires Timelock execution — use admin scripts or governance process">
              Normal (Timelock)
            </button>
            <button className="btn-secondary btn-sm"
              disabled={busy || !isGuardian || currentMode === 1}
              title={!isGuardian ? 'Requires EMERGENCY_ROLE (Guardian)' : currentMode === 1 ? 'Already paused' : ''}
              onClick={() => exec('setMode', 'setMode', [1])}>
              {busy && opType === 'setMode' ? 'Pending…' : 'Set Paused'}
            </button>
            <button className="btn-danger btn-sm" disabled
              title="Requires Timelock execution — use admin scripts or governance process">
              EmergencyExit (Timelock)
            </button>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Mode 0 (Normal) and mode 2 (EmergencyExit) require <strong>Timelock execution</strong>.
            Mode 1 (Paused) can be set by <strong>EMERGENCY_ROLE</strong> (Guardian).
          </p>
        </div>

        {/* ── Exit Round Status (shown in EmergencyExit mode) ── */}
        {currentMode === 2 && (
          <div className="card">
            <div className="card-title">Exit Round Status</div>
            <div className="info-row">
              <span className="info-label">Current Round ID</span>
              <span className="info-value">{roundId !== undefined ? roundId.toString() : '–'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Round Status</span>
              <span className={`badge ${roundIsOpen ? 'badge-green' : 'badge-gray'}`}>
                {roundId === undefined || roundId === 0n ? 'No round' : roundIsOpen ? 'Open' : 'Closed'}
              </span>
            </div>
            {roundData && (
              <div className="info-row">
                <span className="info-label">Available Assets</span>
                <span className="info-value">{fmtUsdc(roundData[2])}</span>
              </div>
            )}
            {roundData && (
              <div className="info-row">
                <span className="info-label">Total Claimed</span>
                <span className="info-value">{fmtUsdc(roundData[3])}</span>
              </div>
            )}
            <p className="note" style={{ marginTop: 6, color: 'var(--yellow)' }}>
              openExitModeRound / closeExitModeRound require Timelock execution.
              Use admin scripts or governance process.
            </p>
          </div>
        )}

        {/* ── Fund Operations ── */}
        <div className="card">
          <div className="card-title">Fund Operations</div>

          <div className="info-row">
            <span className="info-label">Available to invest</span>
            <span className="info-value">{avFmt !== '–' ? avFmt + ' USDC' : '–'}</span>
          </div>

          <div className="field">
            <label>Transfer to Strategy Manager (USDC)</label>
            <input
              type="number"
              placeholder={`max ${avFmt} USDC — Timelock only`}
              disabled
            />
          </div>
          <div className="btn-row">
            <button className="btn-primary btn-sm" disabled
              title="Requires Timelock execution — use admin scripts or governance process">
              Transfer (Timelock)
            </button>
          </div>
          <p className="note" style={{ marginTop: 6, color: 'var(--yellow)' }}>
            transferToStrategyManager requires DEFAULT_ADMIN_ROLE via Timelock execution. Use admin scripts or governance process.
          </p>

          <hr className="divider" />

          <div className="info-row">
            <span className="info-label">Management Fee</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              Manually trigger settlement (auto-settled on deposit/redeem)
            </span>
          </div>
          <div className="btn-row">
            <button
              className="btn-secondary btn-sm"
              disabled={busy}
              onClick={() => exec('accrue', 'accrueManagementFee')}
            >
              {busy && opType === 'accrue' ? 'Pending…' : 'Accrue Fee'}
            </button>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            accrueManagementFee is <strong>permissionless</strong> — anyone can call it to trigger fee settlement.
          </p>
        </div>

      </div>

      <button className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={refetchAll}>
        ↻ Refresh
      </button>

      {busy      && opType && <div className="status info" style={{ marginTop: 8 }}>Executing {opType}…</div>}
      {isSuccess            && <div className="status ok"  style={{ marginTop: 8 }}>Done. {hash ? `tx: ${hash}` : ''}</div>}
      {error                && <div className="status err" style={{ marginTop: 8 }}>{shortErr(error)}</div>}
    </div>
  )
}
