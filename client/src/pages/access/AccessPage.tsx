// Lane A: Zero-Trust Cryptographic Access & Identity Clearance
import { useState, type FormEvent } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { ROLES, ROLE_LABEL, useMe } from '../../components/shared';

// Creative Clearance Tier Metadata
const CLEARANCE_CONFIG: Record<string, { label: string; badge: string; desc: string }> = {
  admin: {
    label: 'CLEARANCE LEVEL 5 // ROOT SOVEREIGN',
    badge: 'bg-red-500/10 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]',
    desc: 'Unrestricted directory modification & memory view authority.',
  },
  incident_lead: {
    label: 'CLEARANCE LEVEL 4 // INCIDENT COMMAND',
    badge: 'bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
    desc: 'Incident phase transition, timeline control, and containment actions.',
  },
  legal: {
    label: 'CLEARANCE LEVEL 3 // PRIVILEGED COUNSEL',
    badge: 'bg-purple-500/10 text-purple-400 border border-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.2)]',
    desc: 'Regulatory clock initialization & discovery-exempt attorney channels.',
  },
  responder: {
    label: 'CLEARANCE LEVEL 2 // FORENSIC TACTICAL',
    badge: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]',
    desc: 'Active IOC logging, scope item classification, and fraud freezing.',
  },
  exec_viewer: {
    label: 'CLEARANCE LEVEL 1 // EXECUTIVE READ-ONLY',
    badge: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/30',
    desc: 'Redacted situational briefs and high-level blast radius monitoring.',
  },
};

// Generates a visual 4-color mini matrix from an Identity hex string
function IdentityGridIcon({ hex }: { hex: string }) {
  const chars = (hex.replace(/[^a-f0-9]/gi, '') + '00000000').slice(0, 16);
  const cells = chars.split('').map((c, i) => {
    const val = parseInt(c, 16);
    const colors = ['bg-zinc-800', 'bg-cyan-500/40', 'bg-indigo-500/60', 'bg-emerald-400/80'];
    return colors[val % colors.length];
  });

  return (
    <div className="grid grid-cols-4 gap-0.5 p-1 rounded bg-black/60 border border-zinc-800 shrink-0">
      {cells.map((cls, idx) => (
        <div key={idx} className={`w-1.5 h-1.5 rounded-[1px] ${cls}`} />
      ))}
    </div>
  );
}

