// Auto-rules and drill: these are the demo's "it acts on its own" moments.
import { expect, test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { ScheduleAt } from 'spacetimedb/server';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';

const as = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ sub, iss: 'test', aud: ['test'] }), ConnectionId.random());

function setup() {
  const h = createModuleTestHarness(mod.default, mod);
  h.withReducerTx(as('owner'), ctx => mod.init(ctx, {}));
  const admin = h.withReducerTx(as('admin'), ctx => ctx.sender);
  h.withReducerTx(as('owner'), ctx => mod.addMember(ctx, { target: admin, name: 'a', email: 'a', role: 'admin' }));
  h.withReducerTx(as('admin'), ctx => mod.createIncident(ctx, { title: 'x', severity: 'high', kind: 'ransomware' }));
  return h;
}
const regimes = (h: ReturnType<typeof setup>) => h.withReducerTx(as('admin'), ctx => [...ctx.db.legalClock.iter()].map(c => c.regime).sort());
const scope = (status: string, recordsCount: bigint, assetRef = 'db') =>
  ({ incidentId: 1n, assetType: 'system', assetRef, label: assetRef, status, recordsCount });

test('marking data stolen starts legal clocks once; Texas AG only at 250+ records', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('encrypted', 1000n)));
  expect(regimes(h)).toEqual([]);
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('exfiltrated', 100n)));
  expect(regimes(h)).toEqual(['bank_regulator', 'sec_8k', 'tx_customers']);
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('exfiltrated', 400n, 'db2')));
  expect(regimes(h)).toEqual(['bank_regulator', 'sec_8k', 'tx_ag', 'tx_customers']);
});

test('declaring and moving phases creates guided tasks without duplicates', () => {
  const h = setup();
  const count = () => h.withReducerTx(as('admin'), ctx => [...ctx.db.task.iter()].length);
  expect(count()).toBe(3);
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'analyze' }));
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'detect' }));
  expect(count()).toBe(6);
});

test('transfers of $10,000 or more are frozen automatically', () => {
  const h = setup();
  const alert = (amountCents: bigint) => ({ incidentId: 1n, accountRef: 'A', transferRef: 'T', amountCents, reason: 'r' });
  h.withReducerTx(as('admin'), ctx => mod.raiseFraudAlert(ctx, alert(999_999n)));
  h.withReducerTx(as('admin'), ctx => mod.raiseFraudAlert(ctx, alert(1_000_000n)));
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.fraudAlert.iter()].map(a => a.status))).toEqual(['open', 'frozen']);
});

test('drill creates an incident and schedules steps; clients cannot fire steps themselves', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.startDrill(ctx, {}));
  const steps = h.withReducerTx(as('admin'), ctx => [...ctx.db.drillStep.iter()]);
  expect(steps).toHaveLength(1);
  expect(h.withReducerTx(as('admin'), ctx => ctx.db.incident.id.find(2n)?.title)).toMatch(/DRILL/);
  const row = { scheduledId: 99n, scheduledAt: ScheduleAt.time(0n), incidentId: 2n, step: 1 };
  expect(() => h.withReducerTx(as('admin'), ctx => mod.runDrillStep(ctx, { row }))).toThrow(/schedule only/);
  h.withReducerTx(TestAuth.internal(), ctx => mod.runDrillStep(ctx, { row }));
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.scopeItem.iter()].map(s => s.assetRef))).toEqual(['core-db-01']);
  h.withReducerTx(as('admin'), ctx => mod.stopDrill(ctx, {}));
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.drillStep.iter()])).toHaveLength(0);
});

const execMessages = (h: ReturnType<typeof setup>) =>
  h.withReducerTx(as('admin'), ctx => {
    const exec = [...ctx.db.channel.iter()].find(c => c.incidentId === 1n && c.name === 'exec')!;
    return [...ctx.db.message.iter()].filter(m => m.channelId === exec.id).map(m => m.text);
  });

test('changing phase posts a plain status update in #exec', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'analyze' }));
  expect(execMessages(h)).toEqual(['Status update — Phase: Analyze']);
});

test('exec update includes stolen records, deadline and frozen money', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('exfiltrated', 12_500n)));
  h.withReducerTx(as('admin'), ctx =>
    mod.raiseFraudAlert(ctx, { incidentId: 1n, accountRef: 'A', transferRef: 'T', amountCents: 1_500_000n, reason: 'r' }));
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'contain' }));
  const [msg] = execMessages(h);
  expect(msg).toContain('Phase: Contain');
  expect(msg).toContain('12,500 records stolen');
  expect(msg).toMatch(/next deadline in 1d 12h|next deadline in 1d 11h/);
  expect(msg).toContain('$15,000 frozen');
});

test('state impact upserts per state and rejects bad codes', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.setStateImpact(ctx, { incidentId: 1n, state: 'tx', records: 10n }));
  h.withReducerTx(as('admin'), ctx => mod.setStateImpact(ctx, { incidentId: 1n, state: 'TX', records: 300n }));
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.stateImpact.iter()].map(r => [r.state, r.records]))).toEqual([['TX', 300n]]);
  expect(() => h.withReducerTx(as('admin'), ctx => mod.setStateImpact(ctx, { incidentId: 1n, state: 'Texas', records: 1n }))).toThrow(/Invalid state/);
});

