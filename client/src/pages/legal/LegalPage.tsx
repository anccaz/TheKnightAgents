// Lane D owner: regulatory notification deadlines.
import { useEffect, useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { NoIncident, useCurrentIncident } from '../../components/shared';

// Presets: verify before demo. Hours are from the team brief, not legal advice.
const PRESETS = [
  { regime: 'sec_8k', label: 'SEC 8-K (96h)', hours: 96 },
  { regime: 'gdpr', label: 'GDPR (72h)', hours: 72 },
  { regime: 'tx_breach', label: 'Texas breach notice (60 days)', hours: 1440 },
];

function remaining(ms: number) {
  if (ms <= 0) return 'OVERDUE';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s % 60}s left`;
}

export default function LegalPage() {
  const incident = useCurrentIncident();
  const [allClocks] = useTable(tables.legalClocks);
  const startLegalClock = useReducer(reducers.startLegalClock);
  const completeLegalClock = useReducer(reducers.completeLegalClock);
  const run = useRun();
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState({ regime: 'custom', label: '', hours: '72' });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!incident) return <NoIncident />;
  const clocks = allClocks
    .filter(c => c.incidentId === incident.id)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.deadlineAt.toDate().getTime() - b.deadlineAt.toDate().getTime());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hours = Number(form.hours);
    if (!Number.isInteger(hours) || hours <= 0) return;
    run(startLegalClock({ incidentId: incident.id, regime: form.regime, label: form.label, hours }), `Clock started: ${form.label}`);
  };

  return (
    <section>
      <h1>Legal deadlines</h1>
      {clocks.length === 0 && <p className="empty">No clocks running: start one below.</p>}
      <ul className="list">
        {clocks.map(c => {
          const left = c.deadlineAt.toDate().getTime() - now;
          const urgency = c.done ? 'done' : left <= 0 ? 'overdue' : left < 24 * 3600_000 ? 'soon' : 'ok';
          return (
            <li key={c.id.toString()} className={`card clock clock-${urgency}`}>
              <div>
                <strong>{c.label}</strong>
                <div className="clock-time">{c.done ? '✓ Filed' : remaining(left)}</div>
                <div className="muted">Due {c.deadlineAt.toDate().toLocaleString()}</div>
              </div>
              {!c.done && (
                <button
                  onClick={() => window.confirm(`Mark "${c.label}" as filed?`) && run(completeLegalClock({ clockId: c.id }), 'Marked as filed')}
                >
                  Mark as filed
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form className="card form" onSubmit={submit}>
        <h2>Start a deadline clock</h2>
        <p className="warn">Presets: verify before demo.</p>
        <div className="actions">
          {PRESETS.map(p => (
            <button key={p.regime} type="button" onClick={() => setForm({ regime: p.regime, label: p.label, hours: String(p.hours) })}>
              {p.label} · verify before demo
            </button>
          ))}
        </div>
        <label>Name <input required value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></label>
        <label>Hours until due <input type="number" min={1} step={1} required value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} /></label>
        <button className="primary big" type="submit">Start clock</button>
      </form>
    </section>
  );
}
