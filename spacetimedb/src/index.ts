// Knight Agent: SpacetimeDB module. This file IS the data contract.
// Only Lane A edits table definitions; others ask A for new fields.
import { schema, table, t, SenderError, ScheduleAt } from 'spacetimedb/server';
import { Timestamp, TimeDuration } from 'spacetimedb';
import { ADVISOR_SCHEMA, advisorPrompt, checkReply, left, ruleBasedReply, type AdvisorFacts } from './advisor';
import { NESSIE_BASE, accountLabel, batch, countByState, isSuspicious, normalizeActivity, type Activity, type NessieAccount, type NessieCustomer } from './nessie';

// ---------- Enums (kept as strings; validated in reducers) ----------
const ROLES = ['admin', 'incident_lead', 'responder', 'legal', 'exec_viewer'] as const;
const PHASES = ['detect', 'analyze', 'contain', 'eradicate', 'recover', 'post_incident'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const SCOPE_STATUSES = ['encrypted', 'exfiltrated', 'accessed', 'unknown', 'clear'] as const;
const FRAUD_STATUSES = ['open', 'frozen', 'dismissed'] as const;
const NOTICE_STATUSES = ['not_started', 'drafted', 'sent'] as const;
const PRIVILEGED_ROLES = ['admin', 'incident_lead', 'legal'];

// Every table is private. Clients read only through the views at the bottom,
// which return nothing to non-members and filter by role.
const owner = table(
  {},
  {
    id: t.u8().primaryKey(), // always 0: single row
    identity: t.identity(),
  }
);

const user = table(
  {},
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    email: t.string(),
    role: t.string(),
    online: t.bool(),
    createdAt: t.timestamp(),
  }
);

const incident = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    severity: t.string(),
    kind: t.string(), // e.g. ransomware, phishing, data_theft
    phase: t.string(),
    detectedAt: t.timestamp(),
    createdBy: t.identity(),
  }
);

const timelineEvent = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    at: t.timestamp(),
    actor: t.identity(),
    kind: t.string(), // note, phase_change, ioc, action, scope_change
    text: t.string(),
  }
);

const scopeItem = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    assetType: t.string(), // system | customer | account
    assetRef: t.string(), // Nessie _id or system hostname
    label: t.string(),
    status: t.string(),
    recordsCount: t.u64(),
    updatedAt: t.timestamp(),
    updatedBy: t.identity(),
  }
);

const task = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    title: t.string(),
    phase: t.string(),
    done: t.bool(),
    createdBy: t.identity(),
  }
);

const channel = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    name: t.string(),
    privileged: t.bool(), // attorney-client privileged
  }
);

const message = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64().index(),
    sender: t.identity(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

const legalClock = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    regime: t.string(), // sec_8k, gdpr, tx_breach, ...
    label: t.string(),
    startedAt: t.timestamp(),
    deadlineAt: t.timestamp(),
    done: t.bool(),
  }
);

const fraudAlert = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    accountRef: t.string(),
    transferRef: t.string(),
    amountCents: t.u64(),
    reason: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
  }
);

const auditLog = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    actor: t.identity(),
    action: t.string(),
    detail: t.string(),
  }
);

// Stolen customers counted by US state: drives the notification map.
// Filled by the Nessie importer (Lane C) from customer addresses, or by the drill.
const stateImpact = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    state: t.string(), // 2-letter code
    records: t.u64(),
    since: t.timestamp(), // when these records were first known stolen; deadlines count from here
  }
);

// Progress on each notice the bank owes (e.g. "TX-Customers", "TX-Attorney General", "clock-3").
const notifyStatus = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    notice: t.string(),
    status: t.string(),
    updatedAt: t.timestamp(),
    updatedBy: t.identity(),
  }
);

// Pending automatic phase advance (fires unless the lead clicks "Stay here").
const phaseAdvance = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    incidentId: t.u64().index(),
    fromPhase: t.string(),
    toPhase: t.string(),
    at: t.timestamp(), // same moment as scheduledAt, readable by clients for the countdown
  }
);

// The lead chose to stay in this phase: no auto-advance until the phase changes.
const phaseHold = table({}, { incidentId: t.u64().primaryKey(), phase: t.string() });

// Autopilot drill ticks: each tick performs the next unfinished task of the current phase.
const autopilotStep = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    incidentId: t.u64(),
    tick: t.u32(),
  }
);

// Two-person sign-off on a task: one person does it, a different lead verifies it. The task is done only once verified.
const signoff = table(
  {},
  {
    taskId: t.u64().primaryKey(),
    incidentId: t.u64().index(),
    doneBy: t.identity(),
    doneAt: t.timestamp(),
    verifiedBy: t.identity().optional(),
    verifiedAt: t.timestamp().optional(),
  }
);

// Where the in-app Nessie import got to: each click scans the next batch of accounts (wrapping around).
const nessieCursor = table(
  {},
  {
    incidentId: t.u64().primaryKey(),
    offset: t.u32(),
    total: t.u32(), // accounts in Nessie at the last import
    at: t.timestamp(),
    checked: t.u32().default(0), // accounts checked so far (capped at total); last + default so existing rows migrate
  }
);

// Pending steps of a running attack drill; each row fires runDrillStep at its time.
const drillStep = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    incidentId: t.u64(),
    step: t.u32(),
  }
);

const db = schema(
  {
    owner,
    drillStep,
    stateImpact,
    notifyStatus,
    phaseAdvance,
    phaseHold,
    autopilotStep,
    signoff,
    nessieCursor,
    user,
    incident,
    timelineEvent,
    scopeItem,
    task,
    channel,
    message,
    legalClock,
    fraudAlert,
    auditLog,
  },
  {
    // Private database config, set at publish time (never in git or the client):
    //   GEMINI_API_KEY=... npm run publish:local
    // Optional so the module still publishes without it; draftNotice explains what to do if it is missing.
    env: {
      GEMINI_API_KEY: t.string().optional(),
      GEMINI_MODEL: t.string().optional(),
      NESSIE_API_KEY: t.string().optional(), // Capital One Nessie, for the in-app "Import from Nessie" button
    },
  }
);
export default db;

// ---------- Helpers ----------
type Ctx = Parameters<Parameters<typeof db.reducer>[1]>[0];

function oneOf(value: string, allowed: readonly string[], what: string) {
  if (!allowed.includes(value)) throw new SenderError(`Invalid ${what}: ${value}`);
}

function requireRole(ctx: Ctx, ...roles: string[]) {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (!me) throw new SenderError('Not a member. Send your ID to an admin.');
  if (roles.length && !roles.includes(me.role) && me.role !== 'admin')
    throw new SenderError(`Requires role: ${roles.join(' or ')}`);
  return me;
}

function requireIncident(ctx: Ctx, incidentId: bigint) {
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) throw new SenderError('No such incident');
  return inc;
}

function audit(ctx: Ctx, action: string, detail: string) {
  ctx.db.auditLog.insert({ id: 0n, at: ctx.timestamp, actor: ctx.sender, action, detail });
}

function timeline(ctx: Ctx, incidentId: bigint, kind: string, text: string) {
  ctx.db.timelineEvent.insert({ id: 0n, incidentId, at: ctx.timestamp, actor: ctx.sender, kind, text });
}

const WRITERS = ['incident_lead', 'responder'];

// ---------- Auto-rules (the app acts without a click) ----------
// Guided steps per phase (NIST SP 800-61 lifecycle, bank flavour); created as tasks automatically.
const GUIDED: Record<string, string[]> = {
  detect: [
    'Confirm the alert is real, not a false alarm',
    'Write what you saw and when in the timeline',
    'Page the incident lead and open this war room',
  ],
  analyze: [
    'List every affected system and customer in What was hit',
    'Copy logs and memory before anything is rebooted',
    'Confirm with Legal that the deadline clocks are right',
  ],
  contain: [
    'Unplug affected machines from the network, do not power them off',
    'Reset passwords and keys for exposed accounts',
    'Review every fraud alert: freeze or dismiss',
  ],
  eradicate: [
    'Remove the malware and every attacker login',
    'Patch the hole they came in through',
    'Scan again to confirm no backdoors are left',
  ],
  recover: [
    'Rebuild affected servers from clean, tested backups',
    'Verify cryptographic hashes of the rebuilt core banking container',
    'Confirm EDR clean scan on all isolated hosts',
    'Rotate enterprise service account keys',
    'Watch restored systems closely for 48 hours',
    'Send customer notices once Legal approves',
  ],
  post_incident: [
    'Hold a blameless review within two weeks',
    'Write down what to change next time',
    'Mark every legal deadline as filed',
  ],
};

// Tasks that need two people: one does it, a different incident lead or admin verifies it (Remove threat, Recover).
const SIGNOFF_TASKS = new Set([
  'Remove the malware and every attacker login',
  'Patch the hole they came in through',
  'Scan again to confirm no backdoors are left',
  'Rebuild affected servers from clean, tested backups',
  'Verify cryptographic hashes of the rebuilt core banking container',
  'Confirm EDR clean scan on all isolated hosts',
  'Rotate enterprise service account keys',
]);
const VERIFIERS = ['incident_lead']; // admins always pass requireRole

