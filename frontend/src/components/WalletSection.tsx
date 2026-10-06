import { useAccount, useConnect, useDisconnect, useChainId } from 'wagmi'
import { BASE_ID } from '../wagmiConfig'
import { fmtAddr } from '../utils'

export default function WalletSection() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  const onNetwork = isConnected && chainId === BASE_ID

  if (!isConnected) {
    return (
      <button
        className="btn-primary"
        disabled={isPending}
        onClick={() => connect({ connector: connectors[0] })}
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {onNetwork && (
        <span className="badge badge-green">Base Mainnet</span>
      )}
      <span className="mono" title={address}>{fmtAddr(address)}</span>
      <button className="btn-secondary btn-sm" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  )
}
