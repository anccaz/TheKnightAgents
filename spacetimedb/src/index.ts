// Breach Room: SpacetimeDB module. This file IS the data contract.
// Only Lane A edits table definitions; others ask A for new fields.
import { schema, table, t, SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';

// ---------- Enums (kept as strings; validated in reducers) ----------
export const ROLES = ['admin', 'incident_lead', 'responder', 'legal', 'exec_viewer'] as const;
export const PHASES = ['detect', 'analyze', 'contain', 'eradicate', 'recover', 'post_incident'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const SCOPE_STATUSES = ['encrypted', 'exfiltrated', 'accessed', 'unknown', 'clear'] as const;
export const FRAUD_STATUSES = ['open', 'frozen', 'dismissed'] as const;

// shortcut: every table is public, so any connected client can read all rows.
// Lane A: replace with views filtered by role before the demo (Winstead judges security).
const user = table(
  { public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    email: t.string(),
    role: t.string(),
    online: t.bool(),
    createdAt: t.timestamp(),
  }
);

const invite = table(
  { public: true },
  {
    code: t.string().primaryKey(),
    email: t.string(),
    role: t.string(),
    createdBy: t.identity(),
    used: t.bool(),
    createdAt: t.timestamp(),
  }
);

const incident = table(
  { public: true },
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
  { public: true },
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
  { public: true },
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
  { public: true },
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
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index(),
    name: t.string(),
    privileged: t.bool(), // attorney-client privileged
  }
);

const message = table(
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64().index(),
    sender: t.identity(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

const legalClock = table(
  { public: true },
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
  { public: true },
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
  { public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    at: t.timestamp(),
    actor: t.identity(),
    action: t.string(),
    detail: t.string(),
  }
);

const db = schema({
  user,
  invite,
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
  if (!me) throw new SenderError('Not a member. Ask an admin for an invite.');
  if (roles.length && !roles.includes(me.role) && me.role !== 'admin')
    throw new SenderError(`Requires role: ${roles.join(' or ')}`);
  return me;
}

function audit(ctx: Ctx, action: string, detail: string) {
  ctx.db.auditLog.insert({ id: 0n, at: ctx.timestamp, actor: ctx.sender, action, detail });
}

function timeline(ctx: Ctx, incidentId: bigint, kind: string, text: string) {
  ctx.db.timelineEvent.insert({ id: 0n, incidentId, at: ctx.timestamp, actor: ctx.sender, kind, text });
}

const WRITERS = ['incident_lead', 'responder'];

// ---------- Lifecycle ----------
export const onConnect = db.clientConnected(ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (me) ctx.db.user.identity.update({ ...me, online: true });
});

export const onDisconnect = db.clientDisconnected(ctx => {
  const me = ctx.db.user.identity.find(ctx.sender);
  if (me) ctx.db.user.identity.update({ ...me, online: false });
});

// ---------- Access control (Lane A) ----------
/** First person to call this on an empty database becomes admin. */
export const bootstrapAdmin = db.reducer({ name: t.string(), email: t.string() }, (ctx, { name, email }) => {
  if (ctx.db.user.count() > 0n) throw new SenderError('Already bootstrapped');
  ctx.db.user.insert({ identity: ctx.sender, name, email, role: 'admin', online: true, createdAt: ctx.timestamp });
  audit(ctx, 'bootstrap_admin', email);
});

export const createInvite = db.reducer({ email: t.string(), role: t.string() }, (ctx, { email, role }) => {
  requireRole(ctx, 'admin');
  oneOf(role, ROLES, 'role');
  const bytes = ctx.random.fill(new Uint8Array(9));
  const code = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  ctx.db.invite.insert({ code, email, role, createdBy: ctx.sender, used: false, createdAt: ctx.timestamp });
  audit(ctx, 'create_invite', `${email} as ${role}`);
});

export const acceptInvite = db.reducer({ code: t.string(), name: t.string() }, (ctx, { code, name }) => {
  const inv = ctx.db.invite.code.find(code);
  if (!inv || inv.used) throw new SenderError('Invalid or used invite');
  if (ctx.db.user.identity.find(ctx.sender)) throw new SenderError('Already a member');
  ctx.db.invite.code.update({ ...inv, used: true });
  ctx.db.user.insert({ identity: ctx.sender, name, email: inv.email, role: inv.role, online: true, createdAt: ctx.timestamp });
  audit(ctx, 'accept_invite', inv.email);
});

export const setRole = db.reducer({ target: t.identity(), role: t.string() }, (ctx, { target, role }) => {
  requireRole(ctx, 'admin');
  oneOf(role, ROLES, 'role');
  const u = ctx.db.user.identity.find(target);
  if (!u) throw new SenderError('No such user');
  ctx.db.user.identity.update({ ...u, role });
  audit(ctx, 'set_role', `${u.email} -> ${role}`);
});

// ---------- Incidents & timeline (Lane B) ----------
export const createIncident = db.reducer(
  { title: t.string(), severity: t.string(), kind: t.string() },
  (ctx, { title, severity, kind }) => {
    requireRole(ctx, 'incident_lead');
    oneOf(severity, SEVERITIES, 'severity');
    const inc = ctx.db.incident.insert({
      id: 0n, title, severity, kind, phase: 'detect', detectedAt: ctx.timestamp, createdBy: ctx.sender,
    });
    for (const [name, privileged] of [['general', false], ['containment', false], ['legal', true], ['exec', false]] as const)
      ctx.db.channel.insert({ id: 0n, incidentId: inc.id, name, privileged });
    timeline(ctx, inc.id, 'note', `Incident declared: ${title} (${severity})`);
    audit(ctx, 'create_incident', `${inc.id}: ${title}`);
  }
);

export const setPhase = db.reducer({ incidentId: t.u64(), phase: t.string() }, (ctx, { incidentId, phase }) => {
  requireRole(ctx, 'incident_lead');
  oneOf(phase, PHASES, 'phase');
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) throw new SenderError('No such incident');
  ctx.db.incident.id.update({ ...inc, phase });
  timeline(ctx, incidentId, 'phase_change', `${inc.phase} -> ${phase}`);
  audit(ctx, 'set_phase', `${incidentId}: ${phase}`);
});

export const addTimelineEvent = db.reducer(
  { incidentId: t.u64(), kind: t.string(), text: t.string() },
  (ctx, { incidentId, kind, text }) => {
    requireRole(ctx, ...WRITERS);
    timeline(ctx, incidentId, kind, text);
  }
);

export const addTask = db.reducer(
  { incidentId: t.u64(), title: t.string(), phase: t.string() },
  (ctx, { incidentId, title, phase }) => {
    requireRole(ctx, ...WRITERS);
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
  if (ch.privileged && !['legal', 'incident_lead', 'admin'].includes(me.role))
    throw new SenderError('Privileged channel');
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
    oneOf(args.status, SCOPE_STATUSES, 'scope status');
    const existing = [...ctx.db.scopeItem.incidentId.filter(args.incidentId)].find(s => s.assetRef === args.assetRef);
    const row = { ...args, updatedAt: ctx.timestamp, updatedBy: ctx.sender };
    if (existing) ctx.db.scopeItem.id.update({ ...row, id: existing.id });
    else ctx.db.scopeItem.insert({ ...row, id: 0n });
    timeline(ctx, args.incidentId, 'scope_change', `${args.label}: ${args.status}`);
  }
);

// ---------- Fraud watch (Lane C) ----------
export const raiseFraudAlert = db.reducer(
  { incidentId: t.u64(), accountRef: t.string(), transferRef: t.string(), amountCents: t.u64(), reason: t.string() },
  (ctx, args) => {
    requireRole(ctx, ...WRITERS);
    ctx.db.fraudAlert.insert({ ...args, id: 0n, status: 'open', createdAt: ctx.timestamp });
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
    const deadlineAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + BigInt(hours) * 3_600_000_000n);
    ctx.db.legalClock.insert({ id: 0n, incidentId, regime, label, startedAt: ctx.timestamp, deadlineAt, done: false });
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
