// Breach Room: SpacetimeDB module. This file IS the data contract.
// Only Lane A edits table definitions; others ask A for new fields.
import { schema, table, t, SenderError, ScheduleAt } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';

// ---------- Enums (kept as strings; validated in reducers) ----------
const ROLES = ['admin', 'incident_lead', 'responder', 'legal', 'exec_viewer'] as const;
const PHASES = ['detect', 'analyze', 'contain', 'eradicate', 'recover', 'post_incident'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const SCOPE_STATUSES = ['encrypted', 'exfiltrated', 'accessed', 'unknown', 'clear'] as const;
const FRAUD_STATUSES = ['open', 'frozen', 'dismissed'] as const;
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

const db = schema({
  owner,
  drillStep,
  stateImpact,
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
});
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
    'Restore systems from clean, tested backups',
    'Watch restored systems closely for 48 hours',
    'Send customer notices once Legal approves',
  ],
  post_incident: [
    'Hold a blameless review within two weeks',
    'Write down what to change next time',
    'Mark every legal deadline as filed',
  ],
};

// Started automatically the first time data is marked stolen. Lane D: verify each rule before the demo.
const LEGAL_RULES = [
  { regime: 'bank_regulator', label: 'Bank regulator notice (36h)', hours: 36, minRecords: 0n },
  { regime: 'sec_8k', label: 'SEC 8-K if material (4 business days)', hours: 96, minRecords: 0n },
  { regime: 'tx_ag', label: 'Texas AG notice, 250+ Texans (30 days)', hours: 720, minRecords: 250n },
  { regime: 'tx_customers', label: 'Customer notices, Texas (60 days)', hours: 1440, minRecords: 0n },
];

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
    startClock(ctx, incidentId, r.regime, r.label, r.hours);
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

type AlertArgs = { incidentId: bigint; accountRef: string; transferRef: string; amountCents: bigint; reason: string };
function raiseAlert(ctx: Ctx, args: AlertArgs) {
  const frozen = args.amountCents >= AUTO_FREEZE_CENTS;
  const a = ctx.db.fraudAlert.insert({ ...args, id: 0n, status: frozen ? 'frozen' : 'open', createdAt: ctx.timestamp });
  if (frozen) {
    timeline(ctx, args.incidentId, 'auto', `Account ${args.accountRef} frozen: $${(args.amountCents / 100n).toLocaleString()} transfer over the $10,000 limit`);
    audit(ctx, 'auto_freeze', `${a.id}: ${args.accountRef}`);
  }
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
  ctx.db.incident.id.update({ ...inc, phase });
  timeline(ctx, incidentId, 'phase_change', `${inc.phase} -> ${phase}`);
  addGuidedTasks(ctx, incidentId, phase);
  audit(ctx, 'set_phase', `${incidentId}: ${phase}`);
});

export const addTimelineEvent = db.reducer(
  { incidentId: t.u64(), kind: t.string(), text: t.string() },
  (ctx, { incidentId, kind, text }) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, incidentId);
    timeline(ctx, incidentId, kind, text);
  }
);

export const addTask = db.reducer(
  { incidentId: t.u64(), title: t.string(), phase: t.string() },
  (ctx, { incidentId, title, phase }) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, incidentId);
    oneOf(phase, PHASES, 'phase');
    ctx.db.task.insert({ id: 0n, incidentId, title, phase, done: false, createdBy: ctx.sender });
  }
);

export const toggleTask = db.reducer({ taskId: t.u64() }, (ctx, { taskId }) => {
  requireRole(ctx, ...WRITERS);
  const tk = ctx.db.task.id.find(taskId);
  if (!tk) throw new SenderError('No such task');
  ctx.db.task.id.update({ ...tk, done: !tk.done });
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
  }
);

// ---------- Fraud watch (Lane C) ----------
export const raiseFraudAlert = db.reducer(
  { incidentId: t.u64(), accountRef: t.string(), transferRef: t.string(), amountCents: t.u64(), reason: t.string() },
  (ctx, args) => {
    requireRole(ctx, ...WRITERS);
    requireIncident(ctx, args.incidentId);
    raiseAlert(ctx, args);
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
});

