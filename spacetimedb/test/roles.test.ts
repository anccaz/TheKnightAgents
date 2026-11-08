// The role checks are the whole server-side security model: these fail if they break.
import { expect, test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';

const db = mod.default;
const as = (sub: string) =>
  TestAuth.fromJwtPayload(JSON.stringify({ sub, iss: 'test', aud: ['test'] }), ConnectionId.random());

function setup() {
  const h = createModuleTestHarness(db, mod);
  const owner = as('owner');
  h.withReducerTx(owner, ctx => mod.init(ctx, {}));
  const ids = Object.fromEntries(
    ['admin', 'responder', 'exec_viewer', 'stranger'].map(r => [r, h.withReducerTx(as(r), ctx => ctx.sender)])
  );
  for (const role of ['admin', 'responder', 'exec_viewer'])
    h.withReducerTx(owner, ctx => mod.addMember(ctx, { target: ids[role], name: role, email: `${role}@t`, role }));
  h.withReducerTx(as('admin'), ctx => mod.createIncident(ctx, { title: 'x', severity: 'high', kind: 'ransomware' }));
  return h;
}

test('only owner or admin can add members', () => {
  const h = setup();
  expect(() =>
    h.withReducerTx(as('responder'), ctx =>
      mod.addMember(ctx, { target: ctx.sender, name: 'x', email: 'x', role: 'admin' })
    )
  ).toThrow(/Requires role/);
});

test('responder cannot change phase, exec cannot post in #legal, stranger cannot do anything', () => {
  const h = setup();
  expect(() => h.withReducerTx(as('responder'), ctx => mod.setPhase(ctx, { incidentId: 1n, phase: 'contain' }))).toThrow(/Requires role/);
  const legal = h.withReducerTx(as('admin'), ctx => [...ctx.db.channel.iter()].find(c => c.privileged)!.id);
  expect(() => h.withReducerTx(as('exec_viewer'), ctx => mod.sendMessage(ctx, { channelId: legal, text: 'hi' }))).toThrow(/Privileged/);
  expect(() => h.withReducerTx(as('stranger'), ctx => mod.sendMessage(ctx, { channelId: 1n, text: 'hi' }))).toThrow(/Not a member/);
});

test('admin can remove a member, who then sees nothing; responders cannot remove; last admin stays', () => {
  const h = setup();
  const resp = h.withReducerTx(as('responder'), ctx => ctx.sender);
  expect(() => h.withReducerTx(as('responder'), ctx => mod.removeMember(ctx, { target: resp }))).toThrow(/Requires role/);
  h.withReducerTx(as('admin'), ctx => mod.removeMember(ctx, { target: resp }));
  expect((mod.incidents as any)(h.viewContext(as('responder'))).length).toBe(0);
  expect(() => h.withReducerTx(as('responder'), ctx => mod.sendMessage(ctx, { channelId: 1n, text: 'hi' }))).toThrow(/Not a member/);
  expect(h.withReducerTx(as('admin'), ctx => [...ctx.db.auditLog.iter()].some(a => a.action === 'remove_member'))).toBe(true);
  expect(() => h.withReducerTx(as('admin'), ctx => mod.removeMember(ctx, { target: ctx.sender }))).toThrow(/last admin/);
});

test('last admin cannot demote themselves', () => {
  const h = setup();
  expect(() => h.withReducerTx(as('admin'), ctx => mod.setRole(ctx, { target: ctx.sender, role: 'responder' }))).toThrow(/last admin/);
});

test('views hide everything from strangers and #legal from exec viewers', () => {
  const h = setup();
  h.withReducerTx(as('admin'), ctx => {
    for (const c of ctx.db.channel.iter()) mod.sendMessage(ctx, { channelId: c.id, text: c.name });
  });
  const run = (sub: string, view: (ctx: any) => unknown[]) => view(h.viewContext(as(sub))).length;
  expect(run('stranger', mod.members as any)).toBe(0);
  expect(run('stranger', mod.messages as any)).toBe(0);
  expect(run('exec_viewer', mod.messages as any)).toBe(3);
  expect(run('admin', mod.messages as any)).toBe(4);
  expect(run('responder', mod.auditEntries as any)).toBe(0);
});
