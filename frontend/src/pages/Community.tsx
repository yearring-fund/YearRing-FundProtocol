const DISCORD_URL = 'https://discord.gg/gtrBCjYNdB'

// TODO: Replace X_URL with the official YearRing X (Twitter) profile URL when available
const X_URL = '#TODO_X_TWITTER'

// TODO: Replace GITHUB_URL with the official YearRing GitHub organization URL when available
const GITHUB_URL = '#TODO_GITHUB'

export default function Community() {
  return (
    <div className="page-content">

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)', marginBottom: 10 }}>
          YearRing Community
        </div>
        <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.8, maxWidth: 580 }}>
          An early gathering point for people who think carefully about long-term,
          programmable financial infrastructure — not speculation, not yield-chasing.
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-blue">Early Stage</span>
          <span className="badge badge-gray">Invite-Adjacent</span>
          <span className="badge badge-gray">Base Mainnet</span>
        </div>
      </div>

      {/* ── Discord CTA ─────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          marginBottom: 16,
          border: '1px solid #1a3a5c',
          background: '#0a1e2e',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--blue)', marginBottom: 6 }}>
          Join the YearRing Community
        </div>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, marginBottom: 16 }}>
          The official Discord is the main space for community updates, early feedback, product
          questions, and security notices.
        </div>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none' }}
        >
          <button className="btn-primary" style={{ fontSize: 13, padding: '8px 20px', cursor: 'pointer' }}>
            Join the official Discord
          </button>
        </a>
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid #1a3a5c',
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.7,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ color: 'var(--yellow)', flexShrink: 0 }}>⚠</span>
          YearRing admins will never ask for seed phrases, private keys, private wallet access,
          direct transfers, or wallet validation links. Always verify official links through the
          Discord #official-links channel.
        </div>
      </div>

      {/* ── Why This Community Exists ──────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Why This Community Exists</div>
        <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text)', marginBottom: 10 }}>
          YearRing Fund Protocol is being built as long-term financial infrastructure — a
          programmable vault layer that lets users deposit, lock, and structure commitments
          on-chain, with a beneficiary and governance layer on top.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text)', marginBottom: 10 }}>
          Building that responsibly requires a small, serious group of early observers and testers
          who care about system design, not just returns. This community is where that group forms.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--muted)' }}>
          We are not looking for a large following. We are looking for the right people.
        </p>
      </div>

      {/* ── Who Should Join ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Who Should Join</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {[
            'Developers and researchers interested in ERC-4626 vault design, commitment layers, or on-chain governance mechanics.',
            'Long-term thinkers who want to observe a protocol built from first principles, not from hype cycles.',
            'Security-minded participants who want to understand a system before it scales.',
            'People interested in DeFi infrastructure — not meme tokens, not leverage, not yield farming.',
            'Those willing to read documentation, ask informed questions, and report observations honestly.',
          ].map((item, i) => (
            <li
              key={i}
              style={{
                padding: '7px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
                lineHeight: 1.7,
                color: 'var(--text)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <span style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 1 }}>→</span>
              {item}
            </li>
          ))}
          <li
            style={{
              padding: '7px 0',
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.7,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1 }}>→</span>
            If you are primarily motivated by token price, airdrop eligibility, or short-term
            returns, this community is not the right fit.
          </li>
        </ul>
      </div>

      {/* ── What the Community Does ──────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">What the Community Does</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              label: 'Observe',
              desc: "Follow the protocol's development milestones, architectural decisions, and on-chain deployments as they happen.",
            },
            {
              label: 'Discuss',
              desc: 'Exchange questions and feedback on protocol design, risk structures, fee mechanics, and governance systems.',
            },
            {
              label: 'Test',
              desc: 'Invited members may participate in controlled-access testing rounds on Base Mainnet under defined conditions.',
            },
            {
              label: 'Report',
              desc: 'Surface edge cases, UI issues, documentation gaps, or security observations through the proper channels.',
            },
            {
              label: 'Signal',
              desc: 'Provide structured feedback that informs future protocol decisions — not hype, not pressure.',
            },
          ].map(({ label, desc }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                style={{
                  minWidth: 68,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--blue)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  paddingTop: 2,
                  flexShrink: 0,
                }}
              >
                {label}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Early Tester Path ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Early Tester Path</div>
        <div className="note" style={{ marginBottom: 16 }}>
          Testing access is controlled and invitation-based. There is no public mint, no whitelist
          competition, and no points system. Access is granted based on demonstrated interest and
          fit.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              step: '01',
              title: 'Join the community',
              desc: 'Follow the official channels and read the available documentation. Understand the protocol before requesting access.',
            },
            {
              step: '02',
              title: 'Engage substantively',
              desc: 'Ask or answer questions that show system understanding. Demonstrate that you read docs and think carefully.',
            },
            {
              step: '03',
              title: 'Express interest',
              desc: 'If a testing round is open, express interest through the designated process. Do not DM team members directly to ask for access.',
            },
            {
              step: '04',
              title: 'Receive invitation',
              desc: 'If access is granted, you will receive an official invitation through verifiable channels — never through a private message requesting wallet action.',
            },
            {
              step: '05',
              title: 'Test and report',
              desc: 'Use the protocol as directed. Document what you observe. Submit structured feedback. Your keys remain yours — we will never ask for them.',
            },
          ].map(({ step, title, desc }, i, arr) => (
            <div
              key={step}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                padding: '12px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {step}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  {title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Community Rules ──────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Community Rules</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {[
            'Discuss the protocol, not its price. There is no token. Speculation is off-topic.',
            'Be precise. Vague questions get vague answers. Show your reasoning.',
            'No promotion of other protocols, tokens, or services in community spaces.',
            'No unsolicited financial advice, yield comparisons, or return projections.',
            'Respect the early-stage nature of this project. Unrealistic expectations create pressure that harms careful development.',
            'Follow the designated feedback and bug-report channels. Do not post sensitive findings publicly.',
            'Team members communicate through official, verifiable accounts only. Report impersonators immediately.',
          ].map((rule, i) => (
            <li
              key={i}
              style={{
                padding: '7px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              <span style={{ color: 'var(--muted)', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>
                {String(i + 1).padStart(2, '0')}.
              </span>
              {rule}
            </li>
          ))}
          <li style={{ padding: '7px 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Violations may result in removal from community spaces. Serious violations such as
            impersonation or phishing will be escalated.
          </li>
        </ul>
      </div>

      {/* ── Safety Notice ────────────────────────────────────────── */}
      <div
        style={{
          background: '#1a1400',
          border: '1px solid #4a3000',
          borderRadius: 'var(--r)',
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            color: 'var(--yellow)',
            borderBottom: '1px solid #4a3000',
            paddingBottom: 8,
            marginBottom: 12,
          }}
        >
          Safety Notice
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {[
            'YearRing Fund Protocol is early-stage and has not been independently audited. Participation carries risk.',
            'This community does not provide financial advice. Nothing here constitutes an investment recommendation.',
            'No yield is guaranteed. No token allocation, airdrop, or future access right is promised.',
            'The team will never ask for your seed phrase, private keys, or direct wallet transfers through any private message or channel.',
            "Always verify official links through the project's public repositories and documentation. Treat unsolicited contact as suspicious.",
            'Only interact with smart contract addresses published in the official documentation.',
          ].map((item, i) => (
            <li
              key={i}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid #4a3000',
                fontSize: 13,
                lineHeight: 1.7,
                color: 'var(--text)',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <span style={{ color: 'var(--yellow)', flexShrink: 0 }}>⚠</span>
              {item}
            </li>
          ))}
          <li
            style={{
              padding: '6px 0',
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.7,
            }}
          >
            If you receive a message claiming to be from the YearRing team and requesting wallet
            access or personal keys, report it immediately in the official community channels.
          </li>
        </ul>
      </div>

      {/* ── Official Links ───────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Official Links</div>
        <div className="note" style={{ marginBottom: 14 }}>
          Only interact with links from the sources below. Bookmark them directly rather than
          searching, to reduce exposure to phishing sites.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: 'var(--bg)',
              border: '1px solid #1a3a5c',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              textDecoration: 'none',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: 'var(--blue)', fontWeight: 600, minWidth: 72, flexShrink: 0 }}>
              Discord
            </span>
            <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160 }}>
              Official community server — discussions, feedback, announcements
            </span>
            <span className="badge badge-blue" style={{ flexShrink: 0 }}>Official</span>
          </a>

          {/* TODO: Replace X_URL constant at the top of this file with the official X profile URL */}
          <a
            href={X_URL}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              textDecoration: 'none',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: 'var(--blue)', fontWeight: 600, minWidth: 72, flexShrink: 0 }}>
              X / Twitter
            </span>
            <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160 }}>
              Development updates and milestone announcements
            </span>
            <span className="badge badge-gray" style={{ flexShrink: 0 }}>Coming Soon</span>
          </a>

          {/* TODO: Replace GITHUB_URL constant at the top of this file with the official GitHub org URL */}
          <a
            href={GITHUB_URL}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              textDecoration: 'none',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: 'var(--blue)', fontWeight: 600, minWidth: 72, flexShrink: 0 }}>
              GitHub
            </span>
            <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160 }}>
              Protocol source code, technical documentation, and audit reports
            </span>
            <span className="badge badge-gray" style={{ flexShrink: 0 }}>Coming Soon</span>
          </a>

        </div>
        <div className="note" style={{ marginTop: 12 }}>
          Links marked <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 2, marginRight: 2 }}>Coming Soon</span> are
          pending official channel launch. Do not use third-party links. Discord is now live —
          all other channels will be confirmed here when available.
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div
        className="note"
        style={{ textAlign: 'center', paddingBottom: 12, lineHeight: 2 }}
      >
        YearRing Fund Protocol · Early Community Access · Not a public product · No financial advice
      </div>

    </div>
  )
}
