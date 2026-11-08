// Lane B owner: the whole incident on one screen: declare, phase, record, tasks, what was hit, fraud decisions.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Identity } from 'spacetimedb';
import { useReducer, useTable } from 'spacetimedb/react';
import { BarChart3, Check, CircleHelp, Download, Eye, Lock, Play, Radar, ShieldCheck, Snowflake, Square, ThumbsUp, UserCheck, Zap, type LucideIcon } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import AfterActionSummary from '@/components/AfterActionSummary';
import { LEADS, PHASES, PHASE_LABEL, SCOPE_LABEL, SCOPE_STATUSES, SEVERITIES, SIGNOFF_TASKS, SeverityChip, WRITERS, can, incidentCode, useCurrentIncident, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const KIND_LABEL: Record<string, string> = { ransomware: 'Ransomware', phishing: 'Phishing', data_theft: 'Data theft', other: 'Other' };
const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, ' ');
const SEV_ITEMS = Object.fromEntries(SEVERITIES.map(s => [s, s[0].toUpperCase() + s.slice(1)]));
const ASSET_TYPES: Record<string, string> = { system: 'System', customer: 'Customer', account: 'Account' };

// Icon + color per status so it reads without color too.
const SCOPE_STYLE: Record<string, { Icon: LucideIcon; cls: string }> = {
  encrypted: { Icon: Lock, cls: 'text-sev-critical border-sev-critical/60' },
  exfiltrated: { Icon: Download, cls: 'text-magenta border-magenta/60' },
  accessed: { Icon: Eye, cls: 'text-sev-high border-sev-high/60' },
  unknown: { Icon: CircleHelp, cls: 'text-sev-medium border-sev-medium/60' },
  clear: { Icon: ShieldCheck, cls: 'text-ok border-ok/60' },
};

// Common bank systems to pick from in "What was hit" (fills name, hostname and a typical record count).
const PRESETS: Record<string, { label: string; ref: string; type: string; records: number }> = {
  core: { label: 'Core banking database', ref: 'core-db-01', type: 'system', records: 48_000 },
  olb: { label: 'Online banking login server', ref: 'olb-web-02', type: 'system', records: 3_200 },
  cards: { label: 'Card processing system', ref: 'card-proc-01', type: 'system', records: 22_000 },
  atm: { label: 'ATM network controller', ref: 'atm-ctl-01', type: 'system', records: 0 },
  ad: { label: 'Active Directory (staff logins)', ref: 'dc-01', type: 'system', records: 850 },
  mail: { label: 'Staff email server', ref: 'mail-01', type: 'system', records: 0 },
  dw: { label: 'Customer data warehouse', ref: 'dw-cust-01', type: 'system', records: 60_000 },
  backup: { label: 'Backup server', ref: 'backup-01', type: 'system', records: 0 },
  pii: { label: 'Customer PII export', ref: 's3://exports', type: 'system', records: 12_500 },
};
const PRESET_ITEMS = Object.fromEntries([['', 'Choose a common system…'], ...Object.entries(PRESETS).map(([k, p]) => [k, p.label])]);

const money = (cents: bigint) => `$${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, '0')}`;

