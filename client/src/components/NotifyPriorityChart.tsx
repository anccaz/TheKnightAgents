// "Who must we tell first?" Each bubble is one notice the bank owes.
// x = time left (log days, left = due soonest), y = people affected (log), size = people, color = who is told.
import { useEffect, useMemo, useState } from 'react';
import { useProcedure, useReducer, useTable } from 'spacetimedb/react';
import { procedures, reducers, tables } from '@/module_bindings';
import { countdown, obligationsFor, stateName } from '@/lib/notifyRules';
import { useRun } from '@/components/Toast';
import { can, PRIVILEGED, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

// Validated with the dataviz palette checker on the #0b0f22 panel (CVD ΔE 18.4, contrast >= 3:1).
const COLOR = { customers: '#1f9ad8', authorities: '#ff2d6f' } as const;
type Group = keyof typeof COLOR;
type Status = 'not_started' | 'drafted' | 'sent';
const STATUS_LABEL: Record<Status, string> = { not_started: 'Not started', drafted: 'Drafted', sent: 'Sent' };
const NOTIFIERS = ['admin', 'incident_lead', 'responder', 'legal'];
type Notice = {
  id: string; label: string; who: string; group: Group; people: number; due: Date | null; rule: string; short: string;
  status: Status; clockId?: bigint;
};

const W = 640, H = 380, PAD = { l: 56, r: 20, t: 20, b: 44 };
const X_MIN = 0.5, X_MAX = 90; // days
const DAY = 86_400_000;
const lx = (d: number) => PAD.l + ((Math.log(Math.min(Math.max(d, X_MIN), X_MAX)) - Math.log(X_MIN)) / (Math.log(X_MAX) - Math.log(X_MIN))) * (W - PAD.l - PAD.r);
const fmt = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);

