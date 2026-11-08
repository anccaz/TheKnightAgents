import { expect, test } from 'vitest';
import { accountLabel, batch, countByState, isSuspicious, normalizeActivity } from '../src/nessie';

test('fraud rule: big, 2-4 AM, and bills need a new payee', () => {
  expect(isSuspicious(normalizeActivity('withdrawal', { _id: 'w', amount: 12000, description: 'Cash withdrawal at 02:41 AM' }))).toMatch(/withdrawal at 02:41/);
  expect(isSuspicious(normalizeActivity('withdrawal', { _id: 'w', amount: 12000, description: 'ATM withdrawal 14:10' }))).toBeNull();
  expect(isSuspicious(normalizeActivity('withdrawal', { _id: 'w', amount: 400, description: 'at 03:10 AM' }))).toBeNull();
  expect(isSuspicious(normalizeActivity('bill', { _id: 'b', payment_amount: 7000, nickname: 'New payee wire at 03:05 AM', payee: 'Mule-Stubbs LLC' }))).toMatch(/new payee/);
  expect(isSuspicious(normalizeActivity('bill', { _id: 'b', payment_amount: 7000, nickname: 'at 03:05 AM', payee: 'Avon Electric' }))).toBeNull();
});

test('states, labels and wrapping batches', () => {
  expect([...countByState([{ _id: '1', address: { state: 'tx' } }, { _id: '2', address: { state: 'TX' } }, { _id: '3', address: { state: 'Texas' } }])]).toEqual([['TX', 2]]);
  expect(accountLabel({ _id: 'abcd-1234', type: 'Savings' })).toBe('SAV-1234');
  expect(batch([1, 2, 3, 4, 5], 0, 2)).toEqual({ picked: [1, 2], next: 2 });
  expect(batch([1, 2, 3, 4, 5], 4, 2)).toEqual({ picked: [5, 1], next: 1 });
  expect(batch([1, 2], 0, 10)).toEqual({ picked: [1, 2], next: 0 });
});
