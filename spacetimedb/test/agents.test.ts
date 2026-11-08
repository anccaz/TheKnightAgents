// AI agents brief once per phase, only with what their role may see, and only leads can start them.
import { expect, test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';

const as = (sub: string) => TestAuth.fromJwtPayload(JSON.stringify({ sub, iss: 'test', aud: ['test'] }), ConnectionId.random());

test('Counsel never sees money, Comms does; one briefing per phase; responders cannot run agents', () => {
  const h = createModuleTestHarness(mod.default, mod);
  h.withReducerTx(as('owner'), ctx => mod.init(ctx, {}));
  const ids = Object.fromEntries(['admin', 'responder'].map(r => [r, h.withReducerTx(as(r), ctx => ctx.sender)]));
  for (const role of ['admin', 'responder'])
    h.withReducerTx(as('owner'), ctx => mod.addMember(ctx, { target: ids[role], name: role, email: role, role }));
  h.withReducerTx(as('admin'), ctx => mod.createIncident(ctx, { title: 'x', severity: 'high', kind: 'ransomware' }));
  h.withReducerTx(as('admin'), ctx => mod.upsertScopeItem(ctx, { incidentId: 1n, assetType: 'system', assetRef: 'db', label: 'Core DB', status: 'exfiltrated', recordsCount: 500n }));
  h.withReducerTx(as('admin'), ctx => mod.raiseFraudAlert(ctx, { incidentId: 1n, accountRef: 'CHK-1', transferRef: 'T', amountCents: 2_500_000n, reason: 'r' }));

  expect(() => mod.runAgents(h.procedureContext(as('responder')), { incidentId: 1n })).toThrow(/Requires role/);
  expect(mod.runAgents(h.procedureContext(as('admin')), { incidentId: 1n })).toBe('briefed');
  expect(mod.runAgents(h.procedureContext(as('admin')), { incidentId: 1n })).toBe('already briefed');

  const posts = h.withReducerTx(as('admin'), ctx => {
    const name = new Map([...ctx.db.channel.iter()].map(c => [c.id, c.name]));
    return [...ctx.db.message.iter()].filter(m => m.text.startsWith('🤖')).map(m => ({ ch: name.get(m.channelId), text: m.text }));
  });
  const counsel = posts.find(p => p.ch === 'legal')!.text, comms = posts.find(p => p.ch === 'exec')!.text;
  expect(counsel).toMatch(/Counsel agent/);
  expect(counsel).not.toMatch(/\$|fraud/i);
  expect(comms).toMatch(/Comms agent[\s\S]*\$25,000/);
});
