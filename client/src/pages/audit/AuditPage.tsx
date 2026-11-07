// Lane A owner: read-only audit log.
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';

export default function AuditPage() {
  const [log] = useTable(tables.auditEntries);
  const [users] = useTable(tables.members);
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? hex.slice(0, 8);
  const rows = [...log].sort((a, b) => (a.id < b.id ? 1 : -1));
  return (
    <section>
      <h1>Audit log</h1>
      <p className="muted">Read-only record of security-relevant actions.</p>
      {rows.length === 0 && <p className="empty">Nothing recorded yet.</p>}
      <table className="table">
        <thead>
          <tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id.toString()}>
              <td>{r.at.toDate().toLocaleString()}</td>
              <td>{nameOf(r.actor.toHexString())}</td>
              <td>{r.action}</td>
              <td>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