export default function NotifyPriorityChart({ incidentId }: { incidentId: bigint }) {
  const [impacts] = useTable(tables.stateImpacts);
  const [clocks] = useTable(tables.legalClocks);
  const [statuses] = useTable(tables.notifyStatuses);
  const me = useMe();
  const setNotifyStatus = useReducer(reducers.setNotifyStatus);
  const completeLegalClock = useReducer(reducers.completeLegalClock);
  const draftNotice = useProcedure(procedures.draftNotice);
  const [drafting, setDrafting] = useState<string | null>(null);
  const run = useRun();
  const [now, setNow] = useState(Date.now());
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const notices = useMemo(() => {
    const rows = impacts.filter(r => r.incidentId === incidentId && r.records > 0n);
    const total = rows.reduce((n, r) => n + Number(r.records), 0);
    const statusOf = (id: string) =>
      (statuses.find(s => s.incidentId === incidentId && s.notice === id)?.status ?? 'not_started') as Status;
    const out: Notice[] = [];
    for (const r of rows) {
      const people = Number(r.records);
      for (const o of obligationsFor(r.state, people, r.since.toDate())) {
        const kind = o.who === 'Attorney General' ? 'AG' : o.who === 'Credit bureaus' ? 'CRA' : null;
        out.push({
          id: `${r.state}-${o.who}`,
          label: `${stateName(r.state)} ${kind === 'AG' ? 'Attorney General' : kind === 'CRA' ? 'credit bureaus' : 'customers'}`,
          short: kind ? `${r.state} ${kind}` : r.state,
          who: o.who,
          group: kind ? 'authorities' : 'customers',
          people,
          due: o.dueAt,
          rule: o.text,
          status: statusOf(`${r.state}-${o.who}`),
        });
      }
    }
    // Federal deadlines (state clocks are already covered per state above). A filed clock counts as sent.
    for (const c of clocks)
      if (c.incidentId === incidentId && !c.regime.startsWith('tx_') && total > 0)
        out.push({
          clockId: c.id,
          status: c.done ? 'sent' : statusOf(`clock-${c.id}`),
          id: `clock-${c.id}`,
          label: c.label,
          short: c.regime === 'bank_regulator' ? 'Regulator' : c.regime === 'sec_8k' ? 'SEC' : c.label.split(' ')[0],
          who: 'Federal',
          group: 'authorities',
          people: total,
          due: c.deadlineAt.toDate(),
          rule: 'Federal deadline',
        });
    return out.sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  }, [impacts, clocks, statuses, incidentId]);

  const mark = (n: Notice, status: Status) => {
    if (status === 'sent' && !window.confirm(`Mark "${n.label}" as sent? This is recorded in the audit log.`)) return;
    run(setNotifyStatus({ incidentId, notice: n.id, label: n.label, status }), `${n.label}: ${STATUS_LABEL[status]}`);
    if (status === 'sent' && n.clockId != null) run(completeLegalClock({ clockId: n.clockId }));
  };

  // Gemini writes the letter on the server (key never reaches the browser); it lands in #legal as "drafted".
  const draftWithAi = (n: Notice) => {
    setDrafting(n.id);
    const due = n.due ? n.due.toLocaleDateString() : 'as soon as possible';
    const call = draftNotice({ incidentId, notice: n.id, label: n.label, people: BigInt(n.people), rule: n.rule, due });
    run(call, `${n.label}: AI draft posted in #legal for review`);
    call.finally(() => setDrafting(null)).catch(() => {});
  };

  const maxPeople = Math.max(10, ...notices.map(n => n.people));
  const yMax = 10 ** Math.ceil(Math.log10(maxPeople * 1.5));
  const ly = (p: number) => H - PAD.b - ((Math.log10(Math.max(p, 10)) - 1) / (Math.log10(yMax) - 1)) * (H - PAD.t - PAD.b);
  const r = (p: number) => 7 + 20 * Math.sqrt(p / maxPeople);
  const daysLeft = (n: Notice) => (n.due ? (n.due.getTime() - now) / DAY : 0); // ASAP = due now
  const avg = notices.length ? notices.reduce((s, n) => s + n.people, 0) / notices.length : 0;
  const yTicks = Array.from({ length: Math.log10(yMax) }, (_, i) => 10 ** (i + 1));
  const xTicks = [1, 3, 7, 14, 30, 60];
  const labelled = new Set([...notices].sort((a, b) => b.people - a.people).slice(0, 12).map(n => n.id));
  // Notices with the same deadline and count would sit on top of each other: dodge them side by side,
  // and label the group once (e.g. "CA" for CA customers + CA AG).
  const pos = new Map<string, { x: number; y: number; label: string | null; cx: number }>();
  const groups = new Map<string, Notice[]>();
  for (const n of notices) {
    const key = `${Math.round(lx(daysLeft(n)))},${Math.round(ly(n.people))}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  for (const g of groups.values()) {
    const step = 2 * r(g[0].people) + 4;
    const states = new Set(g.map(n => n.short.split(' ')[0]));
    g.forEach((n, i) => {
      const x = lx(daysLeft(n)) + (i - (g.length - 1) / 2) * step;
      const label = g.length === 1 ? n.short : i === 0 ? (states.size === 1 ? [...states][0] : g.map(m => m.short).join(' · ')) : null;
      pos.set(n.id, { x, y: ly(n.people), label, cx: lx(daysLeft(n)) });
    });
  }
  const shown = notices.find(n => n.id === hover); // tooltip on hover/focus only, so it never covers the chart after a click
  const sent = notices.filter(n => n.status === 'sent').length;

  return (
    <section aria-label="Notification priority">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm tracking-[0.3em] uppercase">Who must we tell first</h2>
        <span className="text-sm text-muted-foreground">
          {notices.length ? (
            <>
              <b className="text-foreground">{notices.length}</b> notices owed · {sent} sent
            </>
          ) : (
            'Notices appear as soon as customer data is marked Stolen.'
          )}
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="glass relative p-3">
          {/* Legend: identity is never color alone */}
          <div className="mb-1 flex gap-4 text-xs text-muted-foreground">
            {(['customers', 'authorities'] as const).map(g => (
              <span key={g} className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-full" style={{ background: COLOR[g] }} />
                {g === 'customers' ? 'Customers' : 'Authorities (AG, regulator, SEC, credit bureaus)'}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bubble chart of notices by deadline and people affected">
            {/* recessive grid + axes */}
            {yTicks.map(t => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={ly(t)} y2={ly(t)} stroke="rgb(255 255 255 / 0.06)" />
                <text x={PAD.l - 8} y={ly(t) + 4} textAnchor="end" fontSize={11} fill="#8ea3c9" className="font-mono">{fmt(t)}</text>
              </g>
            ))}
            {xTicks.map(t => (
              <g key={t}>
                <line x1={lx(t)} x2={lx(t)} y1={PAD.t} y2={H - PAD.b} stroke="rgb(255 255 255 / 0.06)" />
                <text x={lx(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="#8ea3c9" className="font-mono">{t}d</text>
              </g>
            ))}
            <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#8ea3c9">Time left until deadline →</text>
            <text transform={`translate(14 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="#8ea3c9">People affected</text>

            {/* reference lines */}
            <line x1={lx(7)} x2={lx(7)} y1={PAD.t} y2={H - PAD.b} stroke="#ffffff" strokeOpacity={0.35} strokeDasharray="4 4" />
            <text x={lx(7) + 4} y={PAD.t + 12} fontSize={10} fill="#ffffff" fillOpacity={0.7}>1 week</text>
            {avg > 0 && (
              <>
                <line x1={PAD.l} x2={W - PAD.r} y1={ly(avg)} y2={ly(avg)} stroke="#ffffff" strokeOpacity={0.35} strokeDasharray="4 4" />
                <rect x={PAD.l + 2} y={ly(avg) - 9} width={52} height={18} rx={3} fill="#ff2d6f" />
                <text x={PAD.l + 28} y={ly(avg) + 4} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">Average</text>
              </>
            )}
            {notices.length > 0 && (
              <text x={PAD.l + 8} y={PAD.t + 14} fontSize={11} fontWeight={700} fill="#ffffff" fillOpacity={0.8} className="font-heading">DO FIRST</text>
            )}

            {/* bubbles: biggest first so small ones stay on top; 2px surface ring separates overlaps */}
            {[...notices]
              .sort((a, b) => b.people - a.people)
              .map(n => {
                const { x, y, label, cx } = pos.get(n.id)!;
                const active = n.id === (hover ?? picked);
                const overdue = n.due != null && n.due.getTime() < now;
                return (
                  <g
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.label}: ${n.people.toLocaleString()} people, ${n.due ? `due ${n.due.toLocaleDateString()}` : 'as soon as possible'}`}
                    className="cursor-pointer outline-none"
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(n.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPicked(n.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setPicked(n.id)}
                  >
                    <circle cx={x} cy={y} r={r(n.people) + 6} fill="transparent" />
                    <circle cx={x} cy={y} r={r(n.people)} fill={COLOR[n.group]} fillOpacity={n.status === 'sent' ? 0.12 : active ? 1 : 0.85} stroke={active ? '#ffffff' : n.status === 'sent' ? COLOR[n.group] : '#0b0f22'} strokeWidth={2} strokeDasharray={n.status === 'drafted' ? '4 3' : undefined} />
                    {overdue && <circle cx={x} cy={y} r={r(n.people) + 4} fill="none" stroke="#ff2d6f" strokeWidth={2} strokeDasharray="3 3" />}
                    {label && labelled.has(n.id) && (
                      <text
                        x={cx /* centered over the bubble, or over the group when dodged */}
                        y={y - r(n.people) - 5}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="#ffffff"
                        className="pointer-events-none font-mono"
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
          </svg>

          {/* hover tooltip */}
          {shown && (
            <div className="pointer-events-none absolute top-10 right-4 w-56 rounded-lg border border-border bg-popover p-3 text-sm">
              <div className="font-bold">{shown.label}</div>
              <div className="text-muted-foreground">{shown.people.toLocaleString()} people · {shown.rule}</div>
              <div className="mt-1 font-mono text-primary">
                {shown.status === 'sent' ? '✓ Sent' : shown.due ? `${countdown(shown.due, now)} left · ${shown.due.toLocaleDateString()}` : 'As soon as possible'}
              </div>
            </div>
          )}
        </div>

        {/* Notice queue: same data as the chart, in deadline order (doubles as the table view) */}
        <ol className="glass flex flex-col gap-1.5 p-3" aria-label="Notice queue by deadline">
          {notices.length === 0 && <li className="text-sm text-muted-foreground italic">Nothing to notify yet.</li>}
          {notices.map(n => (
            <li key={n.id}>
              <button
                onClick={() => setPicked(n.id)}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm hover:bg-muted/40',
                  n.id === (hover ?? picked) ? 'border-primary bg-muted/40' : 'border-border'
                )}
              >
                <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: COLOR[n.group] }} aria-hidden="true" />
                <span className={cn('min-w-0 flex-1 truncate', n.status === 'sent' && 'text-muted-foreground line-through')}>
                  {n.label} <span className="text-muted-foreground">· {fmt(n.people)}</span>
                </span>
                <span
                  className={cn(
                    'rounded-full border px-1.5 text-[10px] font-semibold uppercase',
                    n.status === 'sent' ? 'border-primary text-primary' : n.status === 'drafted' ? 'border-foreground/60 text-foreground' : 'border-border text-muted-foreground'
                  )}
                >
                  {n.status === 'sent' ? '✓ ' : ''}
                  {STATUS_LABEL[n.status]}
                </span>
                <span className={cn('font-mono text-xs', n.status !== 'sent' && n.due && n.due.getTime() - now < 7 * DAY ? 'text-magenta' : 'text-muted-foreground')}>
                  {n.status === 'sent' ? 'done' : countdown(n.due, now)}
                </span>
              </button>
              {picked === n.id && can(me, NOTIFIERS) && (
                <div className="mt-1 mb-1 flex flex-wrap gap-1.5 pl-5">
                  {n.status !== 'sent' && can(me, PRIVILEGED) && (
                    <Button size="sm" variant="outline" disabled={drafting != null} onClick={() => draftWithAi(n)}>
                      <Sparkles aria-hidden="true" />
                      {drafting === n.id ? 'Drafting…' : n.status === 'drafted' ? 'Redraft with AI' : 'Draft with AI'}
                    </Button>
                  )}
                  {n.status === 'not_started' && (
                    <Button size="sm" variant="outline" onClick={() => mark(n, 'drafted')}>Mark drafted</Button>
                  )}
                  {n.status !== 'sent' && (
                    <Button size="sm" onClick={() => mark(n, 'sent')}>Mark sent</Button>
                  )}
                  {n.status === 'sent' && n.clockId == null && (
                    <Button size="sm" variant="ghost" onClick={() => mark(n, 'drafted')}>Reopen</Button>
                  )}
                </div>
              )}
            </li>
          ))}
          {notices.length > 0 && <li className="pt-1 text-xs text-muted-foreground">Rules and AI drafts: verify before relying on them. Not legal advice. A person must review and click Mark sent.</li>}
        </ol>
      </div>
    </section>
  );
}