// Started automatically the first time data is marked stolen (our stand-in for "the bank determined it").
// NOT LEGAL ADVICE: checked against sources on 2026-11-07, Legal must re-verify before relying on them.
// - bank_regulator: OCC 12 CFR 53, Fed 12 CFR 225 subpart N, FDIC 12 CFR 304 subpart C (computer-security incident
//   notification rule, in force 2022-05-01): tell the primary federal regulator as soon as possible and no later than
//   36 hours after determining a "notification incident" occurred.
// - sec_8k: Form 8-K Item 1.05 (public companies only): 4 BUSINESS days after the incident is determined material,
//   not after discovery. We count 4 weekdays from now; federal holidays are not skipped.
// - tx_*: Tex. Bus. & Com. Code 521.053: individuals within 60 days (b); AG within 30 days if 250+ Texans (i).
const LEGAL_RULES: { regime: string; label: string; hours?: number; businessDays?: number; minRecords: bigint }[] = [
  { regime: 'bank_regulator', label: 'Bank regulator notice (36h, OCC/Fed/FDIC)', hours: 36, minRecords: 0n },
  { regime: 'sec_8k', label: 'SEC 8-K if material (4 business days)', businessDays: 4, minRecords: 0n },
  { regime: 'tx_ag', label: 'Texas AG notice, 250+ Texans (30 days)', hours: 720, minRecords: 250n },
  { regime: 'tx_customers', label: 'Customer notices, Texas (60 days)', hours: 1440, minRecords: 0n },
];

/** Hours from `from` until the same time-of-day `days` weekdays later (UTC; holidays not skipped). */
function businessDaysToHours(from: Timestamp, days: number) {
  const d = new Date(Number(from.microsSinceUnixEpoch / 1000n));
  let left = days, hours = 0;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    hours += 24;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return hours;
}

const AUTO_FREEZE_CENTS = 1_000_000n; // $10,000

function addGuidedTasks(ctx: Ctx, incidentId: bigint, phase: string) {
  const existing = new Set([...ctx.db.task.incidentId.filter(incidentId)].map(tk => tk.title));
  for (const title of GUIDED[phase] ?? [])
    if (!existing.has(title)) ctx.db.task.insert({ id: 0n, incidentId, title, phase, done: false, createdBy: ctx.sender });
}

function newIncident(ctx: Ctx, title: string, severity: string, kind: string) {
  const inc = ctx.db.incident.insert({
    id: 0n, title, severity, kind, phase: 'detect', detectedAt: ctx.timestamp, createdBy: ctx.sender,
  });
  for (const [name, privileged] of [['general', false], ['containment', false], ['legal', true], ['exec', false]] as const)
    ctx.db.channel.insert({ id: 0n, incidentId: inc.id, name, privileged });
  timeline(ctx, inc.id, 'note', `Incident declared: ${title} (${severity})`);
  addGuidedTasks(ctx, inc.id, 'detect');
  audit(ctx, 'create_incident', `${inc.id}: ${title}`);
  return inc;
}

function startClock(ctx: Ctx, incidentId: bigint, regime: string, label: string, hours: number) {
  const deadlineAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(hours) * 3_600_000_000n);
  ctx.db.legalClock.insert({ id: 0n, incidentId, regime, label, startedAt: ctx.timestamp, deadlineAt, done: false });
}

function autoLegalClocks(ctx: Ctx, incidentId: bigint) {
  const stolen = [...ctx.db.scopeItem.incidentId.filter(incidentId)]
    .filter(s => s.status === 'exfiltrated')
    .reduce((n, s) => n + s.recordsCount, 0n);
  const running = new Set([...ctx.db.legalClock.incidentId.filter(incidentId)].map(c => c.regime));
  for (const r of LEGAL_RULES) {
    if (running.has(r.regime) || stolen < r.minRecords) continue;
    startClock(ctx, incidentId, r.regime, r.label, r.hours ?? businessDaysToHours(ctx.timestamp, r.businessDays!));
    timeline(ctx, incidentId, 'auto', `Legal clock started: ${r.label} (${stolen.toLocaleString()} records stolen)`);
  }
}

type ScopeArgs = { incidentId: bigint; assetType: string; assetRef: string; label: string; status: string; recordsCount: bigint };
function setScope(ctx: Ctx, args: ScopeArgs) {
  oneOf(args.status, SCOPE_STATUSES, 'scope status');
  const existing = [...ctx.db.scopeItem.incidentId.filter(args.incidentId)].find(s => s.assetRef === args.assetRef);
  const row = { ...args, updatedAt: ctx.timestamp, updatedBy: ctx.sender };
  if (existing) ctx.db.scopeItem.id.update({ ...row, id: existing.id });
  else ctx.db.scopeItem.insert({ ...row, id: 0n });
  timeline(ctx, args.incidentId, 'scope_change', `${args.label}: ${args.status}`);
  if (args.status === 'exfiltrated') autoLegalClocks(ctx, args.incidentId);
}

// Freezing customer accounts is a containment decision: big transfers freeze automatically only once the
// incident is in Contain (or later). Before that they are flagged and freeze the moment the team reaches Contain.
const phaseIndex = (phase: string) => PHASES.indexOf(phase as (typeof PHASES)[number]);
const containing = (ctx: Ctx, incidentId: bigint) => phaseIndex(ctx.db.incident.id.find(incidentId)?.phase ?? '') >= phaseIndex('contain');
const dollars = (cents: bigint) => `$${(cents / 100n).toLocaleString()}`;

type AlertArgs = { incidentId: bigint; accountRef: string; transferRef: string; amountCents: bigint; reason: string };
function raiseAlert(ctx: Ctx, args: AlertArgs) {
  const big = args.amountCents >= AUTO_FREEZE_CENTS;
  const frozen = big && containing(ctx, args.incidentId);
  const a = ctx.db.fraudAlert.insert({ ...args, id: 0n, status: frozen ? 'frozen' : 'open', createdAt: ctx.timestamp });
  if (frozen) {
    timeline(ctx, args.incidentId, 'auto', `Account ${args.accountRef} frozen: ${dollars(args.amountCents)} transfer over the $10,000 limit`);
    audit(ctx, 'auto_freeze', `${a.id}: ${args.accountRef}`);
  } else if (big)
    timeline(ctx, args.incidentId, 'auto', `Fraud flagged on ${args.accountRef}: ${dollars(args.amountCents)} transfer. Freezes automatically when the team reaches Contain`);
}

/** On reaching Contain: freeze every open alert over the limit in one go. */
function freezeOnContain(ctx: Ctx, incidentId: bigint) {
  const due = [...ctx.db.fraudAlert.incidentId.filter(incidentId)].filter(a => a.status === 'open' && a.amountCents >= AUTO_FREEZE_CENTS);
  if (!due.length) return;
  for (const a of due) {
    ctx.db.fraudAlert.id.update({ ...a, status: 'frozen' });
    audit(ctx, 'auto_freeze', `${a.id}: ${a.accountRef}`);
  }
  const total = due.reduce((n, a) => n + a.amountCents, 0n);
  timeline(ctx, incidentId, 'auto', `Contain started: froze ${due.length} account${due.length === 1 ? '' : 's'} over the $10,000 limit (${dollars(total)}): ${due.map(a => a.accountRef).join(', ')}`);
}

// ---------- Exec status update: one plain-words line in the incident's #exec channel ----------
const PHASE_LABELS: Record<string, string> = {
  detect: 'Detect', analyze: 'Analyze', contain: 'Contain', eradicate: 'Remove threat', recover: 'Recover', post_incident: 'Lessons learned',
};

function execUpdate(ctx: Ctx, incidentId: bigint) {
  const inc = ctx.db.incident.id.find(incidentId);
  const exec = [...ctx.db.channel.incidentId.filter(incidentId)].find(c => c.name === 'exec');
  if (!inc || !exec) return;
  const parts = [`Phase: ${PHASE_LABELS[inc.phase] ?? inc.phase}`];
  const stolen = [...ctx.db.scopeItem.incidentId.filter(incidentId)]
    .filter(s => s.status === 'exfiltrated')
    .reduce((n, s) => n + s.recordsCount, 0n);
  if (stolen) parts.push(`${stolen.toLocaleString()} records stolen`);
  const clocks = [...ctx.db.legalClock.incidentId.filter(incidentId)];
  // Only exact counts here: per-state notice rules live in the client chart, so we report states, not "notices owed".
  const states = [...ctx.db.stateImpact.incidentId.filter(incidentId)].filter(s => s.records > 0n).length;
  const sent = [...ctx.db.notifyStatus.incidentId.filter(incidentId)].filter(n => n.status === 'sent').length;
  if (states) parts.push(`${states} ${states === 1 ? 'state' : 'states'} affected`);
  if (sent) parts.push(`${sent} ${sent === 1 ? 'notice' : 'notices'} sent`);
  const next = clocks.filter(c => !c.done).map(c => c.deadlineAt.microsSinceUnixEpoch).sort((a, b) => (a < b ? -1 : 1))[0];
  if (next !== undefined) {
    const mins = Number((next - ctx.timestamp.microsSinceUnixEpoch) / 60_000_000n);
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    parts.push(mins <= 0 ? 'a deadline has passed' : `next deadline in ${d ? `${d}d ${h}h` : `${h}h ${m}m`}`);
  }
  const frozen = [...ctx.db.fraudAlert.incidentId.filter(incidentId)]
    .filter(a => a.status === 'frozen')
    .reduce((n, a) => n + a.amountCents, 0n);
  if (frozen) parts.push(`$${(frozen / 100n).toLocaleString()} frozen`);
  ctx.db.message.insert({ id: 0n, channelId: exec.id, sender: ctx.sender, text: `Status update — ${parts.join(' · ')}`, sentAt: ctx.timestamp });
}

