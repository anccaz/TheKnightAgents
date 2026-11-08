// The audit hash chain: our pure SHA-256 must match a real one (the browser verifies with WebCrypto),
// every audit() call must link to the entry before it, and editing any entry must break the chain.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';
import { auditCanonical, sha256Hex } from '../src/auditChain';

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const as = (sub: string) => TestAuth.fromJwtPayload(JSON.stringify({ sub, iss: 'test', aud: ['test'] }), ConnectionId.random());

test('pure SHA-256 matches node crypto (known vectors, unicode, block boundaries)', () => {
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const s of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Froze CHK-4085 — $20,412 ✓ 🔒', '\ud800 lone'])
    expect(sha256Hex(s)).toBe(nodeSha(s));
});

type Row = { id: bigint; at: { microsSinceUnixEpoch: bigint }; actor: { toHexString(): string }; action: string; detail: string; prevHash: string; hash: string };
// Same algorithm as the browser's verifier, with an independent SHA-256.
function firstBroken(rows: Row[]): bigint | null {
  let prev = '';
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const expected = nodeSha(auditCanonical(prev, { id: r.id, atMicros: r.at.microsSinceUnixEpoch, actorHex: r.actor.toHexString(), action: r.action, detail: r.detail }));
    if (r.prevHash !== prev || r.hash !== expected) return r.id;
    prev = r.hash;
  }
  return null;
}

function setup() {
  const h = createModuleTestHarness(mod.default, mod);
  const owner = as('owner');
  h.withReducerTx(owner, ctx => mod.init(ctx, {}));
  const admin = h.withReducerTx(as('admin'), ctx => ctx.sender);
  h.withReducerTx(owner, ctx => mod.addMember(ctx, { target: admin, name: 'Admin', email: 'a@t', role: 'admin' }));
  h.withReducerTx(as('admin'), ctx => mod.createIncident(ctx, { title: 'x', severity: 'high', kind: 'ransomware' }));
  const bob = h.withReducerTx(as('bob'), ctx => ctx.sender);
  h.withReducerTx(as('admin'), ctx => mod.addMember(ctx, { target: bob, name: 'Bob | "quoted" ✓', email: 'b@t', role: 'responder' }));
  return h;
}
const rows = (h: ReturnType<typeof setup>) => h.withReducerTx(as('admin'), ctx => [...ctx.db.auditLog.iter()] as Row[]);

test('every audit entry links to the one before it', () => {
  const h = setup();
  const all = rows(h).sort((a, b) => (a.id < b.id ? -1 : 1));
  expect(all.length).toBeGreaterThanOrEqual(3);
  expect(all[0].prevHash).toBe('');
  for (let i = 1; i < all.length; i++) expect(all[i].prevHash).toBe(all[i - 1].hash);
  expect(firstBroken(all)).toBeNull();
});

test('editing, deleting or re-ordering an entry is detected at that entry', () => {
  const h = setup();
  const all = rows(h).sort((a, b) => (a.id < b.id ? -1 : 1));
  const target = all[1];

  const edited = all.map(r => (r.id === target.id ? { ...r, detail: r.detail + ' (edited)' } : r));
  expect(firstBroken(edited)).toBe(target.id);

  const deleted = all.filter(r => r.id !== target.id);
  expect(firstBroken(deleted)).toBe(all[2].id);

  // Re-sealing the edited entry with a fresh hash still breaks the next link.
  const resealed = edited.map(r =>
    r.id === target.id ? { ...r, hash: nodeSha(auditCanonical(r.prevHash, { id: r.id, atMicros: r.at.microsSinceUnixEpoch, actorHex: r.actor.toHexString(), action: r.action, detail: r.detail })) } : r
  );
  expect(firstBroken(resealed)).toBe(all[2].id);
});
