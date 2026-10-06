import { useAccount, useChainId, useReadContract } from 'wagmi'
import { ADDRESSES } from '../contracts/addresses'
import { ClaimLedger_ABI } from '../contracts/abis'
import { fmtUsdc, fmtAddr } from '../utils'
import { BASE_ID } from '../wagmiConfig'

// Asset type enum helper
function assetTypeLabel(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 'Unknown'
  // Compare lowercase
  if (addr.toLowerCase() === ADDRESSES.USDC.toLowerCase()) return 'USDC'
  if (addr.toLowerCase() === ADDRESSES.YearRingCoreVaultV01.toLowerCase()) return 'yrCORE shares'
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function ClaimCard({ claimId }: { claimId: bigint }) {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const { data: claim } = useReadContract({
    address: ADDRESSES.ClaimLedger, abi: ClaimLedger_ABI, functionName: 'claims',
    args: [claimId],
    query: { enabled },
  })

  if (!claim) {
    return (
      <div className="claim-card">
        <div className="note">Loading claim #{claimId.toString()}…</div>
      </div>
    )
  }

  const [roundId, assetType, nominalAmount, beneficiary, settled] = claim

  return (
    <div className="claim-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Claim #{claimId.toString()}</span>
        {settled
          ? <span className="badge badge-green">Settled</span>
          : <span className="badge badge-blue">Issued</span>
        }
      </div>
      <div className="info-row">
        <span className="info-label">Round ID</span>
        <span>{roundId.toString()}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Asset Type</span>
        <span>{assetTypeLabel(assetType)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Nominal Amount</span>
        <span style={{ fontWeight: 600 }}>{fmtUsdc(nominalAmount)}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Beneficiary</span>
        <span className="mono" style={{ fontSize: 12 }}>{fmtAddr(beneficiary)}</span>
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        Nominal amount is denominated in USDC (6 decimals). Claim settlement is managed by the protocol.
      </div>
    </div>
  )
}

export default function Claim() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const { data: claimIds } = useReadContract({
    address: ADDRESSES.ClaimLedger, abi: ClaimLedger_ABI, functionName: 'userClaimIds',
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!address },
  })

  if (!isConnected) {
    return (
      <div className="page-content">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div className="note">Connect wallet to view claims.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Claims</div>
        <div className="note">On-chain claim records associated with your address.</div>
      </div>

      <div className="signal-banner">
        Claims represent entitlements recorded on-chain.
        Settlement is managed by the protocol (VAULT_ROLE). This page is read-only.
        A claim does not represent immediately withdrawable cash — settlement depends on system state and protocol processes.
      </div>

      {(!claimIds || claimIds.length === 0) && (
        <div className="card" style={{ textAlign: 'center', padding: 40, marginTop: 16 }}>
          <div className="note">No active claims found for your address.</div>
        </div>
      )}

      {claimIds && claimIds.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {claimIds.map((id: bigint) => (
            <ClaimCard key={id.toString()} claimId={id} />
          ))}
        </div>
      )}
    </div>
  )
}
