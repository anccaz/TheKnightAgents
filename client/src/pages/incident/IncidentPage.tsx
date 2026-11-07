// Lane B owner: incident declaration, phase stepper, timeline, tasks, next steps.
import { useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { PHASES, PHASE_LABEL, SEVERITIES, useCurrentIncident } from '../../components/shared';

// Hardcoded guidance per phase (NIST 800-61 style). Lane B: refine wording with the bank's playbook.
const NEXT_STEPS: Record<string, string[]> = {
  detect: [
    'Confirm the alert is real (not a false alarm).',
    'Write down what you saw and when, in the timeline.',
    'Call the incident lead.',
  ],
  analyze: [
    'List every system and account that may be affected (What was hit).',
    'Save logs before anything is rebooted.',
    'Ask Legal to start the deadline clocks.',
  ],
  contain: [
    'Disconnect affected machines from the network. Do not turn them off.',
    'Reset passwords for exposed accounts.',
    'Freeze suspicious transfers in Fraud alerts.',
  ],
  eradicate: [
    'Remove the malware or attacker access.',
    'Patch the hole they came in through.',
    'Check that no backdoors are left.',
  ],
  recover: [
    'Restore from clean backups.',
    'Watch restored systems closely for 48 hours.',
    'Tell customers what happened, with Legal approval.',
  ],
  post_incident: [
    'Hold a blameless review meeting.',
    'Write down what to do better next time.',
    'Close all legal deadlines with proof of filing.',
  ],
};

export default function IncidentPage() {
  const incident = useCurrentIncident();
  if (!incident) return <DeclareForm />;
  return (
    <section>
      <h1>{incident.title}</h1>
      <PhaseStepper incidentId={incident.id} phase={incident.phase} />
      <div className="grid2">
        <NextSteps phase={incident.phase} />
        <Tasks incidentId={incident.id} phase={incident.phase} />
      </div>
      <Timeline incidentId={incident.id} />
    </section>
  );
}

function DeclareForm() {
  const createIncident = useReducer(reducers.createIncident);
  const run = useRun();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<string>('high');
  const [kind, setKind] = useState('ransomware');
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
    </form>
  );
}

function PhaseStepper({ incidentId, phase }: { incidentId: bigint; phase: string }) {
  const setPhase = useReducer(reducers.setPhase);
  const run = useRun();
  const idx = PHASES.indexOf(phase as (typeof PHASES)[number]);
  const next = PHASES[idx + 1];
  const go = (p: string) => run(setPhase({ incidentId, phase: p }), `Phase: ${PHASE_LABEL[p]}`);
  return (
    <div className="stepper">
      <ol>
        {PHASES.map((p, i) => (
          <li key={p} className={i < idx ? 'step done' : i === idx ? 'step current' : 'step'}>
            <button onClick={() => go(p)} aria-current={i === idx ? 'step' : undefined}>
              {i < idx ? '✓ ' : i === idx ? '▶ ' : ''}
              {PHASE_LABEL[p]}
            </button>
          </li>
        ))}
      </ol>
      {next && (
        <button className="primary big" onClick={() => go(next)}>
          Move to {PHASE_LABEL[next]}
        </button>
      )}
    </div>
  );
}

function NextSteps({ phase }: { phase: string }) {
  return (
    <div className="card">
      <h2>What do I do next?</h2>
      <ol>
        {(NEXT_STEPS[phase] ?? []).map(s => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function Tasks({ incidentId, phase }: { incidentId: bigint; phase: string }) {
  const [allTasks] = useTable(tables.task);
  const addTask = useReducer(reducers.addTask);
  const toggleTask = useReducer(reducers.toggleTask);
  const run = useRun();
  const [title, setTitle] = useState('');
  const tasks = allTasks.filter(t => t.incidentId === incidentId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(addTask({ incidentId, title, phase }));
    setTitle('');
  };
  return (
    <div className="card">
      <h2>Tasks</h2>
      {tasks.length === 0 && <p className="empty">No tasks yet: add one below.</p>}
      <ul className="checklist">
        {tasks.map(t => (
          <li key={t.id.toString()}>
            <label>
              <input type="checkbox" checked={t.done} onChange={() => run(toggleTask({ taskId: t.id }))} />
              {t.title}{' '}
              <span className="muted">
                ({PHASE_LABEL[t.phase] ?? t.phase}
                {t.done ? ', done' : ''})
              </span>
            </label>
          </li>
        ))}
      </ul>
      <form className="inline" onSubmit={submit}>
        <label className="sr-only" htmlFor="new-task">New task</label>
        <input id="new-task" required value={title} onChange={e => setTitle(e.target.value)} placeholder="New task" />
        <button type="submit">Add task</button>
      </form>
    </div>
  );
}

function Timeline({ incidentId }: { incidentId: bigint }) {
  const [events] = useTable(tables.timelineEvent);
  const [users] = useTable(tables.user);
  const addTimelineEvent = useReducer(reducers.addTimelineEvent);
  const run = useRun();
  const [text, setText] = useState('');
  const rows = events.filter(e => e.incidentId === incidentId).sort((a, b) => (a.id < b.id ? 1 : -1));
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? hex.slice(0, 8);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(addTimelineEvent({ incidentId, kind: 'note', text }));
    setText('');
  };
  return (
    <div className="card">
      <h2>Timeline</h2>
      <form className="inline" onSubmit={submit}>
        <label className="sr-only" htmlFor="new-note">Add a note</label>
        <input id="new-note" required value={text} onChange={e => setText(e.target.value)} placeholder="What just happened?" />
        <button type="submit">Add note</button>
      </form>
      {rows.length === 0 && <p className="empty">No events yet.</p>}
      <ul className="timeline">
        {rows.map(ev => (
          <li key={ev.id.toString()}>
            <time>{ev.at.toDate().toLocaleTimeString()}</time> <span className="tag">{ev.kind}</span> {ev.text}{' '}
            <span className="muted">by {nameOf(ev.actor.toHexString())}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