// ---------- Smart flow: tasks tick themselves, phases advance themselves ----------
// Guided tasks the system can verify on its own. Everything else stays a human judgement call.
const AUTO_TASKS: Record<string, (ctx: Ctx, id: bigint) => boolean> = {
  'Write what you saw and when in the timeline': (ctx, id) =>
    [...ctx.db.timelineEvent.incidentId.filter(id)].some(e => e.kind === 'ioc' || (e.kind === 'note' && !e.text.startsWith('Incident declared'))),
  'List every affected system and customer in What was hit': (ctx, id) => [...ctx.db.scopeItem.incidentId.filter(id)].length > 0,
  'Confirm with Legal that the deadline clocks are right': (ctx, id) => [...ctx.db.legalClock.incidentId.filter(id)].length > 0,
  'Review every fraud alert: freeze or dismiss': (ctx, id) => {
    const alerts = [...ctx.db.fraudAlert.incidentId.filter(id)];
    return alerts.length > 0 && !alerts.some(a => a.status === 'open');
  },
  'Send customer notices once Legal approves': (ctx, id) => {
    const states = [...ctx.db.stateImpact.incidentId.filter(id)].filter(s => s.records > 0n);
    const sent = new Set([...ctx.db.notifyStatus.incidentId.filter(id)].filter(n => n.status === 'sent').map(n => n.notice));
    return states.length > 0 && states.every(s => sent.has(`${s.state}-Customers`));
  },
  'Mark every legal deadline as filed': (ctx, id) => {
    const clocks = [...ctx.db.legalClock.incidentId.filter(id)];
    return clocks.length > 0 && clocks.every(c => c.done);
  },
};
const ADVANCE_SEC = 30;
const AUTOPILOT_ADVANCE_SEC = 3;
const isAutopilot = (title: string) => title.startsWith('AUTOPILOT');
const autopilotOn = (ctx: Ctx, incidentId: bigint) => [...ctx.db.autopilotStep.iter()].some(r => r.incidentId === incidentId);
const nextPhase = (phase: string) => PHASES[PHASES.indexOf(phase as (typeof PHASES)[number]) + 1];

function cancelAdvance(ctx: Ctx, incidentId: bigint, note?: string) {
  const pending = [...ctx.db.phaseAdvance.incidentId.filter(incidentId)];
  for (const p of pending) ctx.db.phaseAdvance.scheduledId.delete(p.scheduledId);
  if (pending.length && note) timeline(ctx, incidentId, 'auto', note);
}

/** Tick verifiable tasks, then start (or cancel) the auto-advance countdown. Call after anything that changes progress. */
function progress(ctx: Ctx, incidentId: bigint) {
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) return;
  for (const tk of [...ctx.db.task.incidentId.filter(incidentId)])
    if (tk.phase === inc.phase && !tk.done && AUTO_TASKS[tk.title]?.(ctx, incidentId)) {
      ctx.db.task.id.update({ ...tk, done: true });
      timeline(ctx, incidentId, 'auto', `Task done: ${tk.title}`);
    }
  const current = [...ctx.db.task.incidentId.filter(incidentId)].filter(tk => tk.phase === inc.phase);
  const ready = current.length > 0 && current.every(tk => tk.done);
  const to = nextPhase(inc.phase);
  const pending = [...ctx.db.phaseAdvance.incidentId.filter(incidentId)];
  if (!ready || !to) {
    if (pending.length) cancelAdvance(ctx, incidentId, `Auto-advance cancelled: ${PHASE_LABELS[inc.phase]} has open tasks again`);
    return;
  }
  if (pending.length || ctx.db.phaseHold.incidentId.find(incidentId)?.phase === inc.phase) return;
  const secs = isAutopilot(inc.title) || autopilotOn(ctx, incidentId) ? AUTOPILOT_ADVANCE_SEC : ADVANCE_SEC;
  const at = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(secs) * 1_000_000n);
  ctx.db.phaseAdvance.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at.microsSinceUnixEpoch), incidentId, fromPhase: inc.phase, toPhase: to, at });
  timeline(ctx, incidentId, 'auto', `All ${PHASE_LABELS[inc.phase]} tasks done: moving to ${PHASE_LABELS[to]} in ${secs} s unless the lead stays`);
}

function movePhase(ctx: Ctx, incidentId: bigint, phase: string) {
  const inc = ctx.db.incident.id.find(incidentId)!;
  ctx.db.incident.id.update({ ...inc, phase });
  timeline(ctx, incidentId, 'phase_change', `${inc.phase} -> ${phase}`);
  addGuidedTasks(ctx, incidentId, phase);
  audit(ctx, 'set_phase', `${incidentId}: ${phase}`);
  if (phaseIndex(phase) >= phaseIndex('contain')) freezeOnContain(ctx, incidentId);
  cancelAdvance(ctx, incidentId);
  const hold = ctx.db.phaseHold.incidentId.find(incidentId);
  if (hold && hold.phase !== phase) ctx.db.phaseHold.incidentId.delete(incidentId);
  execUpdate(ctx, incidentId);
  progress(ctx, incidentId);
}

function holdPhase(ctx: Ctx, incidentId: bigint, phase: string) {
  if (ctx.db.phaseHold.incidentId.find(incidentId)) ctx.db.phaseHold.incidentId.update({ incidentId, phase });
  else ctx.db.phaseHold.insert({ incidentId, phase });
}

// ---------- Lifecycle ----------
// Runs once on first publish; the sender is whoever published (the CLI identity).
export const init = db.init(ctx => {
  ctx.db.owner.insert({ id: 0, identity: ctx.sender });
});

export const onConnect = db.clientConnected(ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (me) ctx.db.user.identity.update({ ...me, online: true });
});

export const onDisconnect = db.clientDisconnected(ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (me) ctx.db.user.identity.update({ ...me, online: false });
});

// ---------- Access control (Lane A) ----------
/**
 * Admins (or the database owner, for the very first admin via `spacetime call`)
 * add a member by the ID the new person sees on their join screen. No shared secret.
 */
export const addMember = db.reducer(
  { target: t.identity(), name: t.string(), email: t.string(), role: t.string() },
  (ctx, { target, name, email, role }) => {
    const isOwner = ctx.db.owner.id.find(0)?.identity.isEqual(ctx.sender) ?? false;
    if (!isOwner) requireRole(ctx, 'admin');
    oneOf(role, ROLES, 'role');
    if (ctx.db.user.identity.find(target)) throw new SenderError('Already a member');
    ctx.db.user.insert({ identity: target, name, email, role, online: false, createdAt: ctx.timestamp });
    audit(ctx, 'add_member', `${email} as ${role}`);
  }
);

export const setRole = db.reducer({ target: t.identity(), role: t.string() }, (ctx, { target, role }) => {
  requireRole(ctx, 'admin');
  oneOf(role, ROLES, 'role');
  const u = ctx.db.user.identity.find(target);
  if (!u) throw new SenderError('No such user');
  if (u.role === 'admin' && role !== 'admin' && [...ctx.db.user.iter()].filter(x => x.role === 'admin').length === 1)
    throw new SenderError('Cannot remove the last admin');
  ctx.db.user.identity.update({ ...u, role });
  audit(ctx, 'set_role', `${u.email} -> ${role}`);
});

/** Revoke access at once (e.g. a responder's laptop is compromised mid-incident). Their views go empty immediately. */
export const removeMember = db.reducer({ target: t.identity() }, (ctx, { target }) => {
  requireRole(ctx, 'admin');
  const u = ctx.db.user.identity.find(target);
  if (!u) throw new SenderError('No such user');
  if (u.role === 'admin' && [...ctx.db.user.iter()].filter(x => x.role === 'admin').length === 1)
    throw new SenderError('Cannot remove the last admin');
  ctx.db.user.identity.delete(target);
  audit(ctx, 'remove_member', `${u.email} (${u.role}) removed`);
});

// ---------- Incidents & timeline (Lane B) ----------
export const createIncident = db.reducer(
  { title: t.string(), severity: t.string(), kind: t.string() },
  (ctx, { title, severity, kind }) => {
    requireRole(ctx, 'incident_lead');
    oneOf(severity, SEVERITIES, 'severity');
    newIncident(ctx, title, severity, kind);
  }
);

export const setPhase = db.reducer({ incidentId: t.u64(), phase: t.string() }, (ctx, { incidentId, phase }) => {
  requireRole(ctx, 'incident_lead');
  oneOf(phase, PHASES, 'phase');
  const inc = requireIncident(ctx, incidentId);
  // Going back on purpose means "work this phase again": don't auto-advance out of it.
  if (PHASES.indexOf(phase as (typeof PHASES)[number]) < PHASES.indexOf(inc.phase as (typeof PHASES)[number])) holdPhase(ctx, incidentId, phase);
  movePhase(ctx, incidentId, phase);
});

export const stayInPhase = db.reducer({ incidentId: t.u64() }, (ctx, { incidentId }) => {
  const me = requireRole(ctx, 'incident_lead');
  const inc = requireIncident(ctx, incidentId);
  holdPhase(ctx, incidentId, inc.phase);
  cancelAdvance(ctx, incidentId, `${me.name} chose to stay in ${PHASE_LABELS[inc.phase]}`);
});