export default function AccessPage() {
  const [users] = useTable(tables.members);
  const me = useMe();

  if (!me) return <JoinScreen usersCount={users.length} />;

  return (
    <section className="space-y-6">
      {/* Top Tactical Terminal Header */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 p-6 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[10px] font-mono tracking-widest text-emerald-400 uppercase">
                Air-Gapped Access Enclave // Online
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white font-mono uppercase">
              Zero-Trust Keyring & Clearance
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              SpacetimeDB cryptographic identity verification & per-view memory isolation.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-black/40 border border-zinc-800/80 rounded-lg p-3 font-mono text-xs">
            <div className="text-center px-2">
              <div className="text-emerald-400 font-bold text-sm">{users.filter(u => u.online).length}</div>
              <div className="text-[10px] text-zinc-500 uppercase">Active Links</div>
            </div>
            <div className="h-6 w-px bg-zinc-800" />
            <div className="text-center px-2">
              <div className="text-indigo-400 font-bold text-sm">{users.length}</div>
              <div className="text-[10px] text-zinc-500 uppercase">Verified Principals</div>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Action: Add New Member */}
      {me.role === 'admin' ? (
        <AddMemberForm />
      ) : (
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-4 text-xs font-mono text-zinc-400 flex items-center justify-between">
          <span>Current Session: <strong className="text-zinc-200">{me.name}</strong></span>
          <span className="text-amber-400/80">Clearance modifications restricted to Root Admin</span>
        </div>
      )}

      {/* Identity Roster Grid */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
            Cryptographic Node Register ({users.length})
          </h2>
          <span className="text-[10px] font-mono text-zinc-500">REALTIME VIEW EVALUATION ACTIVE</span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {users.map(u => (
            <MemberCard key={u.identity.toHexString()} member={u} currentUserRole={me.role} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberCard({ member, currentUserRole }: { member: any; currentUserRole?: string }) {
  const setRole = useReducer(reducers.setRole);
  const run = useRun();
  const hex = member.identity.toHexString();
  const clearance = CLEARANCE_CONFIG[member.role] ?? CLEARANCE_CONFIG.responder;

  const handleRoleChange = (newRole: string) => {
    run(
      setRole({ target: member.identity, role: newRole }),
      `Updated ${member.name}'s clearance to ${ROLE_LABEL[newRole] ?? newRole}`
    );
  };

  return (
    <div className="group relative rounded-lg border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900/70 p-4 transition-all duration-150">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Identity & Visual Grid */}
        <div className="flex items-start gap-3.5">
          <IdentityGridIcon hex={hex} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white font-mono">{member.name}</span>
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded tracking-wider uppercase font-semibold ${clearance.badge}`}>
                {ROLE_LABEL[member.role] ?? member.role}
              </span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  member.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-zinc-700'
                }`}
                title={member.online ? 'Realtime WebSocket Session Established' : 'Offline'}
              />
            </div>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5 flex flex-wrap items-center gap-x-2">
              <span>{member.email}</span>
              <span className="text-zinc-600">|</span>
              <span
                className="cursor-pointer hover:text-cyan-400 transition-colors"
                title="Click to copy 256-bit Principal ID"
                onClick={() => navigator.clipboard?.writeText(hex)}
              >
                ID: {hex.slice(0, 10)}…{hex.slice(-8)} ⧉
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1 italic">{clearance.desc}</p>
          </div>
        </div>

        {/* Clearance Selection */}
        {currentUserRole === 'admin' && (
          <div className="flex items-center gap-2 self-end md:self-center border-t md:border-t-0 border-zinc-800 pt-3 md:pt-0 w-full md:w-auto justify-between">
            <span className="text-[10px] font-mono uppercase text-zinc-500">Tier Control:</span>
            <select
              value={member.role}
              onChange={e => handleRoleChange(e.target.value)}
              className="rounded border border-zinc-700 bg-black px-3 py-1 text-xs font-mono text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              {ROLES.map(r => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinScreen({ usersCount }: { usersCount: number }) {
  const { identity } = useSpacetimeDB();
  const bootstrap = useReducer(reducers.bootstrapAdmin);
  const run = useRun();
  const hex = identity?.toHexString() ?? '';

  const handleBootstrap = () => {
    run(bootstrap({ name: 'ancca', email: 'annie@bank.com' }), 'Root Sovereign Clearance Claimed');
  };

  return (
    <section className="mx-auto max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-block p-3 rounded-full bg-cyan-950/40 border border-cyan-800/40 text-cyan-400 font-mono text-xl">
          ⬡
        </div>
        <h1 className="text-xl font-black uppercase tracking-tight text-white font-mono">
          Cryptographic Access Gate
        </h1>
        <p className="text-xs text-zinc-400">
          Zero-trust access policy enforced. All database tables are private and require an authorized principal key.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Your Cryptographic Principal ID
        </label>
        <div className="flex items-center gap-2 bg-black border border-zinc-800 p-2.5 rounded-lg">
          <IdentityGridIcon hex={hex} />
          <input
            readOnly
            value={hex}
            onFocus={e => e.target.select()}
            className="w-full bg-transparent font-mono text-xs text-cyan-300 focus:outline-none select-all"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(hex)}
          disabled={!hex}
          className="w-full rounded bg-zinc-800 py-2.5 text-xs font-mono font-semibold text-white hover:bg-zinc-700 transition-colors"
        >
          Copy Principal Key
        </button>

        {usersCount === 0 && (
          <button
            type="button"
            onClick={handleBootstrap}
            className="w-full rounded bg-emerald-600 py-2.5 text-xs font-mono font-bold uppercase tracking-wider text-white hover:bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all"
          >
            Claim Root Authority (1st Operator)
          </button>
        )}
      </div>

      <p className="text-[11px] text-center text-zinc-500 font-mono">
        Pass this principal key out-of-band to an incident commander to initialize clearance.
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
      setError('Invalid principal encoding: 64-character 256-bit hexadecimal string required.');
      return;
    }
    setError('');
    run(addMember({ target, name: form.name, email: form.email, role: form.role }), `${form.name} authorized`);
    setForm({ id: '', name: '', email: '', role: 'responder' });
  };

  return (
    <form className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-5 space-y-4" onSubmit={submit}>
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
        <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
          Provision Security Clearance
        </h2>
        <span className="text-[10px] font-mono text-cyan-400">REDUCER: add_member</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Target Identity (64-char Hex)</label>
          <input
            required
            value={form.id}
            placeholder="c200475fbe99c6910f6ee0efcda04b2cbde2150d48ff847c5e6c8e61bbbc575f"
            onChange={e => setForm({ ...form, id: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Operator Call-Sign / Name</label>
          <input
            required
            value={form.name}
            placeholder="Agent Vance"
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Corporate Relay Email</label>
          <input
            required
            type="email"
            value={form.email}
            placeholder="vance@bank.com"
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Assigned Enclave Tier</label>
          <select
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-black px-3 py-2 text-xs font-mono text-zinc-300 focus:border-cyan-500 focus:outline-none"
          >
            {ROLES.map(r => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded bg-cyan-600 hover:bg-cyan-500 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)]"
          >
            Authorize Principal
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 font-mono mt-1">{error}</p>}
    </form>
  );
}
