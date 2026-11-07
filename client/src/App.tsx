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

// Simple state router: no router dependency.
const PAGES = {
  incident: { label: 'Incident', Page: IncidentPage },
  comms: { label: 'Messages', Page: CommsPage },
  scope: { label: 'What was hit', Page: ScopePage },
  fraud: { label: 'Fraud alerts', Page: FraudPage },
  legal: { label: 'Legal deadlines', Page: LegalPage },
  audit: { label: 'Audit log', Page: AuditPage },
  access: { label: 'Team & access', Page: AccessPage },
} as const;
type PageKey = keyof typeof PAGES;

export default function App() {
  const { isActive, connectionError } = useSpacetimeDB();
  const [users] = useTable(tables.members);
  const me = useMe();
  const incident = useCurrentIncident();
  const [page, setPage] = useState<PageKey>('incident');

  const online = users.filter(u => u.online);
  // Not a member yet: the only useful screen is access (bootstrap / accept invite).
  const current: PageKey = me ? page : 'access';
  const { Page } = PAGES[current];

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Breach Room</span>
        {incident ? (
          <span className="topbar-incident">
            <strong>{incident.title}</strong>
            <span className="phase-pill">Phase: {PHASE_LABEL[incident.phase] ?? incident.phase}</span>
            <SeverityChip severity={incident.severity} />
          </span>
        ) : (
          <span className="muted">No active incident</span>
        )}
        <span className="topbar-right">
          <span title={online.map(u => u.name).join(', ')}>● {online.length} online</span>
          {me && (
            <span className="muted">
              {me.name} ({ROLE_LABEL[me.role] ?? me.role})
            </span>
          )}
          <span className={isActive ? 'conn-ok' : 'conn-bad'}>
            {isActive ? 'Connected' : connectionError ? 'Connection failed' : 'Connecting…'}
          </span>
        </span>
      </header>
      <nav className="leftnav" aria-label="Sections">
        {(Object.keys(PAGES) as PageKey[]).map(k => (
          <button
            key={k}
            className={k === current ? 'nav-item active' : 'nav-item'}
            aria-current={k === current ? 'page' : undefined}
            disabled={!me && k !== 'access'}
            onClick={() => setPage(k)}
          >
            {PAGES[k].label}
          </button>
        ))}
      </nav>
      <main className="main">
        <Page />
      </main>
    </div>
  );
}