export const runPhaseAdvance = db.reducer({ onSchedule: phaseAdvance }, { row: phaseAdvance.rowType }, (ctx, { row }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('Phase advance runs on the schedule only');
  const inc = ctx.db.incident.id.find(row.incidentId);
  if (!inc || inc.phase !== row.fromPhase) return;
  const current = [...ctx.db.task.incidentId.filter(row.incidentId)].filter(tk => tk.phase === inc.phase);
  if (current.some(tk => !tk.done)) return;
  movePhase(ctx, row.incidentId, row.toPhase);
});

export const addTimelineEvent = db.reducer(
  { incidentId: t.u64(), kind: t.string(), text: t.string() },
  (ctx, { incidentId, kind, text }) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, incidentId);
    timeline(ctx, incidentId, kind, text);
    progress(ctx, incidentId);
  }
);

export const addTask = db.reducer(
  { incidentId: t.u64(), title: t.string(), phase: t.string() },
  (ctx, { incidentId, title, phase }) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, incidentId);
    oneOf(phase, PHASES, 'phase');
    ctx.db.task.insert({ id: 0n, incidentId, title, phase, done: false, createdBy: ctx.sender });
    progress(ctx, incidentId);
  }
);

export const toggleTask = db.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  requireRole(ctx, ...WRITERS);
  const tk = ctx.db.task.id.find(taskId);
  if (!tk) throw new SenderError('No such task');
  if (SIGNOFF_TASKS.has(tk.title)) throw new SenderError('This task needs a sign-off: mark it done, then a different lead verifies it');
  ctx.db.task.id.update({ ...tk, done: !tk.done });
  progress(ctx, tk.incidentId);
});

/**
 * Two-person rule. First call: a responder or lead says "I did it". Second call: a DIFFERENT incident lead or admin
 * verifies it, and only then is the task done. The person who did it can withdraw before it is verified.
 */
export const signOffTask = db.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  const me = requireRole(ctx, ...WRITERS);
  const tk = ctx.db.task.id.find(taskId);
  if (!tk) throw new SenderError('No such task');
  if (!SIGNOFF_TASKS.has(tk.title)) throw new SenderError('This task does not need a sign-off');
  const so = ctx.db.signoff.taskId.find(taskId);
  if (!so) {
    ctx.db.signoff.insert({ taskId, incidentId: tk.incidentId, doneBy: ctx.sender, doneAt: ctx.timestamp, verifiedBy: undefined, verifiedAt: undefined });
    timeline(ctx, tk.incidentId, 'action', `${me.name} marked done, waiting for verification: ${tk.title}`);
    audit(ctx, 'signoff_done', `${taskId}: ${tk.title}`);
  } else if (so.verifiedBy) {
    throw new SenderError('Already verified');
  } else if (so.doneBy.isEqual(ctx.sender)) {
    ctx.db.signoff.taskId.delete(taskId); // withdraw before anyone verified it
    timeline(ctx, tk.incidentId, 'action', `${me.name} withdrew their sign-off: ${tk.title}`);
    audit(ctx, 'signoff_withdrawn', `${taskId}: ${tk.title}`);
  } else {
    requireRole(ctx, ...VERIFIERS);
    ctx.db.signoff.taskId.update({ ...so, verifiedBy: ctx.sender, verifiedAt: ctx.timestamp });
    ctx.db.task.id.update({ ...tk, done: true });
    timeline(ctx, tk.incidentId, 'action', `${me.name} verified: ${tk.title}`);
    audit(ctx, 'signoff_verified', `${taskId}: ${tk.title}`);
  }
  progress(ctx, tk.incidentId);
});

// ---------- Comms (Lane B) ----------
export const sendMessage = db.reducer({ channelId: t.u64(), text: t.string() }, (ctx, { channelId, text }) => {
  const me = requireRole(ctx);
  const ch = ctx.db.channel.id.find(channelId);
  if (!ch) throw new SenderError('No such channel');
  if (ch.privileged && !PRIVILEGED_ROLES.includes(me.role)) throw new SenderError('Privileged channel');
  if (!text.trim()) throw new SenderError('Empty message');
  ctx.db.message.insert({ id: 0n, channelId, sender: ctx.sender, text, sentAt: ctx.timestamp });
});

// ---------- Scope (Lane C) ----------
export const upsertScopeItem = db.reducer(
  {
    incidentId: t.u64(),
    assetType: t.string(),
    assetRef: t.string(),
    label: t.string(),
    status: t.string(),
    recordsCount: t.u64(),
  },
  (ctx, args) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, args.incidentId);
    setScope(ctx, args);
    progress(ctx, args.incidentId);
  }
);

// ---------- Fraud watch (Lane C) ----------
export const raiseFraudAlert = db.reducer(
  { incidentId: t.u64(), accountRef: t.string(), transferRef: t.string(), amountCents: t.u64(), reason: t.string() },
  (ctx, args) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, args.incidentId);
    raiseAlert(ctx, args);
    progress(ctx, args.incidentId);
  }
);

export const setFraudAlertStatus = db.reducer({ alertId: t.u64(), status: t.string() }, (ctx, { alertId, status }) => {
  requireRole(ctx, ...WRITERS);
  oneOf(status, FRAUD_STATUSES, 'fraud status');
  const a = ctx.db.fraudAlert.id.find(alertId);
  if (!a) throw new SenderError('No such alert');
  ctx.db.fraudAlert.id.update({ ...a, status });
  timeline(ctx, a.incidentId, 'action', `Fraud alert ${alertId} on ${a.accountRef}: ${status}`);
  audit(ctx, 'fraud_alert_status', `${alertId}: ${status}`);
  progress(ctx, a.incidentId);
});

// ---------- Legal clocks (Lane D) ----------
export const startLegalClock = db.reducer(
  { incidentId: t.u64(), regime: t.string(), label: t.string(), hours: t.u32() },
  (ctx, { incidentId, regime, label, hours }) => {
    requireRole(ctx, 'legal', 'incident_lead');
    requireIncident(ctx, incidentId);
    startClock(ctx, incidentId, regime, label, hours);
    timeline(ctx, incidentId, 'action', `Legal clock started: ${label}`);
    progress(ctx, incidentId);
  }
);

export const completeLegalClock = db.reducer({ clockId: t.u64() }, (ctx, { clockId }) => {
  requireRole(ctx, 'legal', 'incident_lead');
  const c = ctx.db.legalClock.id.find(clockId);
  if (!c) throw new SenderError('No such clock');
  ctx.db.legalClock.id.update({ ...c, done: true });
  audit(ctx, 'complete_legal_clock', c.label);
  progress(ctx, c.incidentId);
});

function setStateRecords(ctx: Ctx, incidentId: bigint, state: string, records: bigint) {
  const code = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new SenderError(`Invalid state: ${state}`);
  const existing = [...ctx.db.stateImpact.incidentId.filter(incidentId)].find(r => r.state === code);
  if (existing) ctx.db.stateImpact.id.update({ ...existing, records });
  else ctx.db.stateImpact.insert({ id: 0n, incidentId, state: code, records, since: ctx.timestamp });
}

export const setStateImpact = db.reducer(
  { incidentId: t.u64(), state: t.string(), records: t.u64() },
  (ctx, { incidentId, state, records }) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, incidentId);
    setStateRecords(ctx, incidentId, state, records);
  }
);

function setNotice(ctx: Ctx, incidentId: bigint, notice: string, label: string, status: string) {
  oneOf(status, NOTICE_STATUSES, 'notice status');
  const existing = [...ctx.db.notifyStatus.incidentId.filter(incidentId)].find(n => n.notice === notice);
  const row = { incidentId, notice, status, updatedAt: ctx.timestamp, updatedBy: ctx.sender };
  if (existing) ctx.db.notifyStatus.id.update({ ...row, id: existing.id });
  else ctx.db.notifyStatus.insert({ ...row, id: 0n });
  timeline(ctx, incidentId, 'action', `Notice ${status === 'sent' ? 'sent' : status === 'drafted' ? 'drafted' : 'reopened'}: ${label}`);
  if (status === 'sent') {
    audit(ctx, 'notice_sent', label);
    execUpdate(ctx, incidentId); // Lane B: post a status line to #exec
  }
}

export const setNotifyStatus = db.reducer(
  { incidentId: t.u64(), notice: t.string(), label: t.string(), status: t.string() },
  (ctx, { incidentId, notice, label, status }) => {
    requireRole(ctx, 'incident_lead', 'responder', 'legal');
    requireIncident(ctx, incidentId);
    setNotice(ctx, incidentId, notice, label, status);
    progress(ctx, incidentId);
  }
);

