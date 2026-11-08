// Knight Agent as the room's guide: it asks the next question in the thread and you answer with a button.
import { useState, type ReactNode } from 'react';
import type { Identity } from 'spacetimedb';
import { useProcedure, useReducer, useTable } from 'spacetimedb/react';
import { Check, Download, ShieldCheck, Zap } from 'lucide-react';
import { procedures, reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { LEADS, PHASES, PHASE_LABEL, SIGNOFF_TASKS, WRITERS, can, useCurrentIncident, useMe } from '@/components/shared';
import { Button } from '@/components/ui/button';

type Incident = NonNullable<ReturnType<typeof useCurrentIncident>>;
export type Ask = { type: 'ask'; key: string; at: Date; question: string; answer: string | null };

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const PRIMARY = 'rounded-full bg-gradient-to-r from-sky-500 to-violet-600 text-white hover:opacity-90';

/** A message from Knight Agent itself. */
function AgentBubble({ live, children, actions }: { live?: boolean; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex max-w-[90%] items-start gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-violet-600 text-white shadow-lg shadow-violet-500/30" aria-hidden="true">
        <ShieldCheck className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <b className="text-sky-200">Knight Agent</b>
          {live && <span className="rounded-full bg-sky-500/15 px-2 text-[10px] font-semibold tracking-wider text-sky-300 uppercase">now</span>}
        </span>
        <div className="rounded-2xl rounded-tl-md border border-sky-400/25 bg-gradient-to-br from-sky-500/10 to-violet-500/10 px-4 py-3 text-sm">
          {children}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** What Knight Agent is asking right now: the Nessie import, the next step or sign-off, or the phase move. */
export function AgentPrompts({ incident }: { incident: Incident }) {
  const me = useMe();
  const [tasks] = useTable(tables.tasks);
  const [signoffs] = useTable(tables.signoffs);
  const [cursors] = useTable(tables.nessieCursors);
  const [users] = useTable(tables.members);
  const toggleTask = useReducer(reducers.toggleTask);
  const signOffTask = useReducer(reducers.signOffTask);
  const setPhase = useReducer(reducers.setPhase);
  const runAutopilot = useReducer(reducers.runAutopilot);
  const importFromNessie = useProcedure(procedures.importFromNessie);
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const lead = can(me, LEADS);
  const writer = can(me, WRITERS);
  const phase = incident.phase;
  const label = PHASE_LABEL[phase] ?? phase;
  const next = PHASES[PHASES.indexOf(phase as (typeof PHASES)[number]) + 1];
  const open = tasks.filter(t => t.incidentId === incident.id && t.phase === phase && !t.done).sort((a, b) => (a.id < b.id ? -1 : 1));
  const nameOf = (who: Identity) => users.find(u => u.identity.isEqual(who))?.name ?? 'Autopilot';
  const out: ReactNode[] = [];

  if (phase === 'post_incident')
    return (
      <li>
        <AgentBubble live>That's the whole response. The after-action summary above shows how it went, and everything is on the record.</AgentBubble>
      </li>
    );

  const cur = cursors.find(c => c.incidentId === incident.id);
  const checkNext = () => {
    setBusy(true);
    run(importFromNessie({ incidentId: incident.id }).finally(() => setBusy(false)), 'Nessie import finished');
  };
  if (lead && cur)
    out.push(
      <AgentBubble
        key="nessie"
        live
        actions={
          <>
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy || cur.checked >= cur.total} onClick={checkNext}>
              <Download /> {busy ? 'Reading Nessie…' : 'Check next accounts'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() =>
                window.confirm('Run autopilot on this Nessie data? The robot responder works through every phase on its own (drills only).') &&
                run(runAutopilot({ incidentId: incident.id }), 'Autopilot running on Nessie data')
              }
            >
              <Zap /> Run autopilot on this data
            </Button>
          </>
        }
      >
        Nessie: I've checked <b>{cur.checked} of {cur.total}</b> bank accounts so far. Want me to scan the next batch, or run the whole response on autopilot with this data?
      </AgentBubble>
    );
  if (lead && !cur)
    out.push(
      <AgentBubble
        key="nessie"
        live
        actions={
          <Button
            size="sm"
            className={PRIMARY}
            disabled={busy}
            onClick={checkNext}
          >
            {busy ? 'Reading Nessie…' : 'Import from Nessie'}
          </Button>
        }
      >
        Want me to pull the bank's customers and transactions from <b>Nessie (Capital One)</b>? I'll work out who is affected in each state and flag suspicious money moves.
      </AgentBubble>
    );

  const task = open[0];
  if (task) {
    const left = open.length > 1 ? ` (${open.length - 1} more after this)` : '';
    if (SIGNOFF_TASKS.has(task.title)) {
      const so = signoffs.find(s => s.taskId === task.id);
      const mineDone = !!so && !!me && so.doneBy.isEqual(me.identity);
      if (!so)
        out.push(
          <AgentBubble
            key="task"
            live
            actions={writer && <Button size="sm" className={PRIMARY} onClick={() => run(signOffTask({ taskId: task.id }), 'Marked done: waiting for verification')}>I did this</Button>}
          >
            Next: <b>{task.title}</b>{left}. This one needs two people: one does it, a different lead verifies it.
          </AgentBubble>
        );
      else if (mineDone)
        out.push(
          <AgentBubble key="task" live actions={<Button size="sm" variant="outline" className="rounded-full" onClick={() => run(signOffTask({ taskId: task.id }), 'Sign-off withdrawn')}>Undo</Button>}>
            Thanks. <b>{task.title}</b> is waiting for a different lead to verify it.
          </AgentBubble>
        );
      else
        out.push(
          <AgentBubble
            key="task"
            live
            actions={
              lead && (
                <Button size="sm" className={PRIMARY} onClick={() => window.confirm(`Verify "${task.title}"? You confirm you checked it yourself.`) && run(signOffTask({ taskId: task.id }), 'Verified')}>
                  Verify
                </Button>
              )
            }
          >
            {nameOf(so.doneBy)} says <b>{task.title}</b> is done. {lead ? 'Can you check it and verify?' : 'Waiting for a lead to verify.'}
          </AgentBubble>
        );
    } else
      out.push(
        <AgentBubble
          key="task"
          live
          actions={
            writer && (
              <Button size="sm" className={PRIMARY} onClick={() => run(toggleTask({ taskId: task.id }), 'Done')}>
                <Check /> Done
              </Button>
            )
          }
        >
          Next in {label}: <b>{task.title}</b>{left}.
        </AgentBubble>
      );
  } else if (next)
    out.push(
      <AgentBubble
        key="phase"
        live
        actions={
          lead && (
            <Button size="sm" className={PRIMARY} onClick={() => run(setPhase({ incidentId: incident.id, phase: next }), `Phase: ${PHASE_LABEL[next]}`)}>
              Move to {PHASE_LABEL[next]} →
            </Button>
          )
        }
      >
        Everything in {label} is done. Ready to move to <b>{PHASE_LABEL[next]}</b>?
        {next === 'contain' && ' Flagged transfers of $10,000 or more will freeze automatically.'}
        {!lead && ' The incident lead makes this call.'}
      </AgentBubble>
    );
  return (
    <>
      {out.map((node, i) => (
        <li key={i}>{node}</li>
      ))}
    </>
  );
}

/** The bank data the Nessie import found, as one message with small bars. */
export function NessieCard({ incidentId, at }: { incidentId: bigint; at: Date }) {
  const [cursors] = useTable(tables.nessieCursors);
  const [states] = useTable(tables.stateImpacts);
  const [scope] = useTable(tables.scopeItems);
  const [alerts] = useTable(tables.fraudAlerts);
  const cur = cursors.find(c => c.incidentId === incidentId);
  const customers = scope.find(s => s.incidentId === incidentId && s.assetRef === 'nessie-customers')?.recordsCount ?? 0n;
  const byState = states.filter(s => s.incidentId === incidentId && s.records > 0n).sort((a, b) => Number(b.records - a.records));
  const max = byState[0]?.records ?? 1n;
  const suspicious = alerts.filter(a => a.incidentId === incidentId && /^(withdrawal|bill):/.test(a.transferRef)).sort((a, b) => Number(b.amountCents - a.amountCents));
  const flagged = suspicious.length;
  return (
    <AgentBubble>
      <div className="mb-2 text-xs text-muted-foreground">Bank data from Nessie (Capital One) · {time(at)}</div>
      <p>
        {customers > 0n ? (
          <>
            <b>{customers.toLocaleString()} customers</b> affected in {byState.length} states.{' '}
          </>
        ) : (
          'Customer data imported. '
        )}
        {cur && `I've checked ${cur.checked} of ${cur.total} accounts`}
        {flagged > 0 && (
          <>
            {' '}and found <b className="text-amber-300">{flagged} suspicious transactions</b>
          </>
        )}
        .
      </p>
      {byState.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {byState.slice(0, 5).map(s => (
            <li key={s.state} className="grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 text-xs">
              <span className="font-mono">{s.state}</span>
              <span className="h-2 rounded-full bg-white/5">
                <span className="block h-2 rounded-full bg-gradient-to-r from-sky-400 to-violet-500" style={{ width: `${Math.max(4, Number((s.records * 100n) / max))}%` }} />
              </span>
              <span className="text-right font-mono text-muted-foreground">{s.records.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {flagged > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-2 text-xs">
          {suspicious.slice(0, 4).map(a => (
            <li key={`${a.id}`} className="flex flex-wrap items-baseline gap-x-2">
              <b className="font-mono text-amber-300">${(a.amountCents / 100n).toLocaleString()}</b>
              <code className="font-mono">{a.accountRef}</code>
              <span className="min-w-0 flex-1 text-muted-foreground">{a.reason}</span>
              <span className={a.status === 'frozen' ? 'text-sky-300' : 'text-muted-foreground'}>{a.status === 'frozen' ? '❄ frozen' : a.status === 'dismissed' ? 'fine' : 'open'}</span>
            </li>
          ))}
        </ul>
      )}
    </AgentBubble>
  );
}

/** An "@agent ..." question and the advisor's answer (kept on this screen only). */
export function AskBubbles({ it }: { it: Ask }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
        <span className="text-xs text-muted-foreground">You asked · {time(it.at)}</span>
        <p className="rounded-2xl rounded-br-md bg-gradient-to-br from-sky-500 to-violet-600 px-4 py-2 text-sm text-white">@agent {it.question}</p>
      </div>
      <AgentBubble>
        {it.answer ?? (
          <span className="inline-flex gap-1" aria-label="Thinking">
            <span className="size-1.5 animate-bounce rounded-full bg-sky-300" />
            <span className="size-1.5 animate-bounce rounded-full bg-sky-300 [animation-delay:120ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-sky-300 [animation-delay:240ms]" />
          </span>
        )}
      </AgentBubble>
    </div>
  );
}
