import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBank, isSuspicious, makeRng, normalizeActivity, countByState, accountLabel, pmap, STATE_INFO, LIVE_TARGET_MIN_BALANCE } from './lib.mjs';

const asItem = s =>
  s.kind === 'bill'
    ? normalizeActivity('bill', { _id: 'x', ...s.body })
    : normalizeActivity('withdrawal', { _id: 'x', ...s.body });

test('generation is deterministic per seed', () => {
  assert.deepEqual(generateBank({ count: 20, seed: 7 }), generateBank({ count: 20, seed: 7 }));
  assert.notDeepEqual(generateBank({ count: 20, seed: 7 }), generateBank({ count: 20, seed: 8 }));
  assert.equal(makeRng(1)(), makeRng(1)());
});

test('generated bank has the expected shape', () => {
  const bank = generateBank({ count: 50 });
  assert.equal(bank.customers.length, 50);
  const states = new Set();
  for (const c of bank.customers) {
    assert.ok(c.accounts.length >= 1 && c.accounts.length <= 2);
    assert.ok(c.address.state in STATE_INFO, `known state ${c.address.state}`);
    states.add(c.address.state);
    for (const a of c.accounts) {
      assert.ok(Array.isArray(a.withdrawals) && Array.isArray(a.bills));
      assert.equal(a.purchases, undefined);
    }
  }
  assert.ok(states.size >= 3, 'several states so the chart has several bubbles');
  assert.equal(bank.suspicious.length, 6);
  assert.equal(new Set(bank.suspicious.map(s => s.from.join())).size, 6, 'distinct source accounts');
  assert.ok(bank.suspicious.some(s => s.kind === 'bill') && bank.suspicious.some(s => s.kind === 'withdrawal'));
  assert.ok(bank.suspicious.filter(s => s.kind === 'withdrawal' && s.body.amount >= 10000).length >= 3, 'auto-freeze candidates');
  assert.ok(bank.suspicious.filter(s => s.kind === 'bill').every(s => s.body.payment_amount < 10000), 'bills stay open for a decision');
  assert.equal(bank.liveTargets.length, 5);
  const used = new Set(bank.suspicious.map(s => s.from.join()));
  for (const r of bank.liveTargets) assert.ok(!used.has(r.join()), 'live targets are clean accounts');
  const tiny = generateBank({ count: 3 });
  const tinyAccounts = tiny.customers.reduce((n, c) => n + c.accounts.length, 0);
  assert.equal(tiny.suspicious.length, Math.min(6, tinyAccounts), 'small banks still get as many as fit');
});

test('planted activity passes isSuspicious; normal activity does not', () => {
  const bank = generateBank({ count: 50 });
  for (const s of bank.suspicious) assert.ok(isSuspicious(asItem(s)), JSON.stringify(s));
  for (const c of bank.customers)
    for (const a of c.accounts) {
      for (const w of a.withdrawals) assert.equal(isSuspicious(normalizeActivity('withdrawal', { _id: 'n', ...w })), null);
      for (const b of a.bills) assert.equal(isSuspicious(normalizeActivity('bill', { _id: 'n', ...b })), null);
    }
});

test('isSuspicious needs amount threshold AND 2-4 AM (and a new payee for bills)', () => {
  const w = { kind: 'withdrawal', amount: 9000, description: 'Cash at 02:47 AM' };
  assert.match(isSuspicious(w), /withdrawal at 02:47/);
  assert.match(isSuspicious({ ...w, description: 'x 3:59' }), /3:59/);
  assert.equal(isSuspicious({ ...w, amount: 4999.99 }), null, 'below threshold');
  assert.equal(isSuspicious({ ...w, description: 'at 04:00' }), null, 'hour 4 excluded');
  assert.equal(isSuspicious({ ...w, description: 'at 01:59' }), null, 'hour 1 excluded');
  assert.equal(isSuspicious({ ...w, description: 'no time' }), null, 'no time');
  const b = { kind: 'bill', amount: 7000, description: 'wire 02:10', payee: 'Mule-X LLC' };
  assert.match(isSuspicious(b), /new payee Mule-X LLC/);
  assert.equal(isSuspicious({ ...b, payee: 'Avon Electric' }), null, 'known payee');
});

test('planted withdrawals and live targets are funded', () => {
  const bank = generateBank();
  const acct = ([ci, ai]) => bank.customers[ci].accounts[ai];
  for (const s of bank.suspicious) {
    const amount = s.kind === 'withdrawal' ? s.body.amount : s.body.payment_amount;
    assert.ok(acct(s.from).balance > amount, `balance covers ${s.kind} of ${amount}`);
  }
  for (const r of bank.liveTargets) assert.ok(acct(r).balance >= LIVE_TARGET_MIN_BALANCE);
});

test('default bank fills all five states', () => {
  const states = new Set(generateBank().customers.map(c => c.address.state));
  assert.deepEqual([...states].sort(), ['CA', 'FL', 'NY', 'OK', 'TX']);
});

test('countByState, accountLabel, pmap', async () => {
  const m = countByState([{ address: { state: 'tx' } }, { address: { state: 'TX' } }, { address: { state: 'CA' } }, { address: {} }, {}]);
  assert.deepEqual([...m], [['TX', 2], ['CA', 1]]);
  assert.equal(accountLabel({ _id: 'abc123def', type: 'Savings' }), 'SAV-3DEF');
  assert.equal(accountLabel({ _id: 'abc123def', type: 'Checking' }), 'CHK-3DEF');
  assert.deepEqual(await pmap([1, 2, 3, 4, 5], 2, async x => x * 2), [2, 4, 6, 8, 10]);
});