// ---------- AI notice draft (Lane D): Gemini writes, a human sends ----------
// Runs as a procedure because reducers cannot make HTTP calls. The API key comes from the database's
// private environment, so it never reaches a client. Only aggregate facts go to Gemini (counts, data types,
// dates), never customer names or account numbers. The draft lands in privileged #legal and the notice
// becomes "drafted"; a person still reviews it and clicks Mark sent.
const clip = (s: string, n: number) => s.slice(0, n).replace(/[\r\n]+/g, ' ');
const fmtDate = (ts: Timestamp) => new Date(Number(ts.microsSinceUnixEpoch / 1000n)).toISOString().slice(0, 10);

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/** Fallback letter when Gemini is unavailable: same facts, fixed wording, unknowns left in [BRACKETS]. */
function templateNotice(f: { label: string; rule: string; due: string; people: bigint; title: string; detected: string; stolen: string }) {
  return [
    'DRAFT - PRIVILEGED & CONFIDENTIAL - NOT LEGAL ADVICE',
    `To: ${f.label}   (${f.rule}; deadline ${f.due})`,
    '',
    'Notice of Data Breach',
    '',
    `What happened: On ${f.detected}, [BANK NAME] detected a security incident (${f.title}). An unauthorized party accessed and copied data from our systems.`,
    `What information was involved: ${f.stolen}. About ${f.people.toLocaleString()} people in this group are affected. [CONFIRM DATA TYPES: names, SSNs, account numbers, ...]`,
    'What we are doing: We contained the incident, engaged forensic experts, notified law enforcement and our regulators, and are strengthening our systems.',
    'What you can do: Review your account statements and credit reports (free at annualcreditreport.com). You can place a free fraud alert or security freeze with Equifax (1-800-685-1111), Experian (1-888-397-3742) and TransUnion (1-888-909-8872). [OFFER OF CREDIT MONITORING, IF ANY]',
    'For more information: Call [PHONE] or write to [ADDRESS].',
  ].join('\n');
}

/**
 * From a ListModels response, text models to try in order: stable "gemini-X-flash" (newest first), then other
 * Flash variants (incl. lite), then any other Gemini text model. Speech/image/live models are skipped.
 */
function rankGeminiModels(res: { ok: boolean; json(): any }): string[] {
  if (!res.ok) return [];
  const models = ((res.json()?.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-\d/.test(n) && !/(tts|image|audio|live|embedding|preview|exp)/.test(n));
  const version = (n: string) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');
  // Stable Flash-Lite first: a form letter does not need more, Lite answers in seconds, and the newest full
  // Flash is often overloaded (gemini-3.8-flash hung 60-90s in testing). Then stable Flash, then anything else.
  const tier = (n: string) => (/^gemini-[\d.]+-flash-lite$/.test(n) ? 0 : /^gemini-[\d.]+-flash$/.test(n) ? 1 : 2);
  return models.sort((a, b) => tier(a) - tier(b) || version(b) - version(a));
}

// Google answers 429/500/503 when a model is overloaded; those are worth a retry, 4xx otherwise are not.
const GEMINI_RETRYABLE = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_CALLS = 3; // models tried per click; a healthy Lite model answers in a few seconds
const GEMINI_CALL_TIMEOUT_MS = 12_000; // a busy model hangs rather than failing fast: give up and try the next
let lastGoodModel: string | null = null; // best-effort cache; resets when the module instance restarts
// Turn "thinking" down: a form letter does not need it, and it made gemini-3.8-flash take over 60s per draft.
type ThinkingConfig = { thinkingBudget: number } | { thinkingLevel: string } | null;
const THINKING_OPTIONS: ThinkingConfig[] = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
const THINKING_OK = new Map<string, ThinkingConfig>();

type GeminiRes = { ok: boolean; status: number; json(): any };
type HttpCtx = { http: { fetch(url: string, init?: any): any } };

/**
 * One Gemini text generation with model fallback, retries and short timeouts (shared by AI drafts and the advisor).
 * Returns text = null when Gemini is busy or down; throws SenderError on setup problems (bad key, quota).
 */
function geminiGenerate(ctx: HttpCtx, key: string, model: string | null, prompt: string, config: Record<string, unknown>, tag: string) {
    // Speed: no "thinking" (a form letter does not need it), a capped length, a short per-call timeout and an overall
    // budget, so a click answers in seconds. If a model rejects the thinking setting (HTTP 400), retry it once without.
    const body = (thinking: ThinkingConfig) =>
      JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { ...config, ...(thinking ? { thinkingConfig: thinking } : {}) },
      });
    type Res = GeminiRes;
    const call = (m: string, thinking: ThinkingConfig): Res => {
      try {
        return ctx.http.fetch(`${GEMINI_API}/models/${encodeURIComponent(m)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: body(thinking),
          timeout: TimeDuration.fromMillis(GEMINI_CALL_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, status: 504, json: () => null }; // timed out / network error: treat like "busy"
      }
    };
    // Older models take thinkingBudget, newer ones thinkingLevel; a 400 means "not this one", so try the next.
    // The setting that worked is remembered per model, so later clicks make a single call.
    const generate = (m: string): Res => {
      const start = THINKING_OK.has(m) ? THINKING_OPTIONS.indexOf(THINKING_OK.get(m)!) : 0;
      let r: Res = { ok: false, status: 400, json: () => null };
      for (const thinking of THINKING_OPTIONS.slice(start)) {
        r = call(m, thinking);
        if (r.status !== 400) {
          THINKING_OK.set(m, thinking);
          break;
        }
      }
      return r;
    };

    // Order: GEMINI_MODEL if set, else the model that last worked (remembered while this module instance lives),
    // then the ranked list this key can use (fetched only if needed). One quick retry per model when it is busy.
    let candidates: string[] | null = null;
    const first = model ?? lastGoodModel;
    const queue = first ? [first] : [];
    const tried = new Set<string>();
    let res: Res | null = null;
    let usedModel = first ?? '', calls = 0;
    while (calls < GEMINI_MAX_CALLS) {
      const m = queue.shift();
      if (!m) {
        if (candidates) break;
        candidates = rankGeminiModels(ctx.http.fetch(`${GEMINI_API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }));
        queue.push(...candidates.filter(c => !tried.has(c)));
        continue;
      }
      if (tried.has(m)) continue;
      tried.add(m);
      usedModel = m;
      res = generate(m);
      calls++;
      console.log(`${tag}: ${m} -> HTTP ${res.status}`);
      if (res.ok) {
        lastGoodModel = m;
        break;
      }
      if (m === lastGoodModel) lastGoodModel = null;
      if (res.status !== 404 && !GEMINI_RETRYABLE.has(res.status)) break; // bad key, quota, bad request: don't hop models
    }
    // Never echo the response body on error: it is logged to the caller and could include request details.
    // A bad key / quota (4xx) is a setup problem: say so. If Gemini is just busy or down, fall back to a fixed
    // template so the responder still gets a draft in seconds, clearly marked as not AI-written.
    if (res && !res.ok && res.status !== 404 && !GEMINI_RETRYABLE.has(res.status))
      throw new SenderError(`Gemini request failed (HTTP ${res.status}, model ${usedModel}). Check the API key and quota.`);
    const data = res?.ok ? (res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }) : null;
    const aiText = data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
    return { text: aiText || null, usedModel, tried: [...tried] };
}

export const draftNotice = db.procedure(
  { incidentId: t.u64(), notice: t.string(), label: t.string(), people: t.u64(), rule: t.string(), due: t.string() },
  t.string(),
  (ctx, args) => {
    const notice = clip(args.notice, 80), label = clip(args.label, 120), rule = clip(args.rule, 200), due = clip(args.due, 60);

    // 1. Check access and gather facts in a read transaction.
    const facts = ctx.withTx(tx => {
      requireRole(tx, ...PRIVILEGED_ROLES); // the draft goes into privileged #legal
      const inc = requireIncident(tx, args.incidentId);
      const stolen = [...tx.db.scopeItem.incidentId.filter(args.incidentId)].filter(s => s.status === 'exfiltrated');
      return {
        title: inc.title,
        kind: inc.kind,
        detected: fmtDate(inc.detectedAt),
        stolen: stolen.map(s => `${s.label} (${s.recordsCount.toLocaleString()} records)`).join('; ') || 'not yet confirmed',
      };
    });

    const key = ctx.env.GEMINI_API_KEY;
    if (!key) throw new SenderError('AI drafting is off: publish the module with GEMINI_API_KEY set (see README).');
    const model = ctx.env.GEMINI_MODEL || null; // unset = pick the newest stable Flash this key can use

    // 2. Ask Gemini (outside any transaction: HTTP is not allowed inside withTx).
    const prompt = [
      'You are drafting a data breach notification for a US bank. Write the full letter, ready for a lawyer to review.',
      `Recipient: ${label}. Who must be told and when: ${rule}; deadline ${due}.`,
      `People affected: ${args.people.toLocaleString()}.`,
      `Incident: ${facts.title} (${facts.kind}), detected ${facts.detected}.`,
      `Data stolen: ${facts.stolen}.`,
      'Include what the law for this recipient requires: what happened and when, what personal information was involved,',
      'what the bank is doing, what the reader can do (credit freeze, fraud alert, free credit reports, the major credit bureaus\' contact details),',
      'and a contact phone number and address. Use [BRACKETS] for any fact you do not know; never invent one.',
      'Plain language, no markdown, under 350 words. Put "DRAFT - PRIVILEGED & CONFIDENTIAL - NOT LEGAL ADVICE" on the first line.',
    ].join('\n');

    const { text: aiText, usedModel, tried } = geminiGenerate(ctx, key, model, prompt, { temperature: 0.3, maxOutputTokens: 1200 }, 'draftNotice');
    const draft = aiText || templateNotice({ label, rule, due, people: args.people, ...facts });
    const header = aiText
      ? `AI draft (${usedModel}) for ${label}, review before sending:`
      : `Template draft for ${label} (Gemini unavailable: ${tried.join(', ') || 'no model'}), review and fill the [BRACKETS]:`;

    // 3. Post into #legal and mark the notice drafted, atomically.
    ctx.withTx(tx => {
      requireRole(tx, ...PRIVILEGED_ROLES);
      const legal = [...tx.db.channel.incidentId.filter(args.incidentId)].find(c => c.name === 'legal');
      if (!legal) throw new SenderError('This incident has no #legal channel');
      tx.db.message.insert({
        id: 0n, channelId: legal.id, sender: tx.sender, sentAt: tx.timestamp,
        text: `${header}\n\n${draft}`,
      });
      setNotice(tx, args.incidentId, notice, label, 'drafted');
      audit(tx, aiText ? 'notice_ai_draft' : 'notice_template_draft', label);
    });
    return draft;
  }
);


