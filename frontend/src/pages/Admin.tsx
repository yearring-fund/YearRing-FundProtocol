import AdminConsole from '../components/AdminConsole'

export default function Admin() {
  return (
    <div className="page-content">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--blue)' }}>Admin Console</div>
        <div className="note">
          Protocol infrastructure status and operator tools. High-risk operations require Timelock execution.
          Connect as Guardian (EMERGENCY_ROLE) to access emergency pause controls.
        </div>
      </div>
      <AdminConsole />
    </div>
  )
}
