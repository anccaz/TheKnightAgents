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
