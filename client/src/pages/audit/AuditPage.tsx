// Lane A: Immutable Compliance Ledger & Cryptographic Proof
import { useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../../module_bindings';
import { useMe } from '../../components/shared';

export default function AuditPage() {
  const [entries] = useTable(tables.auditEntries);
  const me = useMe();
  const [filterAction, setFilterAction] = useState<string>('all');

  if (me?.role !== 'admin') {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-8 text-center space-y-2">
        <div className="text-red-400 text-lg font-mono">⧈ CLEARANCE EXCEEDED</div>
        <h2 className="text-sm font-bold text-white uppercase font-mono">Restricted Forensic Vault</h2>
        <p className="text-xs text-zinc-400 max-w-md mx-auto">
          The SpacetimeDB view engine filtered this table to zero rows. Inspecting the immutable audit ledger requires root administrative clearance.
        </p>
      </div>
    );
  }

  const sorted = [...entries].sort((a, b) => Number(b.at.microsSinceUnixEpoch - a.at.microsSinceUnixEpoch));
  const filtered = filterAction === 'all' ? sorted : sorted.filter(e => e.action === filterAction);
  const uniqueActions = ['all', ...Array.from(new Set(entries.map(e => e.action)))];

  return (
    <section className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[10px] font-mono tracking-widest text-cyan-400 uppercase">
              SOX & SEC 8-K Regulatory Evidence Trail
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white font-mono uppercase mt-0.5">
            Immutable Audit Ledger
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-400">Filter Event:</span>
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="rounded border border-zinc-800 bg-black px-3 py-1 text-xs font-mono text-cyan-300"
          >
            {uniqueActions.map(act => (
              <option key={act} value={act}>{act}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Ledger Container */}
      <div className="rounded-xl border border-zinc-800 bg-black/60 overflow-hidden shadow-2xl font-mono text-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-3 px-4">Ledger ID</th>
                <th className="py-3 px-4">Timestamp (UTC)</th>
                <th className="py-3 px-4">Event Kind</th>
                <th className="py-3 px-4">Actor Principal</th>
                <th className="py-3 px-4">Cryptographic Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-600">
                    No state-mutating events recorded in memory.
                  </td>
                </tr>
              ) : (
                filtered.map(row => {
                  const date = new Date(Number(row.at.microsSinceUnixEpoch / 1000n));
                  const actorHex = row.actor.toHexString();
                  return (
                    <tr key={String(row.id)} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="py-2.5 px-4 text-zinc-600">#{String(row.id).padStart(4, '0')}</td>
                      <td className="py-2.5 px-4 text-zinc-400 whitespace-nowrap">
                        {date.toISOString().replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-zinc-700/50">
                          {row.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-zinc-400" title={actorHex}>
                        <span className="hover:text-white cursor-pointer">
                          {actorHex.slice(0, 8)}…{actorHex.slice(-6)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-zinc-200">{row.detail}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