// ---------- Import from Nessie (Capital One): the bank's real customer and transaction data, in one click ----------
// Same rules as scripts/import-nessie.mjs. Procedures make HTTP calls one at a time, so each click scans a batch of
// accounts (plus the "hot" ones: live-demo targets and accounts already flagged) and remembers where it stopped.
const NESSIE_BATCH = 20;
const NESSIE_HOT_BALANCE = 75_000; // seed-nessie.mjs funds its live --plant targets to at least this

export const importFromNessie = db.procedure({ incidentId: t.u64() }, t.string(), (ctx, { incidentId }) => {
  const { offset, checkedBefore, flagged } = ctx.withTx(tx => {
    requireRole(tx, ...WRITERS);
    requireIncident(tx, incidentId);
    const flaggedAccounts = new Set([...tx.db.scopeItem.incidentId.filter(incidentId)].filter(s => s.assetType === 'account').map(s => s.assetRef));
    const cur = tx.db.nessieCursor.incidentId.find(incidentId);
    return { offset: cur?.offset ?? 0, checkedBefore: cur?.checked ?? 0, flagged: flaggedAccounts };
  });
  let key: string | undefined;
  try {
    key = ctx.env.NESSIE_API_KEY;
  } catch {
    key = undefined;
  }
  if (!key) throw new SenderError('Nessie is off: publish the module with NESSIE_API_KEY set (see README).');

  // GET a Nessie list. The URL carries the key, so errors only ever name the path.
  const get = (path: string): any[] => {
    let r: { ok: boolean; status: number; json(): any };
    try {
      r = ctx.http.fetch(`${NESSIE_BASE}${path}?key=${encodeURIComponent(key!)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: TimeDuration.fromMillis(10_000),
      });
    } catch {
      throw new SenderError(`Nessie did not answer (${path})`);
    }
    if (r.status === 404 || (r.status === 400 && path.endsWith('/bills'))) return []; // "none found" / old bills
    if (!r.ok) throw new SenderError(`Nessie ${path} returned HTTP ${r.status}`);
    const j = r.json();
    return Array.isArray(j) ? j : [];
  };

  const customers = get('/customers') as NessieCustomer[];
  if (!customers.length) throw new SenderError('No customers in Nessie yet: run scripts/seed-nessie.mjs first.');
  const accounts = (get('/accounts') as NessieAccount[]).sort((a, b) => (a._id < b._id ? -1 : 1));
  const names = new Map(customers.map(c => [c._id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()]));
  const { picked, next } = batch(accounts, offset, NESSIE_BATCH);
  const hot = accounts.filter(a => (a.balance ?? 0) >= NESSIE_HOT_BALANCE || flagged.has(a._id));
  const toScan = [...new Map([...hot, ...picked].map(a => [a._id, a])).values()];
  const found: { a: NessieAccount; item: Activity; reason: string }[] = [];
  for (const a of toScan)
    for (const kind of ['withdrawal', 'bill'] as const)
      for (const raw of get(`/accounts/${a._id}/${kind}s`)) {
        const item = normalizeActivity(kind, raw);
        const reason = isSuspicious(item);
        if (reason) found.push({ a, item, reason });
      }

  const result = ctx.withTx(tx => {
    const states = countByState(customers);
    for (const [st, n] of states) setStateRecords(tx, incidentId, st, BigInt(n));
    const total = BigInt(customers.length);
    const agg = [...tx.db.scopeItem.incidentId.filter(incidentId)].find(sc => sc.assetRef === 'nessie-customers');
    if (!agg || agg.recordsCount !== total || agg.status !== 'exfiltrated')
      setScope(tx, { incidentId, assetType: 'customer', assetRef: 'nessie-customers', label: 'Customer records (Nessie, First Avon Bank)', status: 'exfiltrated', recordsCount: total });
    const seen = new Set([...tx.db.fraudAlert.incidentId.filter(incidentId)].map(f => f.transferRef));
    let raised = 0;
    for (const f of found) {
      const ref = `${f.item.kind}:${f.item.ref}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      const label = accountLabel(f.a);
      setScope(tx, { incidentId, assetType: 'account', assetRef: f.a._id, label: `Account ${label} (${names.get(f.a.customer_id ?? '') || 'customer'})`, status: 'exfiltrated', recordsCount: 1n });
      raiseAlert(tx, { incidentId, accountRef: label, transferRef: ref, amountCents: BigInt(Math.round(f.item.amount * 100)), reason: f.reason });
      raised++;
    }
    const row = { incidentId, offset: next, total: accounts.length, at: tx.timestamp, checked: Math.min(accounts.length, checkedBefore + picked.length) };
    if (tx.db.nessieCursor.incidentId.find(incidentId)) tx.db.nessieCursor.incidentId.update(row);
    else tx.db.nessieCursor.insert(row);
    const from = accounts.length ? (offset % accounts.length) + 1 : 0;
    timeline(tx, incidentId, 'auto', `Nessie import: ${customers.length} customers in ${states.size} states; checked ${toScan.length} accounts (batch from #${from} of ${accounts.length}); ${raised} new fraud alert(s)`);
    execUpdate(tx, incidentId);
    progress(tx, incidentId);
    return { customers: customers.length, states: states.size, accounts: accounts.length, checked: toScan.length, from, raised };
  });
  return JSON.stringify(result);
});

// ---------- Incident advisor (Gemini, grounded): answers from the live record, proposes checked actions ----------
const SCOPE_WORDS: Record<string, string> = {
  encrypted: 'locked by ransomware', exfiltrated: 'stolen', accessed: 'seen by attacker', unknown: 'not checked yet', clear: 'safe',
};
const NOTICE_KEY = /^(?:[A-Z]{2}-(?:Customers|Attorney General|Credit bureaus)|clock-\d+)$/;
type IncidentRow = NonNullable<ReturnType<Ctx['db']['incident']['id']['find']>>;

