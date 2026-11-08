// Incident advisor: launcher bottom-left, chat overlay bottom-right, and a full confirmation page before any action.
// Answers come from askAdvisor on the server (Gemini, grounded in this incident's record; rule-based if AI is off).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useProcedure, useReducer, useTable } from 'spacetimedb/react';
import { Bot, Send, ShieldAlert, X } from 'lucide-react';
import { procedures, reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { useNotices } from '@/components/NotifyPriorityChart';
import { PHASE_LABEL, ROLE_LABEL, useCurrentIncident, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Action = { type: string; target: string; ref: string; label: string; reason: string };
type Reply = { answer: string; actions: Action[]; source: 'ai' | 'rules'; model?: string };
type Msg = { role: 'user' | 'advisor'; text: string; reply?: Reply };

const QUICK = ['What should I do next?', "What's overdue or at risk?", 'Brief the CEO in 3 lines', 'Who must we notify and by when?'];
// What each citation tag points at, so a reader sees the source type at a glance.
const SOURCE: Record<string, string> = {
  I: 'Incident', P: 'Playbook', K: 'Task', T: 'Timeline', S: 'What was hit', F: 'Fraud alert', D: 'Deadline', A: 'State count', Q: 'Notice', M: 'Chat',
};

/** Render an answer with [TAG] citations as small source chips. */
function Cited({ text }: { text: string }) {
  const lines = text.split('\n').filter(l => l.trim());
  const chips = (line: string) =>
    line.split(/(\[[A-Z][A-Za-z0-9]*\])/g).map((part, i) => {
      const m = /^\[([A-Z])([A-Za-z0-9]*)\]$/.exec(part);
      if (!m) return <span key={i}>{part}</span>;
      return (
        <span key={i} title={`Source: ${SOURCE[m[1]] ?? 'record'} ${m[1]}${m[2]}`} className="mx-0.5 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
          {SOURCE[m[1]] ?? m[1]}
        </span>
      );
    });
  const bullets = lines.filter(l => l.trim().startsWith('- '));
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.filter(l => !l.trim().startsWith('- ')).map((l, i) => <p key={`p${i}`}>{chips(l)}</p>)}
      {bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-4">
          {bullets.map((l, i) => <li key={`b${i}`}>{chips(l.trim().slice(2))}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function AdvisorWidget() {
  const me = useMe();
  const incident = useCurrentIncident();
  const notices = useNotices(incident?.id ?? 0n);
  const askAdvisor = useProcedure(procedures.askAdvisor);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Action | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.parentElement?.scrollTo({ top: 1e9 });
  }, [msgs.length, busy]);

  if (!me) return null;

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || busy || !incident) return;
    const history = msgs.slice(-4).map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${(m.reply?.answer ?? m.text).slice(0, 400)}`).join('\n');
    const list = notices.map(n => ({ key: n.id, label: n.label, people: n.people, dueMs: n.due?.getTime() ?? 0 }));
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setText('');
    setBusy(true);
    askAdvisor({ incidentId: incident.id, question: q, history, notices: JSON.stringify(list) })
      .then(raw => {
        const reply = JSON.parse(raw as string) as Reply;
        setMsgs(m => [...m, { role: 'advisor', text: reply.answer, reply }]);
      })
      .catch((e: unknown) => setMsgs(m => [...m, { role: 'advisor', text: `Could not answer: ${e instanceof Error ? e.message : String(e)}` }]))
      .finally(() => setBusy(false));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  return (
    <>
      {/* Launcher: bottom-left */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close incident advisor' : 'Open incident advisor'}
        aria-expanded={open}
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-primary bg-card px-4 py-3 font-heading text-sm font-bold tracking-wider text-foreground uppercase hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <Bot className="size-5 text-primary" /> Advisor
      </button>

      {/* Chat overlay: bottom-right */}
      {open && (
        <section
          aria-label="Incident advisor"
          className="fixed right-4 bottom-4 z-40 flex h-[min(38rem,calc(100vh-6rem))] w-[min(27rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-card"
        >
          <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm tracking-[0.2em] uppercase">Incident advisor</h2>
              <p className="text-xs text-muted-foreground">Answers only from this incident's record, with sources. Actions always need your confirmation.</p>
            </div>
            <button type="button" aria-label="Close advisor" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {!incident && <p className="text-sm text-muted-foreground italic">No incident yet: the advisor works once an incident is declared.</p>}
            {incident && msgs.length === 0 && (
              <p className="text-sm text-muted-foreground">Ask anything about {incident.title}, or pick a question below.</p>
            )}
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-8 rounded-lg bg-primary/15 px-3 py-2 text-sm">{m.text}</div>
              ) : (
                <div key={i} className="mr-4 space-y-2 rounded-lg border border-border px-3 py-2">
                  {m.reply ? <Cited text={m.reply.answer} /> : <p className="text-sm text-magenta">{m.text}</p>}
                  {m.reply && (
                    <p className="font-mono text-[10px] text-muted-foreground uppercase">
                      {m.reply.source === 'ai' ? `Gemini${m.reply.model ? ` · ${m.reply.model}` : ''} · grounded in the incident record` : 'Rule-based (AI unavailable) · facts only'}
                    </p>
                  )}
                  {m.reply?.actions.map(a => (
                    <Button key={a.type + a.target} size="sm" variant="outline" className="h-auto w-full justify-start py-1.5 text-left whitespace-normal" onClick={() => setReview(a)}>
                      Review action: {a.label}
                    </Button>
                  ))}
                </div>
              )
            )}
            {busy && <p className="text-sm text-muted-foreground italic">Checking the incident record…</p>}
            <div ref={bottom} />
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(q => (
                <button key={q} type="button" disabled={busy || !incident} onClick={() => ask(q)} className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="flex gap-2">
              <label htmlFor="advisor-q" className="sr-only">Ask the advisor</label>
              <Input id="advisor-q" value={text} onChange={e => setText(e.target.value)} placeholder="Ask about this incident…" disabled={!incident} maxLength={500} />
              <Button type="submit" size="icon" aria-label="Send" disabled={busy || !text.trim() || !incident}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </section>
      )}

      {review && incident && (
        <ConfirmActionPage
          action={review}
          incidentId={incident.id}
          onClose={() => setReview(null)}
          onDone={note => setMsgs(m => [...m, { role: 'advisor', text: note, reply: { answer: note, actions: [], source: 'rules' } }])}
        />
      )}
    </>
  );
}

/** Second confirmation: a separate page that shows exactly what will run, as whom, and why. */
function ConfirmActionPage({
  action, incidentId, onClose, onDone,
}: { action: Action; incidentId: bigint; onClose: () => void; onDone: (note: string) => void }) {
  const me = useMe();
  const incident = useCurrentIncident();
  const [tasks] = useTable(tables.tasks);
  const [alerts] = useTable(tables.fraudAlerts);
  const [clocks] = useTable(tables.legalClocks);
  const run = useRun();
  const toggleTask = useReducer(reducers.toggleTask);
  const setPhase = useReducer(reducers.setPhase);
  const setFraudAlertStatus = useReducer(reducers.setFraudAlertStatus);
  const setNotifyStatus = useReducer(reducers.setNotifyStatus);
  const completeLegalClock = useReducer(reducers.completeLegalClock);
  const stayInPhase = useReducer(reducers.stayInPhase);
  const logAdvisorAction = useReducer(reducers.logAdvisorAction);
  const notices = useNotices(incidentId);
  const [checked, setChecked] = useState(false);
  const [working, setWorking] = useState(false);

  // Live details of the target, read from the database right now (not from the AI).
  const id = /^\d+$/.test(action.ref) ? BigInt(action.ref) : null;
  const task = tasks.find(t => t.id === id);
  const alert = alerts.find(a => a.id === id);
  const clock = clocks.find(c => c.id === id);
  const notice = notices.find(n => n.id === action.ref);
  const detail =
    action.type === 'complete_task' ? (task ? `Task "${task.title}" (${PHASE_LABEL[task.phase] ?? task.phase}) is currently ${task.done ? 'done' : 'open'}.` : 'Task not found.')
    : action.type === 'set_phase' ? `Incident moves from ${PHASE_LABEL[incident?.phase ?? ''] ?? incident?.phase} to ${PHASE_LABEL[action.ref] ?? action.ref}.`
    : action.type === 'freeze_alert' || action.type === 'dismiss_alert' ? (alert ? `Fraud alert on account ${alert.accountRef}: $${(alert.amountCents / 100n).toLocaleString()}, ${alert.reason}. Currently ${alert.status}.` : 'Alert not found.')
    : action.type === 'file_deadline' ? (clock ? `Deadline "${clock.label}" due ${clock.deadlineAt.toDate().toLocaleString()}; currently ${clock.done ? 'filed' : 'open'}.` : 'Deadline not found.')
    : action.type.startsWith('mark_notice') ? (notice ? `Notice to ${notice.label} (${notice.people.toLocaleString()} people) is currently ${notice.status.replace('_', ' ')}.` : 'Notice not found.')
    : 'Cancels any automatic phase move and keeps the incident in the current phase.';
  const stale =
    (action.type === 'complete_task' && (!task || task.done)) ||
    ((action.type === 'freeze_alert' || action.type === 'dismiss_alert') && (!alert || alert.status !== 'open')) ||
    (action.type === 'file_deadline' && (!clock || clock.done)) ||
    (action.type.startsWith('mark_notice') && (!notice || notice.status === 'sent'));

  const perform = (): Promise<void> => {
    switch (action.type) {
      case 'complete_task': return toggleTask({ taskId: id! });
      case 'set_phase': return setPhase({ incidentId, phase: action.ref });
      case 'freeze_alert': return setFraudAlertStatus({ alertId: id!, status: 'frozen' });
      case 'dismiss_alert': return setFraudAlertStatus({ alertId: id!, status: 'dismissed' });
      case 'mark_notice_drafted': return setNotifyStatus({ incidentId, notice: action.ref, label: notice!.label, status: 'drafted' });
      case 'mark_notice_sent': return setNotifyStatus({ incidentId, notice: action.ref, label: notice!.label, status: 'sent' });
      case 'file_deadline': return completeLegalClock({ clockId: id! });
      case 'stay_in_phase': return stayInPhase({ incidentId });
      default: return Promise.reject(new Error('Unknown action'));
    }
  };

  const proceed = () => {
    setWorking(true);
    const p = perform();
    run(p, `Done: ${action.label}`);
    p.then(() => {
      run(logAdvisorAction({ incidentId, label: action.label }));
      onDone(`Done: ${action.label}. Recorded in the timeline as an advisor suggestion you confirmed.`);
      onClose();
    })
      .catch((e: unknown) => onDone(`Not done: ${action.label}. ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setWorking(false));
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-primary bg-card p-6">
        <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Step 2 of 2 · Confirm advisor action</p>
        <h2 id="confirm-title" className="flex items-start gap-2 text-lg">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-magenta" /> {action.label}
        </h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-mono text-xs text-muted-foreground uppercase">What will happen</dt>
            <dd>{detail}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted-foreground uppercase">Why the advisor suggests it</dt>
            <dd>{action.reason ? <Cited text={action.reason} /> : 'No reason given.'}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted-foreground uppercase">Runs as</dt>
            <dd>
              {me?.name} ({ROLE_LABEL[me?.role ?? ''] ?? me?.role}). The server checks your permission and records it in the audit log.
            </dd>
          </div>
        </dl>
        {stale && <p role="alert" className="text-sm font-semibold text-magenta">This is already done or no longer exists, so there is nothing to run.</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={stale} />
          I reviewed this and want to proceed.
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} autoFocus>Cancel</Button>
          <Button onClick={proceed} disabled={!checked || stale || working} className={cn(!checked && 'opacity-60')}>
            {working ? 'Working…' : 'Proceed'}
          </Button>
        </div>
      </div>
    </div>
  );
}
