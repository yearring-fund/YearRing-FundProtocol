export default function LimitationsPanel() {
  return (
    <>
      {/* ── Protocol Risk & Compliance Disclosure ── */}
      <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--danger, #c00)' }}>
        <div className="card-title">Protocol Risk & Compliance Disclosure</div>
        <ul className="limitations-list">
          <li>
            <strong>This protocol is not capital-guaranteed.</strong> Depositing USDC into the vault
            does not guarantee return of principal. Strategy losses, smart contract bugs, or adverse
            market conditions can reduce the value of your shares (yrCORE).
          </li>
          <li>
            <strong>This protocol does not offer fixed or guaranteed returns.</strong>{' '}
            <code>pricePerShare</code> reflects actual strategy performance and can decrease as well
            as increase. No yield rate is promised or implied.
          </li>
          <li>
            <strong>Points are not part of NAV and do not constitute fund yield.</strong>{' '}
            Points are issued as a commitment incentive for closed beta participants. They are not
            the protocol's native token. Once the native token launches, early testing rewards will
            be distributed based on users' Points holdings at that time.
          </li>
          <li>
            <strong>This is a closed beta — participation is by invitation only.</strong>{' '}
            This is an early-stage, unaudited protocol running on Base Mainnet with real USDC.
            This is not a public token sale or public launch. FinancialBase does not provide
            financial, legal, or tax advice. Use small test amounts only.
          </li>
          <li>
            <strong>Treasury handles protocol fees, rebate reserves, and protocol income — it does not control user principal.</strong>{' '}
            User funds are held in the vault contract (<code>YearRingCoreVaultV01</code>) and managed
            by the strategy layer. Treasury is a separate accounting contract for fee and rebate flows.
          </li>
          <li>
            <strong>Governance votes are signal-layer only — they do not auto-execute.</strong>{' '}
            <code>GovernanceSignalV02</code> records on-chain vote weight and preference signals.
            No signal automatically triggers a protocol parameter change. All changes require an
            explicit admin action subject to the 24h timelock.
          </li>
        </ul>
      </div>

      {/* ── Admin / Governance Risk Disclosure ── */}
      <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--warn, #c60)' }}>
        <div className="card-title">Governance & Permission Risk Disclosure</div>
        <ul className="limitations-list">
          <li>
            <strong>DEFAULT_ADMIN_ROLE is held by ProtocolTimelockV02 (24h timelock).</strong> Non-emergency protocol
            operations (fee updates, reserve ratio changes, strategy switches) must be scheduled and
            executed via <code>ProtocolTimelockV02</code> with a 24-hour delay. No Safe/multisig is configured in
            the current closed beta deployment.
          </li>
          <li>
            <strong>EMERGENCY_ROLE can act immediately, bypassing the timelock.</strong> This role
            exists to allow rapid response to exploits or market crises. The holder can pause deposits/redeems
            and trigger Emergency Exit without any delay.
          </li>
          <li>
            <strong>Emergency Exit gives admin exclusive control over exit round timing.</strong> During
            EmergencyExit mode, users can only redeem via <code>claimExitAssets()</code> within an admin-opened
            round. The admin determines how much USDC is made available and when rounds open/close.
          </li>
          <li>
            <strong>YearRingCoreVaultV01 is non-upgradeable.</strong> A contract migration would
            require a new deployment and voluntary user migration.
          </li>
          <li>
            <strong>Timelock delay: 24 hours minimum.</strong> Non-emergency governance operations must
            be scheduled and then executed after a 24h waiting period.
          </li>
        </ul>
      </div>

      {/* ── Known Limitations ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Known Limitations (Closed Beta)</div>
        <ul className="limitations-list">
          <li>
            <strong>Maturity requires full lock duration.</strong> Depending on tier, live maturity
            requires waiting 30–180 days. Full lifecycle (lock → matured → unlock) can be demonstrated
            via a local Hardhat demo with <code>evm_increaseTime</code>.
          </li>
          <li>
            <strong>Beneficiary: locked positions only.</strong> <code>executeClaim</code> transfers
            locked positions to the beneficiary. The original owner's free yrCORE shares balance is{' '}
            <strong>not</strong> transferred automatically — on-chain beneficiary record only.
          </li>
          <li>
            <strong>Rebate rights not inherited.</strong> When a beneficiary claims a lock,
            the fee rebate entitlement stays with the original lock owner.
          </li>
          <li>
            <strong>Heartbeat ≠ other actions.</strong> Only <code>heartbeat()</code> resets
            the inactivity timer. Other protocol operations (deposit, lock, redeem) do not.
          </li>
          <li>
            <strong>MAX 5 active locks per address.</strong> Attempting a 6th lock will revert
            with <code>TooManyActiveLocks</code>.
          </li>
        </ul>
      </div>
    </>
  )
}
