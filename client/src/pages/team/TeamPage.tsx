// Lane A owner: join screen, add members by ID, roles, security events (audit log).
import { useState, useMemo, type FormEvent } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';
import { Copy, Check, ShieldCheck, UserPlus } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { ROLES, ROLE_LABEL, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* -------------------------------------------------------------------------- */
/* Cryptographic Identity Chip Component                                      */
/* -------------------------------------------------------------------------- */

interface IdentityChipCardProps {
  identityHex: string;
  name?: string;
  role?: string;
}

export function IdentityChipCard({ identityHex, name, role }: IdentityChipCardProps) {
  const [copied, setCopied] = useState(false);

  // Deterministically compute an 8x8 boolean matrix (64 bits) from the hex identity string
  const grid = useMemo(() => {
    const raw = identityHex.replace(/^0x/, '').padEnd(64, '0');
    const bits: boolean[] = [];
    for (let i = 0; i < 64; i++) {
      const val = parseInt(raw[i] || '0', 16);
      bits.push(val % 2 === 1);
    }
    return bits;
  }, [identityHex]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(identityHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedShortId = identityHex.length > 18
    ? `${identityHex.slice(0, 10)}...${identityHex.slice(-6)}`
    : identityHex;

  return (
    <div className="border border-border bg-card p-4 font-mono text-xs">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b border-border pb-2.5 mb-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-neon" />
          <span className="font-heading uppercase tracking-widest text-white text-xs font-bold">
            Operator Clearance Badge
          </span>
        </div>
        <span className="border border-border bg-black/60 px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wider">
          Asymmetric WASM Identity
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* 8x8 Hardware Silicon Microchip Visualization */}
        <div className="shrink-0 p-1 bg-black border border-border">
          <div className="grid grid-cols-8 gap-[1px] w-16 h-16 bg-zinc-950">
            {grid.map((active, idx) => (
              <div
                key={idx}
                className={active ? 'bg-neon' : 'bg-black'}
                title={`Bit ${idx}: ${active ? '1' : '0'}`}
              />
            ))}
          </div>
        </div>

        {/* Tactical Key Telemetry */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Operator:</span>
            <span className="text-white font-bold tracking-wider truncate">{name || 'PENDING ADMISSION'}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Clearance:</span>
            <span className="text-neon uppercase font-bold tracking-wider">
              {role ? (ROLE_LABEL[role] ?? role).toUpperCase() : 'UNAUTHENTICATED GUEST'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Key ID:</span>
            <span className="text-zinc-400 font-mono text-[11px] truncate" title={identityHex}>
              {formattedShortId}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/40 text-[10px]">
            <span className="text-muted-foreground uppercase tracking-wider">Auth Engine:</span>
            <span className="text-zinc-500 font-mono tracking-tight">ASYMMETRIC KEYPAIR // WASM BOUND</span>
          </div>
        </div>

        {/* Tactical Action Button */}
        <div className="shrink-0 self-stretch sm:self-auto flex items-end">
          <button
            type="button"
            onClick={handleCopy}
            className="w-full sm:w-auto flex items-center justify-center gap-2 border border-neon bg-neon/10 px-3.5 py-2 text-neon text-xs font-mono uppercase tracking-wider hover:bg-neon hover:text-black transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-neon" />
                <span>COPIED // ZERO SECRETS STORED</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>COPY RAW KEY</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unauthenticated Join Screen                                               */
/* -------------------------------------------------------------------------- */

export function JoinScreen() {
  const { identity } = useSpacetimeDB();
  const identityHex = identity ? identity.toHexString() : '';

  return (
    <div className="mx-auto max-w-xl space-y-6 pt-12">
      <div className="border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-white">
            Air-Gapped Access Gateway
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Access to this incident panic room requires cryptographic identity whitelisting by an active Incident Lead or Admin.
          </p>
        </div>

        {identityHex && (
          <IdentityChipCard identityHex={identityHex} role="Pending Admission" />
        )}

        <div className="text-[11px] text-zinc-500 font-mono border-t border-border/40 pt-3">
          Provide your public Key ID above to an administrator out-of-band (via encrypted signal or physical verification) to be provisioned.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Authenticated Team Page                                                    */
/* -------------------------------------------------------------------------- */

export default function TeamPage() {
  const { identity } = useSpacetimeDB();
  const [members] = useTable(tables.members);
  const [auditLogs] = useTable(tables.auditEntries);
  const me = useMe();
  const run = useRun();

  const addMemberCall = useReducer(reducers.addMember);
  const setRoleCall = useReducer(reducers.setRole);

  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('responder');

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!newId || !newName || !newEmail) return;

    try {
      const cleanHex = newId.trim().replace(/^0x/, '');
      const parsedIdentity = Identity.fromString(cleanHex);
      run(addMemberCall({ target: parsedIdentity, name: newName.trim(), email: newEmail.trim(), role: newRole }), `${newName.trim()} added`);
      setNewId('');
      setNewName('');
      setNewEmail('');
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleRoleChange = async (memberIdentity: Identity, role: string) => {
    run(setRoleCall({ target: memberIdentity, role }), 'Role updated');
  };

  const removeMemberCall = useReducer(reducers.removeMember);
  const handleRemove = (memberIdentity: Identity, name: string) => {
    if (!window.confirm(`Remove ${name}? They lose access immediately. Use this if their device may be compromised.`)) return;
    run(removeMemberCall({ target: memberIdentity }), `${name} removed`);
  };

  return (
    <div className="space-y-6">
      {/* Operator Credential Card */}
      {identity && (
        <IdentityChipCard
          identityHex={identity.toHexString()}
          name={me?.name}
          role={me?.role}
        />
      )}

      {/* Add Member Form (Admin Only) */}
      {me?.role === 'admin' && (
        <div className="border border-border bg-card p-4 space-y-4 font-mono text-xs">
          <div className="flex items-center gap-2 border-b border-border pb-2.5">
            <UserPlus className="size-4 text-neon" />
            <h3 className="font-heading uppercase tracking-wider text-white text-xs font-bold">
              Provision Zero-Trust Operator
            </h3>
          </div>

          <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              placeholder="0x Identity Hex"
              value={newId}
              onChange={e => setNewId(e.target.value)}
              className="font-mono text-xs bg-black/40 border-border"
              required
            />
            <Input
              placeholder="Operator Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="font-mono text-xs bg-black/40 border-border"
              required
            />
            <Input
              placeholder="Corporate Email"
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="font-mono text-xs bg-black/40 border-border"
              required
            />
            <div className="flex gap-2">
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className="flex-1 bg-black/60 border border-border px-2 text-xs text-white font-mono"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" className="border-neon text-neon hover:bg-neon hover:text-black">
                Add
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Roster Table */}
      <div className="border border-border bg-card p-4 space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="font-heading uppercase tracking-wider text-white text-xs font-bold">
            Active Roster ({members.length})
          </h3>
        </div>

        <div className="divide-y divide-border">
          {members.map(m => (
            <div key={m.identity.toHexString()} className="py-2.5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={m.online ? 'text-ok' : 'text-zinc-600'}>●</span>
                  <span className="font-bold text-white">{m.name}</span>
                  <span className="text-zinc-500">({m.email})</span>
                </div>
                <div className="text-[11px] text-zinc-500 truncate max-w-sm">
                  {m.identity.toHexString()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {me?.role === 'admin' ? (
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.identity, e.target.value)}
                    className="bg-black/60 border border-border px-2 py-1 text-xs text-neon font-mono"
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r] ?? r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="border border-border px-2 py-0.5 text-zinc-400">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                )}
                {me?.role === 'admin' && !(identity && m.identity.isEqual(identity)) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-magenta/60 text-magenta hover:text-magenta"
                    onClick={() => handleRemove(m.identity, m.name)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AuditLog entries={auditLogs} names={new Map(members.map(m => [m.identity.toHexString(), m.name]))} />
    </div>
  );
}

/** Security events: the append-only audit log (admins and executives). Nothing in the app can edit or delete it. */
function AuditLog({ entries, names }: { entries: readonly { id: bigint; at: { toDate(): Date }; actor: Identity; action: string; detail: string }[]; names: Map<string, string> }) {
  const [action, setAction] = useState('');
  const actions = useMemo(() => [...new Set(entries.map(e => e.action))].sort(), [entries]);
  const shown = [...entries].filter(e => !action || e.action === action).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 100);
  return (
    <div className="border border-border bg-card p-4 space-y-3 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <h3 className="font-heading uppercase tracking-wider text-white text-xs font-bold">Security events ({entries.length})</h3>
        <label className="flex items-center gap-2 text-zinc-400">
          Action
          <select value={action} onChange={e => setAction(e.target.value)} className="bg-black/60 border border-border px-2 py-1 text-xs text-white font-mono">
            <option value="">All</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <p className="text-zinc-500">Append-only: every security-relevant action, who did it and when. No one in the app can edit or delete these.</p>
      {shown.length === 0 ? (
        <p className="text-zinc-500 italic">No events yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map(e => (
            <li key={e.id.toString()} className="flex flex-wrap gap-x-3 py-1.5">
              <time className="text-zinc-500">{e.at.toDate().toLocaleString()}</time>
              <span className="text-white">{names.get(e.actor.toHexString()) ?? 'System (drill, autopilot, timers)'}</span>
              <span className="text-neon">{e.action}</span>
              <span className="min-w-0 flex-1 break-words text-zinc-300">{e.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
