// Overview: the incident as a clean, calm dashboard. One hero card (where we are and the one next move), a few big
// numbers, then simple cards. Every number comes from the role-filtered views, so a tile your role may not see says so.
import { useEffect, useState, type ReactNode } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { Bot, Clock, Lock, Radar, ShieldAlert, Snowflake, ThumbsUp, Users, Wallet, Zap } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { LEADS, PHASES, PHASE_LABEL, SEE_ALL, SEE_RECORDS, can, useCurrentIncident, useMe } from '@/components/shared';
import AfterActionSummary from '@/components/AfterActionSummary';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AutoAdvanceBanner, Tasks } from './IncidentPage';

type Incident = NonNullable<ReturnType<typeof useCurrentIncident>>;

const money = (cents: bigint) => `$${(cents / 100n).toLocaleString()}`;
const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)} days`;
};
const left = (ms: number) => {
  if (ms <= 0) return 'Overdue';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m % 60}m`;
};

function Card({ title, icon, action, className, children }: { title?: string; icon?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-card/80 p-5 backdrop-blur', className)}>
      {title && (
        <header className="flex items-center gap-2">
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {action && <span className="ml-auto">{action}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

function Stat({ label, icon, value, sub, hidden, tone }: { label: string; icon: ReactNode; value: string; sub?: string; hidden?: boolean; tone?: 'warn' | 'ok' }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
        {icon} {label}
      </div>
      {hidden ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" /> Not shared with your role
        </div>
      ) : (
        <div>
          <div className={cn('text-3xl font-semibold tabular-nums tracking-tight text-white', tone === 'warn' && 'text-amber-300', tone === 'ok' && 'text-emerald-300')}>{value}</div>
          {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
        </div>
      )}
    </Card>
  );
}

export default function OverviewView({ incident }: { incident: Incident }) {
  const me = useMe();
  const [scope] = useTable(tables.scopeItems);
  const [alerts] = useTable(tables.fraudAlerts);
  const [clocks] = useTable(tables.legalClocks);
  const [states] = useTable(tables.stateImpacts);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const id = incident.id;
  const seeAll = can(me, SEE_ALL), seeRecords = can(me, SEE_RECORDS);
  const stolen = scope.filter(s => s.incidentId === id && s.status === 'exfiltrated').reduce((n, s) => n + s.recordsCount, 0n);
  const mine = alerts.filter(a => a.incidentId === id);
  const frozen = mine.filter(a => a.status === 'frozen').reduce((n, a) => n + a.amountCents, 0n);
  const openAlerts = mine.filter(a => a.status === 'open');
  const atRisk = openAlerts.reduce((n, a) => n + a.amountCents, 0n);
  const due = clocks.filter(c => c.incidentId === id && !c.done).sort((a, b) => a.deadlineAt.toDate().getTime() - b.deadlineAt.toDate().getTime());
  const next = due[0];
  const stateCount = states.filter(s => s.incidentId === id && s.records > 0n).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-4">
        <Hero incident={incident} />
        <Stat label="People affected" icon={<Users />} hidden={!seeRecords} value={stolen.toLocaleString()} sub={stateCount ? `across ${stateCount} states` : 'records marked stolen'} />
        <Stat label="Money frozen" icon={<Snowflake />} hidden={!seeAll} value={money(frozen)} sub={atRisk ? `${money(atRisk)} still waiting on a decision` : 'nothing waiting'} tone={frozen ? 'ok' : undefined} />
        <Stat
          label="Next deadline"
          icon={<Clock />}
          hidden={!seeRecords}
          value={next ? left(next.deadlineAt.toDate().getTime() - Date.now()) : 'None yet'}
          sub={next ? next.label : 'Clocks start when data is marked stolen'}
          tone={next && next.deadlineAt.toDate().getTime() - Date.now() < 24 * 3_600_000 ? 'warn' : undefined}
        />
        <Stat label="Fraud alerts open" icon={<ShieldAlert />} hidden={!seeAll} value={String(openAlerts.length)} sub={`${mine.length} flagged in total`} tone={openAlerts.length ? 'warn' : undefined} />
      </div>

      {incident.phase === 'post_incident' && <AfterActionSummary incident={incident} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <StatesCard incidentId={id} hidden={!seeRecords} />
        <DeadlinesCard incidentId={id} hidden={!seeRecords} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 [&>section]:rounded-2xl [&>section]:border-white/[0.06] [&>section]:bg-card/80">
          <Tasks incidentId={id} phase={incident.phase} onlyPhase />
        </div>
        <ActivityCard incidentId={id} />
      </div>

      {seeAll && openAlerts.length > 0 && <FraudCard incidentId={id} />}
    </div>
  );
}

/** Where we are, how long it has been, and the one move that matters. */
function Hero({ incident }: { incident: Incident }) {
  const me = useMe();
  const setPhase = useReducer(reducers.setPhase);
  const run = useRun();
  const idx = PHASES.indexOf(incident.phase as (typeof PHASES)[number]);
  const next = PHASES[idx + 1];
  const since = Date.now() - incident.detectedAt.toDate().getTime();
  return (
    <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/15 via-card/80 to-violet-500/10 p-6 lg:col-span-2 lg:row-span-2">
      <div>
        <div className="text-sm text-muted-foreground">Current phase · step {idx + 1} of {PHASES.length}</div>
        <div className="mt-1 text-5xl font-semibold tracking-tight text-white">{PHASE_LABEL[incident.phase] ?? incident.phase}</div>
        <div className="mt-2 text-sm text-muted-foreground">Detected {ago(since)} ago · severity {incident.severity}</div>
      </div>
      <div className="flex gap-1.5" aria-label="Phase progress">
        {PHASES.map((p, i) => (
          <div key={p} className="flex-1" title={PHASE_LABEL[p]}>
            <div className={cn('h-1.5 rounded-full', i < idx ? 'bg-emerald-400' : i === idx ? 'bg-sky-400' : 'bg-white/10')} />
            <div className={cn('mt-1.5 hidden truncate text-[11px] sm:block', i === idx ? 'text-sky-200' : 'text-muted-foreground')}>{PHASE_LABEL[p]}</div>
          </div>
        ))}
      </div>
      <AutoAdvanceBanner incidentId={incident.id} />
      {next && can(me, LEADS) && (
        <Button size="lg" className="self-start rounded-full bg-sky-500 px-6 font-semibold text-white hover:bg-sky-400" onClick={() => run(setPhase({ incidentId: incident.id, phase: next }), `Phase: ${PHASE_LABEL[next]}`)}>
          Move to {PHASE_LABEL[next]} →
        </Button>
      )}
    </section>
  );
}

function StatesCard({ incidentId, hidden }: { incidentId: bigint; hidden: boolean }) {
  const [states] = useTable(tables.stateImpacts);
  const rows = states.filter(s => s.incidentId === incidentId && s.records > 0n).sort((a, b) => Number(b.records - a.records));
  const max = rows[0]?.records ?? 1n;
  return (
    <Card title="Who's affected, by state" icon={<Users />} className="lg:col-span-2">
      {hidden ? (
        <p className="text-sm text-muted-foreground">Shared with leads, legal and executives only.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No customers counted yet. Import from Nessie or mark data stolen to see this.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.slice(0, 7).map(s => (
            <li key={s.state} className="grid grid-cols-[2.5rem_1fr_4.5rem] items-center gap-3 text-sm" title={`${s.state}: ${s.records.toLocaleString()} people`}>
              <span className="font-medium text-foreground">{s.state}</span>
              <span className="h-2.5 rounded-full bg-white/[0.06]">
                <span className="block h-2.5 rounded-full bg-sky-400" style={{ width: `${Math.max(3, Number((s.records * 100n) / max))}%` }} />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">{s.records.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeadlinesCard({ incidentId, hidden }: { incidentId: bigint; hidden: boolean }) {
  const [clocks] = useTable(tables.legalClocks);
  const rows = clocks.filter(c => c.incidentId === incidentId).sort((a, b) => Number(a.done) - Number(b.done) || a.deadlineAt.toDate().getTime() - b.deadlineAt.toDate().getTime());
  return (
    <Card title="Deadlines" icon={<Clock />}>
      {hidden ? (
        <p className="text-sm text-muted-foreground">Shared with leads, legal and executives only.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clocks running yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-white/[0.06]">
          {rows.slice(0, 5).map(c => {
            const ms = c.deadlineAt.toDate().getTime() - Date.now();
            return (
              <li key={`${c.id}`} className="flex items-baseline gap-3 py-2 text-sm first:pt-0">
                <span className={cn('min-w-0 flex-1 truncate', c.done ? 'text-muted-foreground line-through' : 'text-foreground')}>{c.label}</span>
                <span className={cn('shrink-0 tabular-nums', c.done ? 'text-emerald-300' : ms < 24 * 3_600_000 ? 'text-amber-300' : 'text-muted-foreground')}>{c.done ? 'Filed' : left(ms)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ActivityCard({ incidentId }: { incidentId: bigint }) {
  const [events] = useTable(tables.timelineEvents);
  const [messages] = useTable(tables.messages);
  const [channels] = useTable(tables.channels);
  const mine = new Set(channels.filter(c => c.incidentId === incidentId).map(c => c.id));
  const brief = messages.filter(m => mine.has(m.channelId) && m.text.startsWith('🤖')).sort((a, b) => Number(b.id - a.id))[0];
  const recent = events.filter(e => e.incidentId === incidentId).sort((a, b) => Number(b.id - a.id)).slice(0, 6);
  return (
    <Card title="Latest" icon={<Radar />}>
      {brief && (
        <div className="rounded-xl bg-violet-500/10 p-3 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-violet-200">
            <Bot className="size-3.5" aria-hidden="true" /> {brief.text.split('\n')[0].replace(/^🤖 /, '').replace(/:$/, '')}
          </div>
          <p className="line-clamp-4 whitespace-pre-line text-foreground/85">{brief.text.split('\n').slice(1).join('\n').replace(/\s*\[[A-Z]\d*(?:,\s*[A-Z]\d*)*\]/g, '')}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2.5 text-sm">
        {recent.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
        {recent.map(e => (
          <li key={`${e.id}`} className="flex gap-2.5">
            <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', e.kind === 'ioc' ? 'bg-rose-400' : e.kind === 'auto' ? 'bg-emerald-400' : 'bg-sky-400')} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-foreground/90">{e.text.replace(' -> ', ' → ')}</span>
              <span className="text-xs text-muted-foreground">{e.at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{e.kind === 'auto' && ' · automatic'}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FraudCard({ incidentId }: { incidentId: bigint }) {
  const me = useMe();
  const [alerts] = useTable(tables.fraudAlerts);
  const setFraudAlertStatus = useReducer(reducers.setFraudAlertStatus);
  const run = useRun();
  const open = alerts.filter(a => a.incidentId === incidentId && a.status === 'open').sort((a, b) => Number(b.amountCents - a.amountCents));
  const decide = (alertId: bigint, account: string, status: 'frozen' | 'dismissed') =>
    window.confirm(`${status === 'frozen' ? 'Freeze account' : 'Mark as fine'}: ${account}?`) && run(setFraudAlertStatus({ alertId, status }), status === 'frozen' ? `Froze ${account}` : `${account} marked as fine`);
  return (
    <Card title="Fraud waiting on a decision" icon={<Wallet />} action={<span className="text-xs text-muted-foreground">$10,000+ freezes automatically from Contain</span>}>
      <ul className="grid gap-3 md:grid-cols-2">
        {open.map(a => (
          <li key={`${a.id}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] p-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold tabular-nums text-white">{money(a.amountCents)}</div>
              <div className="truncate text-xs text-muted-foreground">
                {a.accountRef} · {a.reason}
              </div>
            </div>
            {can(me, LEADS) && (
              <span className="flex gap-2">
                <Button size="sm" variant="destructive" className="rounded-full" onClick={() => decide(a.id, a.accountRef, 'frozen')}>
                  <Zap /> Freeze
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => decide(a.id, a.accountRef, 'dismissed')}>
                  <ThumbsUp /> Fine
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