export default function IncidentPage() {
  const incident = useCurrentIncident();
  const [showSummary, setShowSummary] = useState(false);
  if (!incident) return <DeclareForm />;
  const summary = incident.phase === 'post_incident' || showSummary;
  // Sections appear as the incident moves on, so each phase only shows what it needs.
  const at = PHASES.indexOf(incident.phase as (typeof PHASES)[number]);
  const reached = (p: (typeof PHASES)[number]) => at >= PHASES.indexOf(p);
  const upcoming = ([['analyze', 'What was hit'], ['contain', 'Fraud decisions']] as const).filter(([p]) => !reached(p));
  return (
    <div className="flex flex-col gap-6">
      <section className="glass flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-[0.3em] text-magenta uppercase">Active incident</p>
            <h1 className="text-2xl font-bold break-words text-white sm:text-3xl">{incident.title}</h1>
          </div>
          <span className="flex flex-wrap gap-2">
            <DrillControls />
            {incident.phase !== 'post_incident' && (
              <Button type="button" variant="outline" aria-pressed={showSummary} onClick={() => setShowSummary(v => !v)}>
                <BarChart3 /> {showSummary ? 'Hide summary' : 'Summary'}
              </Button>
            )}
          </span>
        </div>
        <PhaseStepper incidentId={incident.id} phase={incident.phase} />
      </section>
      <Detections incidentId={incident.id} />
      {summary && <AfterActionSummary incident={incident} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <IncidentRecord incident={incident} />
        <Tasks incidentId={incident.id} phase={incident.phase} />
      </div>
      {reached('analyze') && <Scope incidentId={incident.id} />}
      {reached('contain') && <Fraud incidentId={incident.id} phase={incident.phase} />}
      {upcoming.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Coming up: {upcoming.map(([p, what]) => `${what} opens in ${PHASE_LABEL[p]}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

function Panel({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('glass flex flex-col gap-4 p-5', className)}>
      <h2 className="font-heading text-sm font-bold tracking-[0.2em] text-white uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** shadcn/base-ui Select over a {value: label} record; `items` makes the trigger show the label, not the raw value. */
function Pick({ id, label, value, items, onChange, disabled }: { id?: string; label: string; value: string; items: Record<string, string>; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select items={items} value={value} onValueChange={v => v != null && onChange(v as string)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeclareForm() {
  const me = useMe();
  const createIncident = useReducer(reducers.createIncident);
  const run = useRun();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('high');
  const [kind, setKind] = useState('ransomware');

  if (!can(me, LEADS))
    return <p className="glass p-6 text-lg">No incident yet. Only an incident lead can declare one: call yours now.</p>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(createIncident({ title, severity, kind }), 'Incident declared');
  };
  return (
    <form className="glass mx-auto flex max-w-xl flex-col gap-4 p-6" onSubmit={submit}>
      <h1 className="text-2xl font-bold text-white">No incident yet</h1>
      <p className="text-muted-foreground">Something wrong? Declare an incident so the whole team sees it.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inc-title">What is happening?</Label>
        <Input id="inc-title" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Ransomware on branch servers" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inc-sev">How bad?</Label>
          <Pick id="inc-sev" label="How bad?" value={severity} items={SEV_ITEMS} onChange={setSeverity} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inc-kind">Type</Label>
          <Pick id="inc-kind" label="Type" value={kind} items={KIND_LABEL} onChange={setKind} />
        </div>
      </div>
      <Button type="submit" size="lg" className="h-12 text-base font-bold">Declare incident</Button>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Practising? <DrillControls /></div>
    </form>
  );
}

function PhaseStepper({ incidentId, phase }: { incidentId: bigint; phase: string }) {
  const me = useMe();
  const setPhase = useReducer(reducers.setPhase);
  const run = useRun();
  const idx = PHASES.indexOf(phase as (typeof PHASES)[number]);
  const next = PHASES[idx + 1];
  const lead = can(me, LEADS);
  const go = (p: string, i: number) => {
    if (i < idx && !window.confirm(`Go back to ${PHASE_LABEL[p]}?`)) return;
    run(setPhase({ incidentId, phase: p }), `Phase: ${PHASE_LABEL[p]}`);
  };
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Incident phases">
        {PHASES.map((p, i) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => go(p, i)}
              disabled={!lead || i === idx}
              aria-current={i === idx ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left font-mono text-xs tracking-wider uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:cursor-default',
                i < idx && 'text-foreground enabled:hover:bg-muted',
                i === idx && 'border-primary bg-primary font-bold text-primary-foreground',
                i > idx && 'text-muted-foreground enabled:hover:bg-muted'
              )}
            >
              <span aria-hidden="true">{i < idx ? '✓' : i === idx ? '▶' : i + 1}</span>
              {PHASE_LABEL[p]}
              <span className="sr-only">{i < idx ? '(done)' : i === idx ? '(now)' : '(not started)'}</span>
            </button>
          </li>
        ))}
      </ol>
      <AutoAdvanceBanner incidentId={incidentId} />
      {next && lead && (
        <Button size="lg" onClick={() => go(next, idx + 1)} className="h-auto min-h-12 self-start px-5 py-2 text-base font-bold whitespace-normal">
          Done with {PHASE_LABEL[phase]}: move to {PHASE_LABEL[next]} →
        </Button>
      )}
      {!next && <p className="font-bold text-foreground">All phases done.</p>}
      {!lead && <p className="text-sm text-muted-foreground">Only the incident lead moves phases.</p>}
    </div>
  );
}

/** "All tasks done: moving on in 27 s [Stay here]" while an automatic phase advance is pending. */
function AutoAdvanceBanner({ incidentId }: { incidentId: bigint }) {
  const me = useMe();
  const [advances] = useTable(tables.phaseAdvances);
  const stayInPhase = useReducer(reducers.stayInPhase);
  const run = useRun();
  const [, setTick] = useState(0); // re-render every half second while counting down
  const pending = advances.find(a => a.incidentId === incidentId);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setTick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [pending]);
  if (!pending) return null;
  const secs = Math.max(0, Math.ceil((pending.at.toDate().getTime() - Date.now()) / 1000));
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-primary bg-primary/10 px-4 py-3">
      <span className="font-mono text-2xl font-bold text-primary tabular-nums">{secs}s</span>
      <span className="min-w-0 flex-1">
        All {PHASE_LABEL[pending.fromPhase]} tasks are done. Moving to <b>{PHASE_LABEL[pending.toPhase]}</b> automatically.
      </span>
      {can(me, LEADS) && (
        <Button variant="outline" onClick={() => run(stayInPhase({ incidentId }), `Staying in ${PHASE_LABEL[pending.fromPhase]}`)}>
          Stay here
        </Button>
      )}
    </div>
  );
}

function DrillControls() {
  const me = useMe();
  const startDrill = useReducer(reducers.startDrill);
  const startAutopilotDrill = useReducer(reducers.startAutopilotDrill);
  const stopDrill = useReducer(reducers.stopDrill);
  const run = useRun();
  if (!can(me, LEADS)) return null;
  return (
    <span className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        className="border-magenta/70 text-magenta hover:text-magenta"
        onClick={() => window.confirm('Start a live attack drill? A scripted attack plays out over ~90 seconds.') && run(startDrill(), 'Drill started')}
      >
        <Play /> Run 2 AM drill
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          window.confirm('Start an autopilot drill? The attack and the whole response play out on their own (about a minute and a half).') &&
          run(startAutopilotDrill(), 'Autopilot drill started')
        }
      >
        <Zap /> Autopilot
      </Button>
      <Button type="button" variant="outline" onClick={() => run(stopDrill(), 'Drill stopped')}>
        <Square /> Stop drill
      </Button>
    </span>
  );
}

/**
 * Incoming detections: what the security tools, the drill and the Nessie feed reported, newest first.
 * Built from the timeline, what was hit and fraud alerts, which every member can see (the audit log is admin-only).
 */
function Detections({ incidentId }: { incidentId: bigint }) {
  const [users] = useTable(tables.members);
  const [events] = useTable(tables.timelineEvents);
  const [scope] = useTable(tables.scopeItems);
  const [alerts] = useTable(tables.fraudAlerts);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000); // keeps "NEW" honest
    return () => clearInterval(t);
  }, []);
  const source = (who: Identity) => users.find(u => u.identity.isEqual(who))?.name ?? 'Automatic feed';
  const items = [
    ...events.filter(e => e.incidentId === incidentId && e.kind === 'ioc').map(e => ({ key: `t${e.id}`, at: e.at.toDate(), kind: 'Security alert', text: e.text, from: source(e.actor), hot: true })),
    ...scope
      .filter(s => s.incidentId === incidentId && ['encrypted', 'exfiltrated', 'accessed'].includes(s.status))
      .map(s => ({ key: `s${s.id}`, at: s.updatedAt.toDate(), kind: 'System hit', text: `${s.label}: ${SCOPE_LABEL[s.status]} (${s.recordsCount.toLocaleString()} records)`, from: source(s.updatedBy), hot: s.status !== 'accessed' })),
    ...alerts
      .filter(a => a.incidentId === incidentId)
      .map(a => ({ key: `f${a.id}`, at: a.createdAt.toDate(), kind: 'Fraud', text: `${money(a.amountCents)} from ${a.accountRef}: ${a.reason}`, from: 'Fraud feed', hot: a.status === 'open' })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const fresh = (d: Date) => Date.now() - d.getTime() < 2 * 60_000;
  return (
    <section className="glass flex flex-col gap-3 border-magenta/50 p-5" aria-label="Incoming detections">
      <h2 className="flex items-center gap-2 font-heading text-sm font-bold tracking-[0.2em] text-white uppercase">
        <Radar className="size-4 text-magenta" aria-hidden="true" /> Incoming detections
        <span className="font-mono text-xs font-normal tracking-normal text-muted-foreground normal-case">· live from security tools, drill and bank feed</span>
        {items.length > 0 && <span className="ml-auto font-mono text-xs text-muted-foreground">{items.length} total</span>}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground italic">Nothing detected yet. Alerts appear here the moment a tool reports them.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60" aria-live="polite">
          {items.slice(0, 6).map(d => (
            <li key={d.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <time className="font-mono text-xs text-muted-foreground">{d.at.toLocaleTimeString()}</time>
              <span className={cn('rounded border px-1.5 font-mono text-xs uppercase', d.hot ? 'border-magenta/60 text-magenta' : 'border-border text-muted-foreground')}>{d.kind}</span>
              {fresh(d.at) && <span className="font-mono text-xs font-bold text-neon">NEW</span>}
              <span className="min-w-0 flex-1 break-words text-white">{d.text}</span>
              <span className="text-xs text-muted-foreground">via {d.from}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Incident = NonNullable<ReturnType<typeof useCurrentIncident>>;

function IncidentRecord({ incident }: { incident: Incident }) {
  const [users] = useTable(tables.members);
  const [events] = useTable(tables.timelineEvents);
  const [scope] = useTable(tables.scopeItems);
  const by = users.find(u => u.identity.isEqual(incident.createdBy))?.name ?? 'Knight Agent';
  const mine = events.filter(e => e.incidentId === incident.id).sort((a, b) => (a.id < b.id ? 1 : -1));
  const iocs = mine.filter(e => e.kind === 'ioc').slice(0, 5);
  const actions = mine.filter(e => e.kind === 'action' || e.kind === 'auto').slice(0, 5);
  const systems = scope.filter(s => s.incidentId === incident.id && s.assetType === 'system').map(s => s.label);
  const list = (rows: typeof mine, empty: string) =>
    rows.length === 0 ? (
      <span className="text-muted-foreground">{empty}</span>
    ) : (
      <ul className="flex flex-col gap-1">
        {rows.map(e => (
          <li key={e.id.toString()}>
            <time className="mr-2 font-mono text-xs text-muted-foreground">{e.at.toDate().toLocaleTimeString()}</time>
            {e.kind === 'auto' && <span className="mr-1 text-neon">Auto:</span>}
            {e.text}
          </li>
        ))}
      </ul>
    );
  const row = (k: string, v: ReactNode) => (
    <div className="grid gap-1 border-b border-border/60 pb-2 last:border-0 sm:grid-cols-[9rem_1fr]">
      <dt className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
  return (
    <Panel title="Incident record">
      <dl className="flex flex-col gap-2 text-sm">
        {row('Incident ID', <span className="font-mono">{incidentCode(incident)}</span>)}
        {row('Type', kindLabel(incident.kind))}
        {row('Severity', <SeverityChip severity={incident.severity} />)}
        {row('Status', PHASE_LABEL[incident.phase] ?? incident.phase)}
        {row('Detected', `${incident.detectedAt.toDate().toLocaleString()} by ${by}`)}
        {row('Systems affected', systems.length ? systems.join(', ') : <span className="text-muted-foreground">None listed yet</span>)}
        {row('Clues (IOCs)', list(iocs, "None found yet"))}
        {row('Actions taken', list(actions, "Nothing yet"))}
      </dl>
    </Panel>
  );
}

function Tasks({ incidentId, phase }: { incidentId: bigint; phase: string }) {
  const me = useMe();
  const [allTasks] = useTable(tables.tasks);
  const addTask = useReducer(reducers.addTask);
  const toggleTask = useReducer(reducers.toggleTask);
  const signOffTask = useReducer(reducers.signOffTask);
  const [signoffs] = useTable(tables.signoffs);
  const [users] = useTable(tables.members);
  const run = useRun();
  const [title, setTitle] = useState('');
  const writer = can(me, WRITERS);
  const nameOf = (who: Identity) => users.find(u => u.identity.isEqual(who))?.name ?? 'Autopilot';
  // Current phase first, then open before done.
  const tasks = allTasks
    .filter(t => t.incidentId === incidentId)
    .sort((a, b) => Number(b.phase === phase) - Number(a.phase === phase) || Number(a.done) - Number(b.done) || (a.id < b.id ? -1 : 1));
  const open = tasks.filter(t => !t.done && t.phase === phase).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(addTask({ incidentId, title, phase }));
    setTitle('');
  };
  return (
    <Panel title={<>What do I do next? {tasks.length > 0 && <span className="text-muted-foreground">({open} open now)</span>}</>}>
      {tasks.length === 0 && <p className="text-muted-foreground italic">No tasks yet: add your own below.</p>}
      <ul className="flex flex-col gap-1">
        {tasks.map(t => {
          const other = t.phase !== phase;
          if (SIGNOFF_TASKS.has(t.title)) {
            const so = signoffs.find(s => s.taskId === t.id);
            const mineDone = !!so && !!me && so.doneBy.isEqual(me.identity);
            const canVerify = !!so && !so.verifiedBy && !mineDone && can(me, LEADS);
            return (
              <li key={t.id.toString()} className={cn('flex flex-wrap items-start gap-3 rounded-md px-2 py-1.5', other && 'opacity-50')}>
                <UserCheck className={cn('mt-0.5 size-4 shrink-0', t.done ? 'text-ok' : so ? 'text-sev-medium' : 'text-muted-foreground')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn(t.done && 'text-muted-foreground line-through')}>{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {!so && 'Needs two people: one does it, a different lead verifies it'}
                    {so && !so.verifiedBy && `Done by ${nameOf(so.doneBy)} · waiting for a different lead to verify`}
                    {so?.verifiedBy && `Done by ${nameOf(so.doneBy)} · Verified by ${nameOf(so.verifiedBy)} · ${so.verifiedAt?.toDate().toLocaleTimeString()}`}
                  </span>
                </span>
                {other && <span className="shrink-0 font-mono text-xs text-muted-foreground">{PHASE_LABEL[t.phase] ?? t.phase}</span>}
                {writer && !so && (
                  <Button size="sm" variant="outline" onClick={() => run(signOffTask({ taskId: t.id }), 'Marked done: waiting for verification')}>I did this</Button>
                )}
                {mineDone && !so?.verifiedBy && (
                  <Button size="sm" variant="ghost" onClick={() => run(signOffTask({ taskId: t.id }), 'Sign-off withdrawn')}>Undo</Button>
                )}
                {canVerify && (
                  <Button size="sm" onClick={() => window.confirm(`Verify "${t.title}"? You confirm you checked it yourself.`) && run(signOffTask({ taskId: t.id }), 'Verified')}>
                    Verify
                  </Button>
                )}
              </li>
            );
          }
          return (
            <li key={t.id.toString()} className={cn(other && 'opacity-50')}>
              <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
                <Checkbox className="mt-0.5" checked={t.done} disabled={!writer} onCheckedChange={() => run(toggleTask({ taskId: t.id }))} />
                <span className={cn(t.done && 'text-muted-foreground line-through')}>{t.title}</span>
                {other && <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{PHASE_LABEL[t.phase] ?? t.phase}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {writer && (
        <form className="flex gap-2" onSubmit={submit}>
          <Label className="sr-only" htmlFor="new-task">New task</Label>
          <Input id="new-task" required value={title} onChange={e => setTitle(e.target.value)} placeholder="New task" />
          <Button type="submit" variant="outline">Add task</Button>
        </form>
      )}
    </Panel>
  );
}

function Scope({ incidentId }: { incidentId: bigint }) {
  const me = useMe();
  const [allItems] = useTable(tables.scopeItems);
  const upsertScopeItem = useReducer(reducers.upsertScopeItem);
  const [users] = useTable(tables.members);
  const run = useRun();
  const [preset, setPreset] = useState('');
  const [form, setForm] = useState({ label: '', assetRef: '', assetType: 'system', status: 'unknown', records: '0' });
  const pickPreset = (k: string) => {
    setPreset(k);
    const p = PRESETS[k];
    if (p) setForm({ ...form, label: p.label, assetRef: p.ref, assetType: p.type, records: String(p.records) });
  };
  const isAuto = (who: Identity) => !users.some(u => u.identity.isEqual(who));
  const writer = can(me, WRITERS);
  const items = allItems.filter(s => s.incidentId === incidentId);
  const totals = Object.fromEntries(SCOPE_STATUSES.map(s => [s, 0n])) as Record<string, bigint>;
  for (const it of items) totals[it.status] = (totals[it.status] ?? 0n) + it.recordsCount;

  const save = (it: { assetType: string; assetRef: string; label: string; recordsCount: bigint }, status: string) =>
    run(upsertScopeItem({ incidentId, assetType: it.assetType, assetRef: it.assetRef, label: it.label, recordsCount: it.recordsCount, status }), `${it.label}: ${SCOPE_LABEL[status]}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(form.records);
    if (!Number.isInteger(n) || n < 0) return;
    save({ assetType: form.assetType, assetRef: form.assetRef, label: form.label, recordsCount: BigInt(n) }, form.status);
    setForm({ ...form, label: '', assetRef: '', records: '0' });
    setPreset('');
  };

  return (
    <Panel title="What was hit">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-live="polite">
        {SCOPE_STATUSES.map(s => {
          const { Icon, cls } = SCOPE_STYLE[s];
          return (
            <div key={s} className={cn('flex flex-col gap-1 rounded-xl border bg-background/40 p-3', cls)}>
              <Icon className="size-5" aria-hidden="true" />
              <div className="font-mono text-2xl font-bold">{totals[s].toLocaleString()}</div>
              <div className="text-xs text-foreground/80">records · {SCOPE_LABEL[s]}</div>
            </div>
          );
        })}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground italic">Nothing listed yet{writer ? ': add the first affected system below.' : '.'}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Records</TableHead>
              {writer && <TableHead>Change status</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id.toString()}>
                <TableCell>
                  {it.label} <span className="font-mono text-xs text-muted-foreground">{it.assetRef}</span>
                  {isAuto(it.updatedBy) && <span className="ml-2 rounded border border-neon/50 px-1 font-mono text-[10px] text-neon uppercase">Auto</span>}
                </TableCell>
                <TableCell>{ASSET_TYPES[it.assetType] ?? it.assetType}</TableCell>
                <TableCell><ScopeChip status={it.status} /></TableCell>
                <TableCell className="text-right font-mono">{it.recordsCount.toLocaleString()}</TableCell>
                {writer && (
                  <TableCell>
                    <Pick label={`Status for ${it.label}`} value={it.status} items={SCOPE_LABEL} onChange={st => save(it, st)} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {writer && (
        <form className="grid gap-3 rounded-xl border border-border/60 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" onSubmit={submit}>
          <h3 className="font-bold sm:col-span-2 lg:col-span-6">Add affected system</h3>
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-6">
            <Label htmlFor="sc-preset">Quick pick</Label>
            <Pick id="sc-preset" label="Quick pick a common bank system" value={preset} items={PRESET_ITEMS} onChange={pickPreset} />
            <span className="text-xs text-muted-foreground">Fills the fields below; change anything before adding. The drill and the Nessie import add systems here on their own (marked Auto).</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-label">Name</Label>
            <Input id="sc-label" required value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Core banking DB" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-ref">ID or hostname</Label>
            <Input id="sc-ref" required value={form.assetRef} onChange={e => setForm({ ...form, assetRef: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-type">Type</Label>
            <Pick id="sc-type" label="Type" value={form.assetType} items={ASSET_TYPES} onChange={v => setForm({ ...form, assetType: v })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-status">Status</Label>
            <Pick id="sc-status" label="Status" value={form.status} items={SCOPE_LABEL} onChange={v => setForm({ ...form, status: v })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sc-rec">Records affected</Label>
            <Input id="sc-rec" type="number" min={0} step={1} required value={form.records} onChange={e => setForm({ ...form, records: e.target.value })} />
          </div>
          <Button type="submit">Add system</Button>
        </form>
      )}
    </Panel>
  );
}

function ScopeChip({ status }: { status: string }) {
  const st = SCOPE_STYLE[status];
  const Icon = st?.Icon ?? CircleHelp;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold', st?.cls.split(' shadow')[0])}>
      <Icon className="size-3" aria-hidden="true" />
      {SCOPE_LABEL[status] ?? status}
    </span>
  );
}

const AUTO_FREEZE_CENTS = 1_000_000n; // mirrors the module: $10,000

function Fraud({ incidentId, phase }: { incidentId: bigint; phase: string }) {
  const containing = PHASES.indexOf(phase as (typeof PHASES)[number]) >= PHASES.indexOf('contain');
  const me = useMe();
  const [allAlerts] = useTable(tables.fraudAlerts);
  const setFraudAlertStatus = useReducer(reducers.setFraudAlertStatus);
  const run = useRun();
  const writer = can(me, WRITERS);
  const alerts = allAlerts.filter(a => a.incidentId === incidentId);
  const open = alerts.filter(a => a.status === 'open').sort((a, b) => (a.id < b.id ? 1 : -1));
  const frozen = alerts.filter(a => a.status === 'frozen');
  const frozenTotal = frozen.reduce((sum, a) => sum + a.amountCents, 0n);
  const dismissed = alerts.filter(a => a.status === 'dismissed').length;

  const act = (alertId: bigint, account: string, status: 'frozen' | 'dismissed') => {
    const verb = status === 'frozen' ? 'Freeze account' : 'Mark as fine';
    if (!window.confirm(`${verb}: ${account}?`)) return;
    run(setFraudAlertStatus({ alertId, status }), `${verb}: ${account}`);
  };

  return (
    <Panel title={<>Fraud: needs a decision {open.length > 0 && <span className="text-sev-critical">({open.length})</span>}</>}>
      <p className="text-sm text-muted-foreground">
        Transfers of $10,000 or more freeze automatically {containing ? 'now that the team is in Contain' : 'when the team reaches Contain'}. Smaller ones need a person to decide.
      </p>
      {frozen.length > 0 && (
        <details className="rounded-lg border border-neon/40 px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 font-bold text-neon">
            <Zap className="size-4" aria-hidden="true" /> {frozen.length} account{frozen.length === 1 ? '' : 's'} frozen ({money(frozenTotal)})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {frozen.map(a => (
              <li key={a.id.toString()}>
                <code className="font-mono">{a.accountRef}</code> · {money(a.amountCents)} · {a.reason} ·{' '}
                <span className="text-muted-foreground">{a.amountCents >= AUTO_FREEZE_CENTS ? 'frozen automatically' : 'frozen by a person'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {open.length === 0 && <p className="text-muted-foreground italic">No suspicious transfers waiting for a decision.</p>}
      <ul className="flex flex-col gap-3">
        {open.map(a => (
          <li key={a.id.toString()} className="flex flex-wrap items-center gap-3 rounded-xl border border-sev-high/50 bg-background/40 p-3">
            <div className="min-w-0 flex-1">
              <strong className="font-mono text-lg text-sev-high">{money(a.amountCents)}</strong> from account <code className="font-mono">{a.accountRef}</code>
              <div className="text-sm text-muted-foreground">
                {a.reason} · {a.createdAt.toDate().toLocaleTimeString()} · transfer <span className="font-mono">{a.transferRef}</span>
              </div>
              {a.amountCents >= AUTO_FREEZE_CENTS && !containing && (
                <div className="mt-1 font-mono text-xs text-neon">Freezes automatically when you reach Contain</div>
              )}
            </div>
            {writer && (
              <div className="flex gap-2">
                <Button variant="destructive" onClick={() => act(a.id, a.accountRef, 'frozen')}>
                  <Snowflake /> Freeze
                </Button>
                <Button variant="outline" onClick={() => act(a.id, a.accountRef, 'dismissed')}>
                  <ThumbsUp /> It's fine
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {dismissed > 0 && (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Check className="size-3" aria-hidden="true" /> {dismissed} marked as fine
        </p>
      )}
    </Panel>
  );
}
