// After-action summary: how the incident went, computed from data the app already records (no backend needed).
import { useTable } from 'spacetimedb/react';
import { tables } from '@/module_bindings';
import { useNotices } from '@/components/NotifyPriorityChart';
import { PHASES, PHASE_LABEL, SEE_ALL, SEE_RECORDS, can, useMe } from '@/components/shared';

type Incident = { id: bigint; detectedAt: { toDate(): Date }; phase: string; title: string };

const dur = (ms: number) => {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const money = (cents: bigint) => `$${(cents / 100n).toLocaleString()}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function AfterActionSummary({ incident }: { incident: Incident }) {
  const [events] = useTable(tables.timelineEvents);
  const [scope] = useTable(tables.scopeItems);
  const [alerts] = useTable(tables.fraudAlerts);
  const [clocks] = useTable(tables.legalClocks);
  const [tasks] = useTable(tables.tasks);
  const [statuses] = useTable(tables.notifyStatuses);
  const [members] = useTable(tables.members);
  const notices = useNotices(incident.id);
  const me = useMe();
  const money$ = can(me, SEE_ALL), records$ = can(me, SEE_RECORDS); // need to know: same split as the server views
  const id = incident.id;
  const now = Date.now();

  // Phase timing from the recorded phase changes ("detect -> analyze"); the current phase runs until now.
  const start = incident.detectedAt.toDate().getTime();
  const evs = events.filter(e => e.incidentId === id).sort((a, b) => (a.id < b.id ? -1 : 1));
  const entered = new Map<string, number>([['detect', start]]);
  for (const e of evs)
    if (e.kind === 'phase_change') {
      const to = e.text.split(' -> ')[1];
      if (to && !entered.has(to)) entered.set(to, e.at.toDate().getTime());
    }
  const reached = PHASES.filter(p => entered.has(p));
  const phaseMs = reached.map((p, i) => {
    const from = entered.get(p)!;
    const to = i + 1 < reached.length ? entered.get(reached[i + 1])! : p === incident.phase && p !== 'post_incident' ? now : from;
    return { phase: p, ms: Math.max(0, to - from) };
  });
  const endMs = entered.get('post_incident') ?? now;
  const containMs = entered.has('contain') ? entered.get('contain')! - start : null;
  const maxMs = Math.max(1, ...phaseMs.map(p => p.ms));

  // Damage
  const items = scope.filter(s => s.incidentId === id);
  const records = (st: string) => items.filter(s => s.status === st).reduce((n, s) => n + s.recordsCount, 0n);
  const systems = items.filter(s => s.assetType === 'system' && s.status !== 'clear').length;

  // Fraud: frozen by a person = a team member clicked Freeze (timeline "Fraud alert <id> on <acct>: frozen");
  // everything else was frozen by the system (Contain rule or autopilot).
  const fa = alerts.filter(a => a.incidentId === id);
  const people = new Set(members.map(m => m.identity.toHexString()));
  const byPerson = (e: (typeof events)[number]) => people.has(e.actor.toHexString());
  const frozenAll = fa.filter(a => a.status === 'frozen');
  const humanFrozen = frozenAll.filter(a => events.some(e => e.incidentId === id && byPerson(e) && e.text.startsWith(`Fraud alert ${a.id} on `) && e.text.endsWith(': frozen')));
  const autoFrozen = frozenAll.filter(a => !humanFrozen.includes(a));
  const frozenCents = frozenAll.reduce((n, a) => n + a.amountCents, 0n);

  // Legal: a notice counts as on time if it was marked sent before its deadline
  const sentAt = new Map(statuses.filter(s => s.incidentId === id && s.status === 'sent').map(s => [s.notice, s.updatedAt.toDate().getTime()]));
  const sent = notices.filter(n => n.status === 'sent');
  const onTime = sent.filter(n => !n.due || (sentAt.get(n.id) ?? 0) <= n.due.getTime()).length;
  const overdue = notices.filter(n => n.status !== 'sent' && n.due && n.due.getTime() < now).length;
  const ic = clocks.filter(c => c.incidentId === id);

  // Who did the work
  // A person = a team member's identity; the drill, autopilot and timers act as the database itself.
  const advisorCount = evs.filter(e => e.text.startsWith('Advisor suggestion confirmed')).length;
  const humanCount = evs.filter(e => byPerson(e) && e.kind !== 'auto' && !e.text.startsWith('Advisor suggestion confirmed')).length;
  const autoCount = evs.filter(e => !byPerson(e) || e.kind === 'auto').length;
  const it = tasks.filter(t => t.incidentId === id);
  const done = incident.phase === 'post_incident';

  return (
    <section className="glass flex flex-col gap-4 p-5" aria-label="After-action summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm tracking-[0.2em] uppercase">After-action summary</h2>
        <span className="text-xs text-muted-foreground">{done ? 'Incident complete' : 'In progress: numbers update live'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Total time" value={dur(endMs - start)} sub={`${reached.length} of ${PHASES.length} phases`} />
        <Tile label="Time to contain" value={containMs == null ? 'Not yet' : dur(containMs)} sub="detected to Contain" />
        {records$ ? <Tile label="Records stolen" value={records('exfiltrated').toLocaleString()} sub={`${systems} systems hit`} /> : <Tile label="Systems hit" value={String(systems)} />}
        {money$ && <Tile label="Money frozen" value={money(frozenCents)} sub={`${autoFrozen.length} auto, ${humanFrozen.length} by a person`} />}
        {records$ && <Tile label="Notices sent" value={`${sent.length} / ${notices.length}`} sub={`${onTime} on time${overdue ? `, ${overdue} overdue` : ''}`} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Time per phase: one hue, phase order, value printed past the bar end */}
        <div>
          <h3 className="mb-2 font-mono text-xs tracking-wider text-muted-foreground uppercase">Time per phase</h3>
          <ul className="space-y-2" aria-label="Time spent in each phase">
            {phaseMs.map(p => (
              <li key={p.phase} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
                <span className="truncate text-muted-foreground">{PHASE_LABEL[p.phase] ?? p.phase}</span>
                <span className="flex items-center gap-2">
                  <span className="h-4 rounded-r bg-primary" style={{ width: `${Math.max(2, (p.ms / maxMs) * 80)}%` }} aria-hidden="true" />
                  <span className="font-mono text-xs tabular-nums">{p.phase === 'post_incident' && done ? 'reached' : dur(p.ms)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {records$ && (
            <>
              <dt className="text-muted-foreground">Locked by ransomware</dt>
              <dd className="font-mono tabular-nums">{records('encrypted').toLocaleString()} records</dd>
              <dt className="text-muted-foreground">Seen by attacker</dt>
              <dd className="font-mono tabular-nums">{records('accessed').toLocaleString()} records</dd>
            </>
          )}
          {money$ && (
            <>
              <dt className="text-muted-foreground">Fraud alerts</dt>
              <dd className="font-mono tabular-nums">
                {fa.length} total · {fa.filter(a => a.status === 'dismissed').length} dismissed · {fa.filter(a => a.status === 'open').length} open
              </dd>
            </>
          )}
          {records$ && (
            <>
              <dt className="text-muted-foreground">Legal deadlines</dt>
              <dd className="font-mono tabular-nums">{ic.filter(c => c.done).length} of {ic.length} filed</dd>
            </>
          )}
          <dt className="text-muted-foreground">Tasks</dt>
          <dd className="font-mono tabular-nums">{it.filter(t => t.done).length} of {it.length} done</dd>
          <dt className="text-muted-foreground">Who did the work</dt>
          <dd className="font-mono tabular-nums">{autoCount} automatic · {humanCount} by people · {advisorCount} advisor-confirmed</dd>
        </dl>
      </div>
    </section>
  );
}