// ---------- Legal clocks (Lane D) ----------
export const startLegalClock = db.reducer(
  { incidentId: t.u64(), regime: t.string(), label: t.string(), hours: t.u32() },
  (ctx, { incidentId, regime, label, hours }) => {
    requireRole(ctx, 'legal', 'incident_lead');
    requireIncident(ctx, incidentId);
    startClock(ctx, incidentId, regime, label, hours);
    timeline(ctx, incidentId, 'action', `Legal clock started: ${label}`);
  }
);

export const completeLegalClock = db.reducer({ clockId: t.u64() }, (ctx, { clockId }) => {
  requireRole(ctx, 'legal', 'incident_lead');
  const c = ctx.db.legalClock.id.find(clockId);
  if (!c) throw new SenderError('No such clock');
  ctx.db.legalClock.id.update({ ...c, done: true });
  audit(ctx, 'complete_legal_clock', c.label);
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
      for (const [st, n] of [['TX', 8_140n], ['CA', 2_960n], ['FL', 880n], ['NY', 410n], ['OK', 110n]] as const)
        setStateRecords(ctx, id, st, n);
      setScope(ctx, { incidentId: id, assetType: 'system', assetRef: 's3://avon-exports', label: 'Customer PII export', status: 'exfiltrated', recordsCount: 12_500n });
    },
  },
  { waitSec: 10, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'CHK-4471', transferRef: 'TX-90211', amountCents: 240_000n, reason: 'New payee, 02:41 AM' }) },
  { waitSec: 7, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'SAV-1093', transferRef: 'TX-90218', amountCents: 1_875_000n, reason: 'New payee, 02:44 AM, compromised account' }) },
  { waitSec: 7, run: (ctx, id) => raiseAlert(ctx, { incidentId: id, accountRef: 'CHK-2286', transferRef: 'TX-90230', amountCents: 2_400_000n, reason: 'Wire to new payee, 02:47 AM' }) },
  { waitSec: 8, run: (ctx, id) => setScope(ctx, { incidentId: id, assetType: 'system', assetRef: 'olb-web-02', label: 'Online banking login server', status: 'accessed', recordsCount: 3_200n }) },
  { waitSec: 6, run: (ctx, id) => timeline(ctx, id, 'note', 'Drill script finished. The attacker is still inside: your move.') },
];

function scheduleStep(ctx: Ctx, incidentId: bigint, step: number) {
  const at = ctx.timestamp.microsSinceUnixEpoch + BigInt(DRILL[step].waitSec) * 1_000_000n;
  ctx.db.drillStep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(at), incidentId, step });
}

export const startDrill = db.reducer(ctx => {
  requireRole(ctx, 'incident_lead');
  const inc = newIncident(ctx, 'DRILL: Ransomware at First Avon Bank', 'critical', 'ransomware');
  say(ctx, inc.id, 'general', 'Drill started. Treat everything below as real.');
  scheduleStep(ctx, inc.id, 0);
});

export const stopDrill = db.reducer(ctx => {
  requireRole(ctx, 'incident_lead');
  for (const row of [...ctx.db.drillStep.iter()]) {
    ctx.db.drillStep.scheduledId.delete(row.scheduledId);
    timeline(ctx, row.incidentId, 'note', 'Drill stopped.');
  }
});

export const runDrillStep = db.reducer({ onSchedule: drillStep }, { row: drillStep.rowType }, (ctx, { row }) => {
  if (!ctx.senderAuth.isInternal) throw new SenderError('Drill steps run on the schedule only');
  if (!ctx.db.incident.id.find(row.incidentId)) return;
  DRILL[row.step].run(ctx, row.incidentId);
  if (row.step + 1 < DRILL.length) scheduleStep(ctx, row.incidentId, row.step + 1);
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
export const auditEntries = db.view({ name: 'auditEntries', public: true }, t.array(auditLog.rowType), ctx =>
  roleOf(ctx) === 'admin' ? [...ctx.db.auditLog.iter()] : []
);
