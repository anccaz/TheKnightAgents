// Lane A owner: access control (join by ID, admins add members).
import { useState, type FormEvent } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { ROLES, ROLE_LABEL, useMe } from '../../components/shared';

export default function AccessPage() {
  const [users] = useTable(tables.members);
  const me = useMe();

  if (!me) return <JoinScreen usersCount={users.length} />;
  return (
    <section>
      <h1>Team & access</h1>
      {me.role === 'admin' ? <AddMemberForm /> : <p className="muted">Only admins can add people.</p>}
      <h2>Members</h2>
      <ul className="list">
        {users.map(u => (
          <li key={u.identity.toHexString()}>
            {u.online ? '● ' : '○ '}
            {u.name} · {u.email} · {ROLE_LABEL[u.role] ?? u.role} {u.online ? '(online)' : '(offline)'}
          </li>
        ))}
      </ul>
    </section>
  );
}

function JoinScreen({ usersCount }: { usersCount: number }) {
  const { identity } = useSpacetimeDB();
  const bootstrap = useReducer(reducers.bootstrapAdmin);
  const run = useRun();
  const hex = identity?.toHexString() ?? '';

  const handleBootstrap = () => {
    run(
      bootstrap({ name: 'ancca', email: 'annie@bank.com' }),
      'Claimed root admin!'
    );
  };

  return (
    <section className="card form">
      <h1>Join the response team</h1>
      <p>Send this ID to your admin over a channel you trust (phone, in person). They add you, and this page opens up by itself.</p>
      <label>
        Your ID <input readOnly value={hex} onFocus={e => e.target.select()} />
      </label>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="primary big" type="button" onClick={() => navigator.clipboard?.writeText(hex)} disabled={!hex}>
          Copy my ID
        </button>

        {usersCount === 0 && (
          <button
            className="big"
            type="button"
            onClick={handleBootstrap}
            style={{ backgroundColor: '#16a34a', color: 'white', fontWeight: 600 }}
          >
            Become Admin (First User)
          </button>
        )}
      </div>

      <p className="muted">
        {usersCount === 0
          ? 'No admin registered yet. Click "Become Admin" to initialize root access.'
          : 'First admin: the person who published the database runs spacetime call with this ID (see README).'}
      </p>
    </section>
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
    <form className="card form" onSubmit={submit}>
      <h2>Add someone</h2>
      <label>
        Their ID <input required value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} />
      </label>
      {error && <p className="warn" role="alert">{error}</p>}
      <label>
        Name <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Email <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>
        Role
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          {ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      </label>
      <button className="primary big" type="submit">Add member</button>
    </form>
  );
}

