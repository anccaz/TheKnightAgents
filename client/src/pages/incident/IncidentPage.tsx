// Lane B owner: the whole incident on one screen: declare, phase, record, tasks, what was hit, fraud decisions.
import { useState, type FormEvent, type ReactNode } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { Check, CircleHelp, Download, Eye, Lock, Play, ShieldCheck, Snowflake, Square, ThumbsUp, Zap, type LucideIcon } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { LEADS, PHASES, PHASE_LABEL, SCOPE_LABEL, SCOPE_STATUSES, SEVERITIES, SeverityChip, WRITERS, can, useCurrentIncident, useMe } from '@/components/shared';
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
  encrypted: { Icon: Lock, cls: 'text-sev-critical border-sev-critical/60 shadow-[0_0_18px_rgb(255_45_111/0.35)]' },
  exfiltrated: { Icon: Download, cls: 'text-magenta border-magenta/60 shadow-[0_0_18px_rgb(202_1_83/0.35)]' },
  accessed: { Icon: Eye, cls: 'text-sev-high border-sev-high/60 shadow-[0_0_18px_rgb(255_138_61/0.3)]' },
  unknown: { Icon: CircleHelp, cls: 'text-sev-medium border-sev-medium/60 shadow-[0_0_18px_rgb(245_208_0/0.25)]' },
  clear: { Icon: ShieldCheck, cls: 'text-ok border-ok/60 shadow-[0_0_18px_rgb(52_224_161/0.3)]' },
};

const money = (cents: bigint) => `$${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, '0')}`;

export default function IncidentPage() {
  const incident = useCurrentIncident();
  if (!incident) return <DeclareForm />;
  return (
    <div className="flex flex-col gap-6">
      <section className="glass flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-[0.3em] text-magenta uppercase magenta-text">Active incident</p>
            <h1 className="text-2xl font-bold break-words text-neon neon-text sm:text-3xl">{incident.title}</h1>
          </div>
          <DrillControls />
        </div>
        <PhaseStepper incidentId={incident.id} phase={incident.phase} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <IncidentRecord incident={incident} />
        <Tasks incidentId={incident.id} phase={incident.phase} />
      </div>
      <Scope incidentId={incident.id} />
      <Fraud incidentId={incident.id} />
    </div>
  );
}

function Panel({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('glass flex flex-col gap-4 p-5', className)}>
      <h2 className="font-mono text-sm font-bold tracking-[0.2em] text-neon uppercase neon-text">{title}</h2>
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
      <h1 className="text-2xl font-bold text-neon neon-text">No incident yet</h1>
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
      <Button type="submit" size="lg" className="h-12 text-base font-bold shadow-[0_0_24px_rgb(56_188_246/0.5)]">Declare incident</Button>
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
                'flex w-full items-center gap-2 rounded-lg border-t-4 bg-muted/40 px-3 py-2 text-left font-mono text-xs tracking-wider uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:cursor-default',
                i < idx && 'border-ok text-ok enabled:hover:bg-muted',
                i === idx && 'border-neon bg-neon/15 font-bold text-neon shadow-[0_0_20px_rgb(56_188_246/0.45)] neon-text',
                i > idx && 'border-border text-muted-foreground enabled:hover:bg-muted'
              )}
            >
              <span aria-hidden="true">{i < idx ? '✓' : i === idx ? '▶' : i + 1}</span>
              {PHASE_LABEL[p]}
              <span className="sr-only">{i < idx ? '(done)' : i === idx ? '(now)' : '(not started)'}</span>
            </button>
          </li>
        ))}
      </ol>
      {next && lead && (
        <Button size="lg" onClick={() => go(next, idx + 1)} className="h-auto min-h-12 self-start px-5 py-2 text-base font-bold whitespace-normal shadow-[0_0_24px_rgb(56_188_246/0.5)]">
          Done with {PHASE_LABEL[phase]}: move to {PHASE_LABEL[next]} →
        </Button>
      )}
      {!next && <p className="font-bold text-ok">✓ All phases done.</p>}
      {!lead && <p className="text-sm text-muted-foreground">Only the incident lead moves phases.</p>}
    </div>
  );
}

function DrillControls() {
  const me = useMe();
  const startDrill = useReducer(reducers.startDrill);
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
      <Button type="button" variant="outline" onClick={() => run(stopDrill(), 'Drill stopped')}>
        <Square /> Stop drill
      </Button>
    </span>
  );
}

type Incident = NonNullable<ReturnType<typeof useCurrentIncident>>;

function IncidentRecord({ incident }: { incident: Incident }) {
  const [users] = useTable(tables.members);
  const [events] = useTable(tables.timelineEvents);
  const [scope] = useTable(tables.scopeItems);
  const by = users.find(u => u.identity.isEqual(incident.createdBy))?.name ?? 'Breach Room';
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
            {e.kind === 'auto' && <span className="mr-1 text-neon">⚡ Auto:</span>}
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
  const run = useRun();
  const [title, setTitle] = useState('');
  const writer = can(me, WRITERS);
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
  const run = useRun();
  const [form, setForm] = useState({ label: '', assetRef: '', assetType: 'system', status: 'unknown', records: '0' });
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

function Fraud({ incidentId }: { incidentId: bigint }) {
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
      {frozen.length > 0 && (
        <p className="flex items-center gap-2 font-bold text-neon">
          <Zap className="size-4" aria-hidden="true" /> {frozen.length} account{frozen.length === 1 ? '' : 's'} auto-frozen ({money(frozenTotal)})
        </p>
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
