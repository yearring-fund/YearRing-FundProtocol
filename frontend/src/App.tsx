import { useState } from 'react'
import yrfpLogo from './assets/YRFP.svg'
import { Routes, Route, NavLink } from 'react-router-dom'
import { useAccount, useChainId, useSwitchChain, useReadContract } from 'wagmi'
import { BASE_ID } from './wagmiConfig'
import { ADDRESSES } from './contracts/addresses'
import { FundVault_ABI } from './contracts/abis'
import WalletSection from './components/WalletSection'
import Dashboard from './pages/Dashboard'
import DepositRedeem from './pages/DepositRedeem'
import Lock from './pages/Lock'
import Positions from './pages/Positions'
import Beneficiary from './pages/Beneficiary'
import Governance from './pages/Governance'
import Claim from './pages/Claim'
import Community from './pages/Community'

function NetworkGuard({ children }: { children: React.ReactNode }) {
  const chainId = useChainId()
  const { isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  if (isConnected && chainId !== BASE_ID) {
    return (
      <div className="net-alert">
        Wrong network — please switch to <strong>Base Mainnet</strong> (chain ID {BASE_ID}).
        <button
          className="btn-primary btn-sm"
          disabled={isPending}
          onClick={() => switchChain({ chainId: BASE_ID })}
        >
          {isPending ? 'Switching…' : 'Switch to Base'}
        </button>
      </div>
    )
  }
  return <>{children}</>
}

function GlobalStatusBar() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const enabled = isConnected && chainId === BASE_ID

  const { data: depositsPaused } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'depositsPaused',
    query: { enabled },
  })
  const { data: redeemsPaused } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'redeemsPaused',
    query: { enabled },
  })
  const { data: systemMode } = useReadContract({
    address: ADDRESSES.FundVaultV01,
    abi: FundVault_ABI,
    functionName: 'systemMode',
    query: { enabled },
  })

  const isEmergency = systemMode === 2

  if (!depositsPaused && !redeemsPaused && !isEmergency) return null

  return (
    <div style={{ display: 'flex', gap: 8, padding: '6px 24px', background: '#1a0f00', borderBottom: '1px solid #5c2a00', flexWrap: 'wrap' }}>
      {isEmergency && (
        <span className="badge badge-red" style={{ fontSize: 12 }}>
          EMERGENCY EXIT MODE — Normal operations suspended
        </span>
      )}
      {depositsPaused && !isEmergency && (
        <span className="badge badge-yellow" style={{ fontSize: 12 }}>
          Deposits Paused
        </span>
      )}
      {redeemsPaused && !isEmergency && (
        <span className="badge badge-yellow" style={{ fontSize: 12 }}>
          Redeems Paused
        </span>
      )}
    </div>
  )
}

function FirstTimeModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--blue)' }}>
          YearRing Fund — Invited User Access
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--muted)', marginBottom: 14 }}>
          By continuing, you confirm that you understand:
        </p>
        <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, marginBottom: 16, color: 'var(--text)' }}>
          <li>This is an <strong>invite-only</strong> entry point, not a public product.</li>
          <li>No yield is promised or guaranteed. No principal protection.</li>
          <li>The system may enter <strong>Paused</strong> or <strong>Emergency Exit</strong> modes.</li>
          <li>Locks, Beneficiary, Governance signals, and Claims each have their own boundaries.</li>
          <li>This is an early-stage, controlled-access protocol.</li>
        </ul>
        <button className="btn-primary" style={{ width: '100%' }} onClick={onConfirm}>
          I understand — Continue
        </button>
      </div>
    </div>
  )
}

const NAV_ITEMS = [
  { path: '/',            label: 'Dashboard'   },
  { path: '/deposit',     label: 'Deposit'     },
  { path: '/lock',        label: 'Lock'        },
  { path: '/positions',   label: 'Positions'   },
  { path: '/beneficiary', label: 'Beneficiary' },
  { path: '/governance',  label: 'Governance'  },
  { path: '/claim',       label: 'Claim'       },
  { path: '/community',   label: 'Community'   },
]

export default function App() {
  const [confirmed, setConfirmed] = useState(() => {
    return localStorage.getItem('yr_step4_confirmed') === '1'
  })

  function handleConfirm() {
    localStorage.setItem('yr_step4_confirmed', '1')
    setConfirmed(true)
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Sticky header */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={yrfpLogo} alt="YearRing Fund Protocol" style={{ height: 36, width: 36, display: 'block' }} />
          <nav className="nav-tabs">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => 'nav-tab' + (isActive ? ' active' : '')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <WalletSection />
      </header>

      {/* Step 4 banner */}
      <div className="step4-banner">
        <span style={{ fontWeight: 700 }}>STEP 4 · INVITED USER ACCESS</span>
        <span>Invite-only</span>
        <span>·</span>
        <span>Not a public product</span>
        <span>·</span>
        <span>Early-stage controlled access</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Base Mainnet · Chain ID 8453</span>
      </div>

      {/* Network guard + global status */}
      <NetworkGuard>
        <GlobalStatusBar />
        <main>
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/deposit"     element={<DepositRedeem />} />
            <Route path="/lock"        element={<Lock />} />
            <Route path="/positions"   element={<Positions />} />
            <Route path="/beneficiary" element={<Beneficiary />} />
            <Route path="/governance"  element={<Governance />} />
            <Route path="/claim"       element={<Claim />} />
            <Route path="/community"   element={<Community />} />
          </Routes>
        </main>
      </NetworkGuard>

      {/* First-time confirmation modal */}
      {!confirmed && <FirstTimeModal onConfirm={handleConfirm} />}
    </div>
  )
}
