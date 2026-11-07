// Lane C owner: blast radius (what systems / customers / accounts were hit).
import { useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { Chip, NoIncident, SCOPE_LABEL, SCOPE_STATUSES, useCurrentIncident } from '../../components/shared';

export default function ScopePage() {
  const incident = useCurrentIncident();
  const [allItems] = useTable(tables.scopeItems);
  const upsertScopeItem = useReducer(reducers.upsertScopeItem);
  const run = useRun();
  const [form, setForm] = useState({ label: '', assetRef: '', assetType: 'system', status: 'unknown', records: '0' });

  if (!incident) return <NoIncident />;
  const items = allItems.filter(s => s.incidentId === incident.id);
  const totals = Object.fromEntries(SCOPE_STATUSES.map(s => [s, 0n])) as Record<string, bigint>;
  for (const it of items) totals[it.status] = (totals[it.status] ?? 0n) + it.recordsCount;

  const save = (it: { assetType: string; assetRef: string; label: string; recordsCount: bigint }, status: string) =>
    run(upsertScopeItem({ incidentId: incident.id, ...it, status }), `${it.label}: ${SCOPE_LABEL[status]}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(form.records);
    if (!Number.isInteger(n) || n < 0) return;
    save({ assetType: form.assetType, assetRef: form.assetRef, label: form.label, recordsCount: BigInt(n) }, form.status);
    setForm({ ...form, label: '', assetRef: '', records: '0' });
  };

  return (
    <section>
      <h1>What was hit</h1>
      <div className="counters" aria-live="polite">
        {SCOPE_STATUSES.map(s => (
          <div key={s} className={`counter scope-${s}`}>
            <div className="counter-num">{totals[s].toLocaleString()}</div>
            <div>records {SCOPE_LABEL[s].toLowerCase()}</div>
          </div>
        ))}
      </div>
      {items.length === 0 && <p className="empty">Nothing listed yet: add the first affected system below.</p>}
      <table className="table">
        <thead>
          <tr><th>Asset</th><th>Type</th><th>Status</th><th>Records</th><th>Change</th></tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id.toString()}>
              <td>{it.label} <span className="muted">{it.assetRef}</span></td>
              <td>{it.assetType}</td>
              <td><Chip kind="scope" value={it.status} label={SCOPE_LABEL[it.status] ?? it.status} /></td>
              <td>{it.recordsCount.toLocaleString()}</td>
              <td>
                <label className="sr-only" htmlFor={`st-${it.id}`}>Status for {it.label}</label>
                <select id={`st-${it.id}`} value={it.status} onChange={e => save(it, e.target.value)}>
                  {SCOPE_STATUSES.map(s => (
                    <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="card form" onSubmit={submit}>
        <h2>Add affected asset</h2>
        <label>Name <input required value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Core banking DB" /></label>
        <label>ID or hostname <input required value={form.assetRef} onChange={e => setForm({ ...form, assetRef: e.target.value })} /></label>
        <label>
          Type
          <select value={form.assetType} onChange={e => setForm({ ...form, assetType: e.target.value })}>
            <option value="system">System</option>
            <option value="customer">Customer</option>
            <option value="account">Account</option>
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {SCOPE_STATUSES.map(s => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label>Records affected <input type="number" min={0} step={1} value={form.records} onChange={e => setForm({ ...form, records: e.target.value })} /></label>
        <button className="primary big" type="submit">Add asset</button>
      </form>
    </section>
  );
}
