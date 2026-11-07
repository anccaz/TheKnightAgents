// Lane A owner: access control (bootstrap admin, invites, accept invite).
import { useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { ROLES, ROLE_LABEL, useMe } from '../../components/shared';

export default function AccessPage() {
  const [users] = useTable(tables.user);
  const me = useMe();

  if (users.length === 0) return <BootstrapForm />;
  if (!me) return <AcceptInviteForm />;
  return (
    <section>
      <h1>Team & access</h1>
      {me.role === 'admin' ? <InviteForm /> : <p className="muted">Only admins can invite people.</p>}
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

function BootstrapForm() {
  const bootstrapAdmin = useReducer(reducers.bootstrapAdmin);
  const run = useRun();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(bootstrapAdmin({ name, email }), 'You are the admin');
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h1>Set up Breach Room</h1>
      <p>No one has joined yet. The first person becomes the admin.</p>
      <label>
        Your name <input required value={name} onChange={e => setName(e.target.value)} />
      </label>
      <label>
        Work email <input required type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      <button className="primary big" type="submit">Become admin</button>
    </form>
  );
}

function AcceptInviteForm() {
  const acceptInvite = useReducer(reducers.acceptInvite);
  const run = useRun();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(acceptInvite({ code: code.trim(), name }), 'Welcome to the team');
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h1>Join the response team</h1>
      <p>Paste the invite code your admin sent you.</p>
      <label>
        Invite code <input required value={code} onChange={e => setCode(e.target.value)} />
      </label>
      <label>
        Your name <input required value={name} onChange={e => setName(e.target.value)} />
      </label>
      <button className="primary big" type="submit">Join</button>
    </form>
  );
}

function InviteForm() {
  const createInvite = useReducer(reducers.createInvite);
  const [invites] = useTable(tables.invite);
  const run = useRun();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('responder');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(createInvite({ email, role }), `Invite created for ${email}`);
    setEmail('');
  };
  return (
    <>
      <form className="card form" onSubmit={submit}>
        <h2>Invite someone</h2>
        <label>
          Email <input required type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>
          Role
          <select value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <button className="primary big" type="submit">Create invite</button>
      </form>
      <h2>Invites</h2>
      {invites.length === 0 && <p className="empty">No invites yet: create one above.</p>}
      <ul className="list">
        {invites.map(i => (
          <li key={i.code}>
            {i.email} · {ROLE_LABEL[i.role] ?? i.role} · code <code>{i.code}</code> · {i.used ? 'Used' : 'Not used yet'}
          </li>
        ))}
      </ul>
    </>
  );
}