/** Everything the advisor may know, as citable lines, filtered by the asker's role (no #legal for non-lawyers). */
function advisorFacts(ctx: Ctx, inc: IncidentRow, role: string, noticesJson: string): AdvisorFacts {
  const id = inc.id;
  const nowMs = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
  const msOf = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch / 1000n) - nowMs;
  const ago = (ts: Timestamp) => {
    const m = Math.max(0, Math.round(-msOf(ts) / 60_000));
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  const label = (p: string) => PHASE_LABELS[p] ?? p;
  const next = nextPhase(inc.phase);
  const lines = [
    `[I] Incident "${clip(inc.title, 120)}"; severity ${inc.severity}; type ${inc.kind}; current phase ${label(inc.phase)}; detected ${ago(inc.detectedAt)}.`,
    `[P] Playbook: phases in order ${PHASES.map(label).join(' > ')}. ` +
      (next ? `When every ${label(inc.phase)} task is done, the incident moves to ${label(next)} after a 30-second countdown unless the lead stays. ` : 'This is the last phase. ') +
      'Fraud transfers of $10,000 or more are frozen automatically once the incident reaches Contain. Remove threat and Recover tasks need one person to mark them done and a different incident lead to verify them. Marking data stolen starts the federal deadline clocks (bank regulator 36h, SEC 8-K if material).',
  ];
  const tasks = [...ctx.db.task.incidentId.filter(id)].map(t => ({ tag: `K${t.id}`, id: `${t.id}`, title: t.title, phase: t.phase, done: t.done }));
  for (const t of tasks) lines.push(`[${t.tag}] Task (${label(t.phase)}, ${t.done ? 'done' : 'open'}): ${clip(t.title, 120)}`);
  for (const e of [...ctx.db.timelineEvent.incidentId.filter(id)].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 15).reverse())
    lines.push(`[T${e.id}] Timeline, ${ago(e.at)}, ${e.kind}: ${clip(e.text, 160)}`);
  for (const sc of ctx.db.scopeItem.incidentId.filter(id))
    lines.push(`[S${sc.id}] What was hit: ${clip(sc.label, 80)} (${sc.assetType}) is ${SCOPE_WORDS[sc.status] ?? sc.status}, ${sc.recordsCount.toLocaleString()} records`);
  const alerts = [...ctx.db.fraudAlert.incidentId.filter(id)].map(a => ({
    tag: `F${a.id}`, id: `${a.id}`, status: a.status,
    label: `$${(a.amountCents / 100n).toLocaleString()} from account ${clip(a.accountRef, 30)}`, reason: clip(a.reason, 80),
  }));
  for (const a of alerts) lines.push(`[${a.tag}] Fraud alert (${a.status}): ${a.label}, ${a.reason}`);
  const clocks = [...ctx.db.legalClock.incidentId.filter(id)].map(c => ({ tag: `D${c.id}`, id: `${c.id}`, label: clip(c.label, 80), done: c.done, msLeft: msOf(c.deadlineAt) }));
  for (const c of clocks) lines.push(`[${c.tag}] Deadline: ${c.label}, ${c.done ? 'filed' : `due ${left(c.msLeft)}`}`);
  for (const st of ctx.db.stateImpact.incidentId.filter(id))
    lines.push(`[A${st.id}] Stolen records by state: ${st.state} has ${st.records.toLocaleString()} affected residents`);

  // Notices owed come from the client's notice list (state rules live there); status always comes from our tables.
  const sent = new Map([...ctx.db.notifyStatus.incidentId.filter(id)].map(n => [n.notice, n.status]));
  const clockDone = new Map(clocks.map(c => [`clock-${c.id}`, c.done]));
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(noticesJson.slice(0, 6000));
  } catch {
    parsed = [];
  }
  const notices: AdvisorFacts['notices'] = [];
  for (const n of Array.isArray(parsed) ? parsed.slice(0, 30) : []) {
    const key = clip(String((n as { key?: unknown })?.key ?? ''), 60);
    if (!NOTICE_KEY.test(key) || notices.some(x => x.key === key)) continue;
    const dueMs = Number((n as { dueMs?: unknown })?.dueMs);
    const status = clockDone.get(key) ? 'sent' : (sent.get(key) ?? 'not_started');
    const item = { tag: `Q${notices.length + 1}`, key, label: clip(String((n as { label?: unknown })?.label ?? key), 80), status, msLeft: Number.isFinite(dueMs) && dueMs > 0 ? dueMs - nowMs : null };
    notices.push(item);
    const people = Number((n as { people?: unknown })?.people) || 0;
    lines.push(`[${item.tag}] Notice owed to ${item.label}: ${people.toLocaleString()} people, due ${left(item.msLeft)}, status ${status.replace('_', ' ')}`);
  }

  const privileged = PRIVILEGED_ROLES.includes(role);
  const channels = new Map([...ctx.db.channel.incidentId.filter(id)].filter(c => privileged || !c.privileged).map(c => [c.id, c.name]));
  const names = new Map([...ctx.db.user.iter()].map(u => [u.identity.toHexString(), u.name]));
  const msgs = [...ctx.db.message.iter()].filter(m => channels.has(m.channelId)).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 10).reverse();
  for (const m of msgs)
    lines.push(`[M${m.id}] Chat #${channels.get(m.channelId)}, ${names.get(m.sender.toHexString()) ?? 'Knight Agent'}: ${clip(m.text, 160)}`);

  return { lines, phase: inc.phase, phases: PHASES, phaseLabels: PHASE_LABELS, tasks, alerts, clocks, notices };
}

export const askAdvisor = db.procedure(
  { incidentId: t.u64(), question: t.string(), history: t.string(), notices: t.string() },
  t.string(),
  (ctx, args) => {
    const question = clip(args.question, 500).trim();
    if (!question) throw new SenderError('Ask a question first');
    const facts = ctx.withTx(tx => {
      const me = requireRole(tx);
      return advisorFacts(tx, requireIncident(tx, args.incidentId), me.role, args.notices);
    });
    let key: string | undefined;
    let model: string | null = null;
    try {
      key = ctx.env.GEMINI_API_KEY;
      model = ctx.env.GEMINI_MODEL || null;
    } catch {
      key = undefined; // no environment (e.g. unit tests): answer from rules
    }
    if (!key) return JSON.stringify(ruleBasedReply(facts, 'AI is not configured on this server'));
    const prompt = advisorPrompt(facts, question, args.history.slice(0, 2000));
    let res: { text: string | null; usedModel: string };
    try {
      res = geminiGenerate(ctx, key, model, prompt, { temperature: 0.1, maxOutputTokens: 900, responseMimeType: 'application/json', responseSchema: ADVISOR_SCHEMA }, 'askAdvisor');
    } catch {
      return JSON.stringify(ruleBasedReply(facts, 'Gemini rejected the request'));
    }
    if (!res.text) return JSON.stringify(ruleBasedReply(facts, 'Gemini is busy'));
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      parsed = null;
    }
    return JSON.stringify(checkReply(parsed, facts, res.usedModel) ?? ruleBasedReply(facts, 'the AI answer was unusable'));
  }
);

/** After a human confirms an advisor suggestion and it succeeds: keep "AI-suggested, human-confirmed" on the record. */
export const logAdvisorAction = db.reducer({ incidentId: t.u64(), label: t.string() }, (ctx, { incidentId, label }) => {
  const me = requireRole(ctx);
  requireIncident(ctx, incidentId);
  const text = clip(label, 200);
  timeline(ctx, incidentId, 'action', `Advisor suggestion confirmed by ${me.name}: ${text}`);
  audit(ctx, 'advisor_action', text);
});

// ---------- Attack drill: a scripted attack that plays out live ----------
// Each step runs `waitSec` after the previous one. Events go through the same helpers
// as human actions, so the auto-rules (legal clocks, auto-freeze) fire on their own.
const channelId = (ctx: Ctx, incidentId: bigint, name: string) =>
  [...ctx.db.channel.incidentId.filter(incidentId)].find(c => c.name === name)!.id;
const say = (ctx: Ctx, incidentId: bigint, channel: string, text: string) =>
  ctx.db.message.insert({ id: 0n, channelId: channelId(ctx, incidentId, channel), sender: ctx.sender, text, sentAt: ctx.timestamp });

const DRILL: { waitSec: number; run: (ctx: Ctx, id: bigint) => void }[] = [
  { waitSec: 4, run: (ctx, id) => timeline(ctx, id, 'ioc', 'EDR alert: mass file encryption on core-db-01 (wiper/ransomware pattern)') },
  { waitSec: 8, run: (ctx, id) => setScope(ctx, { incidentId: id, assetType: 'system', assetRef: 'core-db-01', label: 'Core banking database', status: 'encrypted', recordsCount: 48_210n }) },
  { waitSec: 8, run: (ctx, id) => say(ctx, id, 'general', 'Ransom note on core-db-01: 40 BTC within 72 hours or the customer data gets published.') },
  { waitSec: 10, run: (ctx, id) => timeline(ctx, id, 'ioc', 'Outbound transfer of 3.1 GB from core-db-01 to 185.220.101.4 at 01:52') },
  {
    waitSec: 8,
    run: (ctx, id) => {
      // Who lives where, as the Nessie importer would report it from customer addresses.
      for (const [st, n] of [['TX', 7_400n], ['CA', 2_100n], ['FL', 880n], ['GA', 760n], ['NC', 540n], ['NY', 410n], ['TN', 410n]] as const)
        setStateRecords(ctx, id, st, n);
      setScope(ctx, { incidentId: id, assetType: 'system', assetRef: 's3://avon-exports', label: 'Customer PII export', status: 'exfiltrated', recordsCount: 12_500n });
      execUpdate(ctx, id);
    },
  },
  { waitSec: 10, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'CHK-4471', transferRef: 'TX-90211', amountCents: 240_000n, reason: 'New payee, 02:41 AM' }) },
  { waitSec: 7, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'SAV-1093', transferRef: 'TX-90218', amountCents: 1_875_000n, reason: 'New payee, 02:44 AM, compromised account' }) },
  { waitSec: 7, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'CHK-2286', transferRef: 'TX-90230', amountCents: 2_400_000n, reason: 'Wire to new payee, 02:47 AM' }) },
  { waitSec: 8, run: (ctx, id) => setScope(ctx, { incidentId: id, assetType: 'system', assetRef: 'olb-web-02', label: 'Online banking login server', status: 'accessed', recordsCount: 3_200n }) },
  { waitSec: 6, run: (ctx, id) => timeline(ctx, id, 'note', 'Drill script finished. The attacker is still inside: your move.') },
];

function scheduleStep(ctx: Ctx, incidentId: bigint, step: number) {
  const fast = isAutopilot(ctx.db.incident.id.find(incidentId)?.title ?? '');
  const at = ctx.timestamp.microsSinceUnixEpoch + BigInt(DRILL[step].waitSec) * (fast ? 500_000n : 1_000_000n);
  ctx.db.drillStep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at), incidentId, step });
}

export const startDrill = db.reducer(ctx => {
  requireRole(ctx, 'incident_lead');
  const inc = newIncident(ctx, 'DRILL: Ransomware at First Avon Bank', 'critical', 'ransomware');
  say(ctx, inc.id, 'general', 'Drill started. Treat everything below as real.');
  scheduleStep(ctx, inc.id, 0);
  progress(ctx, inc.id);
});

export const stopDrill = db.reducer(ctx => {
  requireRole(ctx, 'incident_lead');
  const stopped = new Set<bigint>();
  for (const row of [...ctx.db.drillStep.iter()]) {
    ctx.db.drillStep.scheduledId.delete(row.scheduledId);
    stopped.add(row.incidentId);
  }
  for (const row of [...ctx.db.autopilotStep.iter()]) {
    ctx.db.autopilotStep.scheduledId.delete(row.scheduledId);
    stopped.add(row.incidentId);
  }
  for (const id of stopped) {
    cancelAdvance(ctx, id);
    timeline(ctx, id, 'note', 'Drill stopped.');
  }
});

