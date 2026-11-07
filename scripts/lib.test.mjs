import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBank, isSuspicious, makeRng } from './lib.mjs';

test('generation is deterministic per seed', () => {
  assert.deepEqual(generateBank({ count: 20, seed: 7 }), generateBank({ count: 20, seed: 7 }));
  assert.notDeepEqual(generateBank({ count: 20, seed: 7 }), generateBank({ count: 20, seed: 8 }));
  assert.equal(makeRng(1)(), makeRng(1)());
});

test('generated bank has the expected shape', () => {
  const bank = generateBank({ count: 50 });
  assert.equal(bank.customers.length, 50);
  for (const c of bank.customers) {
    assert.ok(c.accounts.length >= 1 && c.accounts.length <= 2);
    assert.equal(c.address.city, 'Avon');
    assert.equal(c.address.state, 'TX');
  }
  assert.equal(bank.suspicious.length, 6);
  assert.equal(new Set(bank.suspicious.map(s => s.from.join())).size, 6, 'distinct source accounts');
  for (const t of bank.transfers) assert.notEqual(t.from[0], t.to[0]);
  const tiny = generateBank({ count: 3 });
  const tinyAccounts = tiny.customers.reduce((n, c) => n + c.accounts.length, 0);
  assert.equal(tiny.suspicious.length, Math.min(6, tinyAccounts), 'small banks still get as many as fit');
});

test('planted transfers pass isSuspicious; normal transfers do not', () => {
  const bank = generateBank({ count: 50 });
  for (const s of bank.suspicious) assert.ok(isSuspicious({ ...s, payee_id: 'p' }, new Set(['p'])));
  for (const t of bank.transfers) assert.equal(isSuspicious({ ...t, payee_id: 'p' }, new Set(['p'])), null);
});

test('isSuspicious needs new payee AND amount threshold AND 2-4 AM', () => {
  const fresh = new Set(['new']);
  const base = { payee_id: 'new', amount: 9000, description: 'Wire at 02:47 AM' };
  assert.match(isSuspicious(base, fresh), /new payee/);
  assert.match(isSuspicious({ ...base, description: 'x 3:59' }, fresh), /3:59/);
  assert.equal(isSuspicious({ ...base, payee_id: 'old' }, fresh), null, 'known payee');
  assert.equal(isSuspicious({ ...base, amount: 4999.99 }, fresh), null, 'below threshold');
  assert.equal(isSuspicious({ ...base, description: 'Wire at 04:00' }, fresh), null, 'hour 4 excluded');
  assert.equal(isSuspicious({ ...base, description: 'Wire at 01:59' }, fresh), null, 'hour 1 excluded');
  assert.equal(isSuspicious({ ...base, description: 'no time' }, fresh), null, 'no time');
  assert.equal(isSuspicious(base), null, 'default: no new payees');
});