test('notice status upserts, audits sends, and is blocked for viewers', () => {
  const h = setup();
  const set = (status: string) => (ctx: any) => mod.setNotifyStatus(ctx, { incidentId: 1n, notice: 'TX-Customers', label: 'Texas customers', status });
  h.withReducerTx(as('admin'), set('drafted'));
  h.withReducerTx(as('admin'), set('sent'));
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.notifyStatus.iter()].map(n => n.status))).toEqual(['sent']);
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.auditLog.iter()].some(a => a.action === 'notice_sent'))).toBe(true);
  expect(() => h.withReducerTx(as('admin'), set('lost'))).toThrow(/Invalid notice status/);
  const viewer = h.withReducerTx(as('viewer'), ctx => ctx.sender);
  h.withReducerTx(as('owner'), ctx => mod.addMember(ctx, { target: viewer, name: 'v', email: 'v', role: 'exec_viewer' }));
  expect(() => h.withReducerTx(as('viewer'), set('sent'))).toThrow(/Requires role/);
});

// ---- Smart flow + autopilot
const tasksOf = (h: ReturnType<typeof setup>, phase: string) =>
  h.withReducerTx(as('admin'), ctx => [...ctx.db.task.iter()].filter(t => t.incidentId === 1n && t.phase === phase));
const pendingAdvance = (h: ReturnType<typeof setup>) => h.withReducerTx(as('admin'), ctx => [...ctx.db.phaseAdvance.iter()]);
const phaseOf = (h: ReturnType<typeof setup>, id = 1n) => h.withReducerTx(as('admin'), ctx => ctx.db.incident.id.find(id)!.phase);

test('verifiable tasks tick themselves', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'analyze' }));
  const listTask = () => tasksOf(h, 'analyze').find(t => t.title.startsWith('List every affected'))!;
  expect(listTask().done).toBe(false);
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('encrypted', 10n)));
  expect(listTask().done).toBe(true);
});

test('finishing a phase schedules an advance; the schedule moves it; Stay here and reopening cancel it', () => {
  const h = setup();
  const tickAll = () => {
    for (const t of tasksOf(h, 'detect')) if (!t.done) h.withReducerTx(as('admin'), ctx => mod.toggleTask(ctx, { taskId: t.id }));
  };
  tickAll();
  expect(pendingAdvance(h)).toHaveLength(1);
  // reopening a task cancels it
  const first = tasksOf(h, 'detect')[0];
  h.withReducerTx(as('admin'), ctx => mod.toggleTask(ctx, { taskId: first.id }));
  expect(pendingAdvance(h)).toHaveLength(0);
  h.withReducerTx(as('admin'), ctx => mod.toggleTask(ctx, { taskId: first.id }));
  // Stay here cancels and holds
  h.withReducerTx(as('admin'), ctx => mod.stayInPhase(ctx, { incidentId: 1n }));
  expect(pendingAdvance(h)).toHaveLength(0);
  h.withReducerTx(as('admin'), ctx => mod.addTimelineEvent(ctx, { incidentId: 1n, kind: 'note', text: 'more work' }));
  expect(pendingAdvance(h)).toHaveLength(0); // held: no new countdown
  // moving on manually clears the hold; finishing the next phase schedules again, and the schedule moves it
  h.withReducerTx(as('admin'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'analyze' }));
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, scope('exfiltrated', 10n))); // ticks list + clocks tasks
  for (const t of tasksOf(h, 'analyze')) if (!t.done) h.withReducerTx(as('admin'), ctx => mod.toggleTask(ctx, { taskId: t.id }));
  const row = pendingAdvance(h)[0];
  expect(row.toPhase).toBe('contain');
  expect(() => h.withReducerTx(as('admin'), ctx => mod.runPhaseAdvance(ctx, { row }))).toThrow(/schedule only/);
  h.withReducerTx(TestAuth.internal(), ctx => mod.runPhaseAdvance(ctx, { row }));
  expect(phaseOf(h)).toBe('contain');
});

test('autopilot drives an incident through all six phases', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => mod.startAutopilotDrill(ctx, {}));
  const id = 2n;
  // Run the attack script fully, then let autopilot ticks and scheduled advances play out.
  for (let step = 0; step < 10; step++)
    h.withReducerTx(TestAuth.internal(), ctx => mod.runDrillStep(ctx, { row: { scheduledId: 0n, scheduledAt: ScheduleAt.time(0n), incidentId: id, step } }));
  for (let tick = 0; tick < 60 && phaseOf(h, id) !== 'post_incident'; tick++) {
    h.withReducerTx(TestAuth.internal(), ctx => mod.runAutopilotStep(ctx, { row: { scheduledId: 0n, scheduledAt: ScheduleAt.time(0n), incidentId: id, tick } }));
    for (const row of pendingAdvance(h).filter(r => r.incidentId === id)) h.withReducerTx(TestAuth.internal(), ctx => mod.runPhaseAdvance(ctx, { row }));
  }
  for (let tick = 0; tick < 6; tick++)
    h.withReducerTx(TestAuth.internal(), ctx => mod.runAutopilotStep(ctx, { row: { scheduledId: 0n, scheduledAt: ScheduleAt.time(0n), incidentId: id, tick } }));
  expect(phaseOf(h, id)).toBe('post_incident');
  const done = h.withReducerTx(as('admin'), ctx => [...ctx.db.task.iter()].filter(t => t.incidentId === id).every(t => t.done));
  expect(done).toBe(true);
  const clocksFiled = h.withReducerTx(as('admin'), ctx => [...ctx.db.legalClock.iter()].filter(c => c.incidentId === id).every(c => c.done));
  expect(clocksFiled).toBe(true);
});
