import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { PHASE_LABEL, ROLE_LABEL, SeverityChip, useCurrentIncident, useMe } from './components/shared';
import AccessPage from './pages/access/AccessPage';
import IncidentPage from './pages/incident/IncidentPage';
import CommsPage from './pages/comms/CommsPage';
import ScopePage from './pages/scope/ScopePage';
import FraudPage from './pages/fraud/FraudPage';
import LegalPage from './pages/legal/LegalPage';
import AuditPage from './pages/audit/AuditPage';

const PAGES = {
  incident: { label: 'Incident Command', icon: '⚡', Page: IncidentPage },
  comms: { label: 'Encrypted Comms', icon: '💬', Page: CommsPage },
  scope: { label: 'Blast Radius / Scope', icon: '🎯', Page: ScopePage },
  fraud: { label: 'Fraud Interception', icon: '🛡️', Page: FraudPage },
  legal: { label: 'SEC / Regulatory Clocks', icon: '⏱️', Page: LegalPage },
  audit: { label: 'Immutable Audit Log', icon: '📜', Page: AuditPage },
  access: { label: 'Zero-Trust Directory', icon: '🔑', Page: AccessPage },
} as const;
type PageKey = keyof typeof PAGES;

export default function App() {
  const { isActive, connectionError } = useSpacetimeDB();
  const [users] = useTable(tables.members);
  const me = useMe();
  const incident = useCurrentIncident();
  const [page, setPage] = useState<PageKey>('incident');

  const online = users.filter(u => u.online);
  const current: PageKey = me ? page : 'access';
  const { Page } = PAGES[current];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-wrapper">
          <div className="brand-icon">⬡</div>
          <span className="brand-title">BreachRoom</span>
          <span className="brand-badge">MAINCLOUD</span>
        </div>

        <div className="topbar-center">
          {incident ? (
            <div className="incident-pill">
              <span className="pulse-indicator" />
              <span>{incident.title}</span>
              <span style={{ color: 'var(--text-muted)' }}>|</span>
              <span style={{ color: 'var(--accent-amber)' }}>
                {PHASE_LABEL[incident.phase] ?? incident.phase}
              </span>
              <SeverityChip severity={incident.severity} />
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>STANDBY // NO ACTIVE SEV-1 INCIDENT</span>
          )}
        </div>

        <div className="topbar-right">
          <span className="status-tag">
            <span style={{ color: 'var(--accent-emerald)' }}>●</span>
            {online.length} Node{online.length !== 1 ? 's' : ''} Online
          </span>

          {me && (
            <span className="status-tag">
              <strong style={{ color: '#fff' }}>{me.name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>({ROLE_LABEL[me.role] ?? me.role})</span>
            </span>
          )}

          <span className={`status-tag ${isActive ? 'active' : ''}`}>
            {isActive ? '● Live' : connectionError ? '× Offline' : 'Connecting…'}
          </span>
        </div>
      </header>

      <nav className="leftnav" aria-label="Crisis Controls">
        <div className="nav-section-label">Incident Modules</div>
        {(Object.keys(PAGES) as PageKey[]).map(k => (
          <button
            key={k}
            className={`nav-item ${k === current ? 'active' : ''}`}
            aria-current={k === current ? 'page' : undefined}
            disabled={!me && k !== 'access'}
            onClick={() => setPage(k)}
          >
            <span style={{ fontSize: '13px' }}>{PAGES[k].icon}</span>
            <span>{PAGES[k].label}</span>
          </button>
        ))}
      </nav>

      <main className="main">
        <Page />
      </main>
    </div>
  );
}
