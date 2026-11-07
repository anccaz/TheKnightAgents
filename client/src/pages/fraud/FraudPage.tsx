// Lane C owner: fraud alerts on suspicious transfers.
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { Chip, NoIncident, useCurrentIncident } from '../../components/shared';

const STATUS_LABEL: Record<string, string> = { open: 'Needs review', frozen: 'Frozen', dismissed: 'Dismissed' };

const money = (cents: bigint) =>
  `$${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, '0')}`;

export default function FraudPage() {
  const incident = useCurrentIncident();
  const [allAlerts] = useTable(tables.fraudAlert);
  const setFraudAlertStatus = useReducer(reducers.setFraudAlertStatus);
  const run = useRun();

  if (!incident) return <NoIncident />;
  // Open alerts first, newest first.
  const alerts = allAlerts
    .filter(a => a.incidentId === incident.id)
    .sort((a, b) => (a.status === 'open') !== (b.status === 'open') ? (a.status === 'open' ? -1 : 1) : a.id < b.id ? 1 : -1);

  const act = (alertId: bigint, account: string, status: 'frozen' | 'dismissed') => {
    const verb = status === 'frozen' ? 'Freeze' : 'Dismiss';
    if (!window.confirm(`${verb} the alert on account ${account}?`)) return;
    run(setFraudAlertStatus({ alertId, status }), `${verb}: ${account}`);
  };

  return (
    <section>
      <h1>Fraud alerts</h1>
      {alerts.length === 0 && <p className="empty">No suspicious transfers flagged.</p>}
      <ul className="list">
        {alerts.map(a => (
          <li key={a.id.toString()} className="card alert-row">
            <div>
              <Chip kind="fraud" value={a.status} label={STATUS_LABEL[a.status] ?? a.status} />{' '}
              <strong>{money(a.amountCents)}</strong> from account <code>{a.accountRef}</code>
              <div className="muted">
                Transfer {a.transferRef} · {a.reason} · {a.createdAt.toDate().toLocaleString()}
              </div>
            </div>
            {a.status === 'open' && (
              <div className="actions">
                <button className="danger" onClick={() => act(a.id, a.accountRef, 'frozen')}>Freeze account</button>
                <button onClick={() => act(a.id, a.accountRef, 'dismissed')}>Dismiss</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