export const runDrillStep = db.reducer({ onSchedule: drillStep }, { row: drillStep.rowType }, (ctx, { row }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('Drill steps run on the schedule only');
  if (!ctx.db.incident.id.find(row.incidentId)) return;
  DRILL[row.step].run(ctx, row.incidentId);
  progress(ctx, row.incidentId);
  if (row.step + 1 < DRILL.length) scheduleStep(ctx, row.incidentId, row.step + 1);
});

// ---------- Autopilot drill: the attack AND the response play out on their own ----------
const AUTOPILOT_TICK_SEC = 2;
const AUTOPILOT_MAX_TICKS = 300; // 10 minutes at 2 s

function scheduleAutopilot(ctx: Ctx, incidentId: bigint, tick: number) {
  const at = ctx.timestamp.microsSinceUnixEpoch + BigInt(AUTOPILOT_TICK_SEC) * 1_000_000n;
  ctx.db.autopilotStep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at), incidentId, tick });
}

export const startAutopilotDrill = db.reducer(ctx => {
  requireRole(ctx, 'incident_lead');
  const inc = newIncident(ctx, 'AUTOPILOT DRILL: Ransomware at First Avon Bank', 'critical', 'ransomware');
  say(ctx, inc.id, 'general', 'Autopilot drill started: the attack and the response both play out on their own.');
  scheduleStep(ctx, inc.id, 0);
  scheduleAutopilot(ctx, inc.id, 0);
  progress(ctx, inc.id);
});

/** One autopilot move: do the next unfinished task of the current phase, the way a responder would. */
export const runAutopilotStep = db.reducer({ onSchedule: autopilotStep }, { row: autopilotStep.rowType }, (ctx, { row }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('Autopilot runs on the schedule only');
  const inc = ctx.db.incident.id.find(row.incidentId);
  if (!inc || row.tick > AUTOPILOT_MAX_TICKS) return;
  const id = row.incidentId;
  if (containing(ctx, id))
    for (const a of [...ctx.db.fraudAlert.incidentId.filter(id)].filter(a => a.status === 'open')) {
      ctx.db.fraudAlert.id.update({ ...a, status: 'frozen' });
      audit(ctx, 'fraud_alert_status', `${a.id}: frozen (autopilot)`);
      timeline(ctx, id, 'auto', `Autopilot: froze account ${a.accountRef}`);
    }
  const open = [...ctx.db.task.incidentId.filter(id)]
    .filter(tk => tk.phase === inc.phase && !tk.done)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const tk = open[0];
  if (tk && SIGNOFF_TASKS.has(tk.title)) {
    // Drill only: a real incident needs two different people (signOffTask enforces that).
    const at = ctx.timestamp;
    const so = { taskId: tk.id, incidentId: id, doneBy: ctx.sender, doneAt: at, verifiedBy: ctx.sender, verifiedAt: at };
    if (ctx.db.signoff.taskId.find(tk.id)) ctx.db.signoff.taskId.update(so);
    else ctx.db.signoff.insert(so);
    ctx.db.task.id.update({ ...tk, done: true });
    timeline(ctx, id, 'auto', `Autopilot (drill): signed off and verified: ${tk.title}`);
  } else if (tk && !AUTO_TASKS[tk.title]) {
    ctx.db.task.id.update({ ...tk, done: true });
    timeline(ctx, id, 'auto', `Autopilot: ${tk.title}`);
  } else if (tk?.title === 'Review every fraud alert: freeze or dismiss') {
    for (const a of [...ctx.db.fraudAlert.incidentId.filter(id)].filter(a => a.status === 'open')) {
      ctx.db.fraudAlert.id.update({ ...a, status: 'frozen' });
      timeline(ctx, id, 'auto', `Autopilot: froze account ${a.accountRef}`);
    }
  } else if (tk?.title === 'Send customer notices once Legal approves') {
    for (const st of [...ctx.db.stateImpact.incidentId.filter(id)].filter(st => st.records > 0n))
      setNotice(ctx, id, `${st.state}-Customers`, `${st.state} customers`, 'sent');
  } else if (tk?.title === 'Mark every legal deadline as filed') {
    for (const c of [...ctx.db.legalClock.incidentId.filter(id)].filter(c => !c.done)) {
      ctx.db.legalClock.id.update({ ...c, done: true });
      audit(ctx, 'complete_legal_clock', c.label);
    }
  } // other verifiable tasks wait for the attack script (or imported data) to produce their evidence
  scheduleAutopilot(ctx, id, row.tick + 1); // before progress, so the phase countdown knows autopilot is on
  progress(ctx, id);
  const after = ctx.db.incident.id.find(id)!;
  const finished =
    after.phase === 'post_incident' && [...ctx.db.task.incidentId.filter(id)].filter(t2 => t2.phase === after.phase).every(t2 => t2.done);
  if (finished) {
    for (const r of [...ctx.db.autopilotStep.iter()].filter(r => r.incidentId === id && r.scheduledId !== row.scheduledId))
      ctx.db.autopilotStep.scheduledId.delete(r.scheduledId);
    timeline(ctx, id, 'note', 'Autopilot drill complete: every phase done.');
  }
});

/**
 * Autopilot on an EXISTING incident (e.g. one filled by Import from Nessie): no scripted attack, the robot responder
 * works through every phase using the data already there. Real incidents need real people; this is for drills.
 */
export const runAutopilot = db.reducer({ incidentId: t.u64() }, (ctx, { incidentId }) => {
  const me = requireRole(ctx, 'incident_lead');
  const inc = requireIncident(ctx, incidentId);
  if (inc.phase === 'post_incident') throw new SenderError('This incident is already finished: start a new one');
  if (autopilotOn(ctx, incidentId)) throw new SenderError('Autopilot is already running on this incident');
  if (![...ctx.db.scopeItem.incidentId.filter(incidentId)].length)
    throw new SenderError('Nothing to respond to yet: import from Nessie (or add what was hit) first');
  if (ctx.db.phaseHold.incidentId.find(incidentId)) ctx.db.phaseHold.incidentId.delete(incidentId); // a "Stay here" would stall it
  const alerts = [...ctx.db.fraudAlert.incidentId.filter(incidentId)].length;
  timeline(ctx, incidentId, 'note', `Autopilot started by ${me.name} on this incident's data (${alerts} fraud alert${alerts === 1 ? '' : 's'} so far)`);
  audit(ctx, 'run_autopilot', `${incidentId}: ${inc.title}`);
  scheduleAutopilot(ctx, incidentId, 0);
  progress(ctx, incidentId);
});

// ---------- Views: the only way clients read data ----------
// Each view runs per caller: non-members get [], privileged rows need a privileged role.
type VCtx = { sender: Ctx['sender']; db: { user: { identity: { find(i: Ctx['sender']): { role: string } | null } } } };
const roleOf = (ctx: VCtx) => ctx.db.user.identity.find(ctx.sender)?.role;

export const members = db.view({ name: 'members', public: true }, t.array(user.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.user.iter()] : []
);
export const incidents = db.view({ name: 'incidents', public: true }, t.array(incident.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.incident.iter()] : []
);
export const timelineEvents = db.view({ name: 'timelineEvents', public: true }, t.array(timelineEvent.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.timelineEvent.iter()] : []
);
export const scopeItems = db.view({ name: 'scopeItems', public: true }, t.array(scopeItem.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.scopeItem.iter()] : []
);
export const tasks = db.view({ name: 'tasks', public: true }, t.array(task.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.task.iter()] : []
);
export const channels = db.view({ name: 'channels', public: true }, t.array(channel.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.channel.iter()] : []
);
export const messages = db.view({ name: 'messages', public: true }, t.array(message.rowType), ctx => {
  const role = roleOf(ctx);
  if (!role) return [];
  if (PRIVILEGED_ROLES.includes(role)) return [...ctx.db.message.iter()];
  return [...ctx.db.message.iter()].filter(m => !ctx.db.channel.id.find(m.channelId)?.privileged);
});
export const legalClocks = db.view({ name: 'legalClocks', public: true }, t.array(legalClock.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.legalClock.iter()] : []
);
export const fraudAlerts = db.view({ name: 'fraudAlerts', public: true }, t.array(fraudAlert.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.fraudAlert.iter()] : []
);
export const stateImpacts = db.view({ name: 'stateImpacts', public: true }, t.array(stateImpact.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.stateImpact.iter()] : []
);
export const notifyStatuses = db.view({ name: 'notifyStatuses', public: true }, t.array(notifyStatus.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.notifyStatus.iter()] : []
);
export const phaseAdvances = db.view({ name: 'phaseAdvances', public: true }, t.array(phaseAdvance.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.phaseAdvance.iter()] : []
);
export const signoffs = db.view({ name: 'signoffs', public: true }, t.array(signoff.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.signoff.iter()] : []
);
export const nessieCursors = db.view({ name: 'nessieCursors', public: true }, t.array(nessieCursor.rowType), ctx =>
  roleOf(ctx) ? [...ctx.db.nessieCursor.iter()] : []
);
export const auditEntries = db.view({ name: 'auditEntries', public: true }, t.array(auditLog.rowType), ctx =>
  roleOf(ctx) === 'admin' ? [...ctx.db.auditLog.iter()] : []
);
