// Lane B owner: incident declaration, phase stepper, timeline, tasks, next steps.
import { useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { LEADS, PHASES, PHASE_LABEL, SCOPE_LABEL, SEVERITIES, WRITERS, can, useCurrentIncident, useMe } from '../../components/shared';

// Guided steps live on the server now: declaring an incident or changing phase creates them as tasks.

const KIND_LABEL: Record<string, string> = {
  note: 'Note',
  phase_change: 'Phase',
  scope_change: 'What was hit',
  action: 'Action',
  ioc: 'Clue',
  auto: '⚡ Auto',
};

export default function IncidentPage() {
  const incident = useCurrentIncident();
  if (!incident) return <DeclareForm />;
  return (
    <section>
      <div className="title-row">
        <h1>{incident.title}</h1>
        <DrillControls />
      </div>
      <PhaseStepper incidentId={incident.id} phase={incident.phase} />
      <div className="grid2">
        <Tasks incidentId={incident.id} phase={incident.phase} />
        <Timeline incidentId={incident.id} />
      </div>
    </section>
  );
}

function DeclareForm() {
  const me = useMe();
  const createIncident = useReducer(reducers.createIncident);
  const run = useRun();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<string>('high');
  const [kind, setKind] = useState('ransomware');

  if (!can(me, LEADS))
    return <p className="empty">No incident yet. Only an incident lead can declare one: call yours now.</p>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(createIncident({ title, severity, kind }), 'Incident declared');
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h1>No incident yet</h1>
      <p>Something wrong? Declare an incident so the whole team sees it.</p>
      <label>
        What is happening?{' '}
        <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Ransomware on branch servers" />
      </label>
      <label>
        How bad?
        <select value={severity} onChange={e => setSeverity(e.target.value)}>
          {SEVERITIES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        Type
        <select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="ransomware">Ransomware</option>
          <option value="phishing">Phishing</option>
          <option value="data_theft">Data theft</option>
          <option value="other">Other</option>
        </select>
      </label>
      <button className="primary big" type="submit">Declare incident</button>
      <p className="muted">Practising? <DrillControls /></p>
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
    <div className="stepper">
      <ol>
        {PHASES.map((p, i) => (
          <li key={p} className={i < idx ? 'step done' : i === idx ? 'step current' : 'step'}>
            <button onClick={() => go(p, i)} disabled={!lead || i === idx} aria-current={i === idx ? 'step' : undefined}>
              {i < idx ? '✓ ' : i === idx ? '▶ ' : ''}
              {PHASE_LABEL[p]}
            </button>
          </li>
        ))}
      </ol>
      {next && lead && (
        <button className="primary big" onClick={() => go(next, idx + 1)}>
          Done with {PHASE_LABEL[phase]}: move to {PHASE_LABEL[next]}
        </button>
      )}
      {!lead && <span className="muted">Only the incident lead moves phases.</span>}
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
    <span className="actions">
      <button type="button" onClick={() => window.confirm('Start a live attack drill? A scripted attack plays out over ~90 seconds.') && run(startDrill(), 'Drill started')}>
        ▶ Run 2 AM drill
      </button>
      <button type="button" onClick={() => run(stopDrill(), 'Drill stopped')}>■ Stop drill</button>
    </span>
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
  const open = tasks.filter(t => !t.done).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(addTask({ incidentId, title, phase }));
    setTitle('');
  };
  return (
    <div className="card">
      <h2>What do I do next? {tasks.length > 0 && <span className="muted">({open} open)</span>}</h2>
      {tasks.length === 0 && <p className="empty">No tasks yet: add your own below.</p>}
      <ul className="checklist">
        {tasks.map(t => (
          <li key={t.id.toString()}>
            <label>
              <input type="checkbox" checked={t.done} disabled={!writer} onChange={() => run(toggleTask({ taskId: t.id }))} />
              <span style={t.done ? { textDecoration: 'line-through' } : undefined}>{t.title}</span>{' '}
              {t.phase !== phase && <span className="muted">({PHASE_LABEL[t.phase] ?? t.phase})</span>}
            </label>
          </li>
        ))}
      </ul>
      {writer && (
        <form className="inline" onSubmit={submit}>
          <label className="sr-only" htmlFor="new-task">New task</label>
          <input id="new-task" required value={title} onChange={e => setTitle(e.target.value)} placeholder="New task" />
          <button type="submit">Add task</button>
        </form>
      )}
    </div>
  );
}

function Timeline({ incidentId }: { incidentId: bigint }) {
  const me = useMe();
  const [events] = useTable(tables.timelineEvents);
  const [users] = useTable(tables.members);
  const addTimelineEvent = useReducer(reducers.addTimelineEvent);
  const run = useRun();
  const [text, setText] = useState('');
  const rows = events.filter(e => e.incidentId === incidentId).sort((a, b) => (a.id < b.id ? 1 : -1));
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? 'Breach Room';
  // Phase changes are stored as "detect -> analyze"; show plain labels.
  const show = (kind: string, t: string) =>
    kind === 'phase_change'
      ? t.split(' -> ').map(p => PHASE_LABEL[p] ?? p).join(' → ')
      : kind === 'scope_change'
        ? t.replace(/: (\w+)$/, (_, st) => `: ${SCOPE_LABEL[st] ?? st}`)
        : t;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(addTimelineEvent({ incidentId, kind: 'note', text }));
    setText('');
  };
  return (
    <div className="card">
      <h2>Timeline</h2>
      {can(me, WRITERS) && (
        <form className="inline" onSubmit={submit}>
          <label className="sr-only" htmlFor="new-note">Add a note</label>
          <input id="new-note" required value={text} onChange={e => setText(e.target.value)} placeholder="What just happened?" />
          <button type="submit">Add note</button>
        </form>
      )}
      {rows.length === 0 && <p className="empty">No events yet.</p>}
      <ul className="timeline">
        {rows.map(ev => (
          <li key={ev.id.toString()} className={ev.kind === 'auto' ? 'auto' : undefined}>
            <time>{ev.at.toDate().toLocaleTimeString()}</time> <span className="tag">{KIND_LABEL[ev.kind] ?? ev.kind}</span>{' '}
            {show(ev.kind, ev.text)} <span className="muted">by {nameOf(ev.actor.toHexString())}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
