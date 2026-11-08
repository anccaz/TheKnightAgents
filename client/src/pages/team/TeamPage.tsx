// Lane A owner: join screen, add members by ID, roles, security events (audit log).
import { useState, type FormEvent } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { Copy, ShieldCheck, UserPlus } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { ROLES, ROLE_LABEL, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SELECT = 'h-8 rounded-lg border border-input bg-input/30 px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 outline-none';
const ACTION_LABEL: Record<string, string> = {
  add_member: 'Member added',
  set_role: 'Role changed',
  create_incident: 'Incident declared',
  set_phase: 'Phase changed',
  fraud_alert_status: 'Fraud alert decided',
  auto_freeze: 'Account auto-frozen',
  complete_legal_clock: 'Deadline filed',
  notice_sent: 'Notice sent',
};

/** Shown to anyone who isn't a member yet: the only way in is an admin adding this ID. */
export function JoinScreen() {
  const { identity } = useSpacetimeDB();
  const hex = identity?.toHexString() ?? '';
  const run = useRun();
  return (
    <section className="glass mx-auto mt-10 max-w-xl space-y-4 p-6">
      <h1 className="font-heading text-xl tracking-[0.2em] text-white uppercase">Join the response team</h1>
      <p className="text-muted-foreground">
        Send this ID to your admin over a channel you trust (phone, in person). They add you and this page opens by itself.
      </p>
      <label className="block space-y-1 text-sm font-medium">
        Your ID
        <Input readOnly value={hex} onFocus={e => e.target.select()} className="font-mono text-xs" />
      </label>
      <Button className="w-full" size="lg" disabled={!hex} onClick={() => run(navigator.clipboard.writeText(hex), 'ID copied')}>
        <Copy className="size-4" /> Copy my ID
      </Button>
      <p className="text-xs text-muted-foreground">
        First admin: whoever published the database runs <code className="text-neon">spacetime call … add_member</code> with this ID (see README).
      </p>
    </section>
  );
}

export default function TeamPage() {
  const me = useMe();
  const [users] = useTable(tables.members);
  const [log] = useTable(tables.auditEntries);
  const setRole = useReducer(reducers.setRole);
  const run = useRun();
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? 'Breach Room';
  const [action, setAction] = useState('all');
  const sorted = [...log].sort((a, b) => (a.id < b.id ? 1 : -1));
  const actions = [...new Set(sorted.map(e => e.action))];
  const events = action === 'all' ? sorted : sorted.filter(e => e.action === action);
  const admin = me?.role === 'admin';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        {admin && <AddMemberForm />}
        <section className="glass p-4">
          <h2 className="mb-3 font-heading text-sm tracking-[0.2em] text-white uppercase">Members ({users.length})</h2>
          <ul className="divide-y divide-border">
            {users.map(u => (
              <li key={u.identity.toHexString()} className="flex flex-wrap items-center gap-3 py-2">
                <span className={u.online ? 'text-ok' : 'text-muted-foreground'} aria-label={u.online ? 'online' : 'offline'}>
                  {u.online ? '●' : '○'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{u.name}</span> <span className="text-sm text-muted-foreground">{u.email}</span>
                </span>
                {admin ? (
                  <select
                    aria-label={`Role for ${u.name}`}
                    className={SELECT}
                    value={u.role}
                    onChange={e => run(setRole({ target: u.identity, role: e.target.value }), `${u.name}: ${ROLE_LABEL[e.target.value]}`)}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">{ROLE_LABEL[u.role] ?? u.role}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="glass p-4">
        <h2 className="mb-1 flex items-center gap-2 font-heading text-sm tracking-[0.2em] text-white uppercase">
          <ShieldCheck className="size-4" /> Security events
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">Append-only record of who did what. Admins only.</p>
        {sorted.length > 0 && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            Show
            <select aria-label="Filter security events" className={SELECT} value={action} onChange={e => setAction(e.target.value)}>
              <option value="all">All events ({sorted.length})</option>
              {actions.map(a => (
                <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>
              ))}
            </select>
          </label>
        )}
        {events.length === 0 && <p className="text-sm text-muted-foreground italic">Nothing recorded yet.</p>}
        <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {events.map(e => (
            <li key={e.id.toString()} className="rounded-lg border border-magenta/30 bg-accent/20 px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <b>{ACTION_LABEL[e.action] ?? e.action}</b>
                <time className="font-mono text-xs text-muted-foreground">{e.at.toDate().toLocaleString()}</time>
              </div>
              <div className="text-muted-foreground">
                {e.detail} · by {nameOf(e.actor.toHexString())}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function AddMemberForm() {
  const addMember = useReducer(reducers.addMember);
  const run = useRun();
  const [form, setForm] = useState({ id: '', name: '', email: '', role: 'responder' });
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let target: Identity;
    try {
      target = Identity.fromString(form.id.trim());
    } catch {
      setError('That ID is not valid. Ask them to copy it again.');
      return;
    }
    setError('');
    run(addMember({ target, name: form.name, email: form.email, role: form.role }), `${form.name} added`);
    setForm({ id: '', name: '', email: '', role: 'responder' });
  };

  return (
    <form className="glass space-y-3 p-4" onSubmit={submit}>
      <h2 className="flex items-center gap-2 font-heading text-sm tracking-[0.2em] text-white uppercase">
        <UserPlus className="size-4" /> Add someone
      </h2>
      <label className="block space-y-1 text-sm font-medium">
        Their ID
        <Input required value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} className="font-mono text-xs" />
      </label>
      {error && <p role="alert" className="text-sm font-semibold text-sev-medium">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm font-medium">
          Name
          <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="block space-y-1 text-sm font-medium">
          Email
          <Input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </label>
      </div>
      <label className="block space-y-1 text-sm font-medium">
        Role
        <select className={`${SELECT} w-full`} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          {ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      </label>
      <Button type="submit" size="lg" className="w-full">Add member</Button>
    </form>
  );
}
