// The advisor must never show a made-up source or let the AI act on something that isn't real.
import { expect, test } from 'vitest';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from '../src/index';
import { checkActions, checkReply, ruleBasedReply, stripUnknownTags, type AdvisorFacts } from '../src/advisor';

const facts: AdvisorFacts = {
  lines: ['[I] Incident', '[K12] Task (Contain, open): Reset passwords', '[F3] Fraud alert (open): $2,400', '[D4] Deadline: Regulator, due in 5h 0m'],
  phase: 'contain',
  phases: ['detect', 'analyze', 'contain', 'eradicate', 'recover', 'post_incident'],
  phaseLabels: { contain: 'Contain', eradicate: 'Remove threat' },
  tasks: [
    { tag: 'K12', id: '12', title: 'Reset passwords', phase: 'contain', done: false },
    { tag: 'K13', id: '13', title: 'Unplug machines', phase: 'contain', done: true },
  ],
  alerts: [{ tag: 'F3', id: '3', label: '$2,400 from account CHK-4471', status: 'open' }],
  clocks: [{ tag: 'D4', id: '4', label: 'Regulator', done: false, msLeft: 5 * 3_600_000 }],
  notices: [{ tag: 'Q1', key: 'TX-Customers', label: 'Texas customers', status: 'sent', msLeft: 10 }],
};

test('unknown citation tags are removed, real ones kept', () => {
  expect(stripUnknownTags('Freeze it [F3] per policy [F99] and [Z1].', facts)).toBe('Freeze it [F3] per policy and .');
});

test('actions must target something real and still open; labels come from our records', () => {
  const acts = checkActions(
    [
      { type: 'freeze_alert', target: 'F3', label: 'IGNORED model label', reason: 'Open alert [F3] [X9]' },
      { type: 'freeze_alert', target: 'F99', reason: 'hallucinated alert' },
      { type: 'complete_task', target: 'K13', reason: 'already done' },
      { type: 'complete_task', target: '[K12]', reason: 'still open' },
      { type: 'mark_notice_sent', target: 'Q1', reason: 'already sent' },
      { type: 'delete_everything', target: '', reason: 'not allowed' },
      { type: 'set_phase', target: 'contain', reason: 'same phase' },
    ],
    facts
  );
  expect(acts.map(a => `${a.type}:${a.target}`)).toEqual(['freeze_alert:F3', 'complete_task:K12']);
  expect(acts[0].label).toBe('Freeze fraud alert: $2,400 from account CHK-4471');
  expect(acts[0].reason).toBe('Open alert [F3]');
});

test('a reply without an answer is rejected; a good one is cleaned', () => {
  expect(checkReply({ actions: [] }, facts, 'm')).toBeNull();
  const r = checkReply({ answer: 'Deadline soon [D4][D404]', actions: [{ type: 'file_deadline', target: 'D4', reason: 'r' }] }, facts, 'm')!;
  expect(r.answer).toBe('Deadline soon [D4]');
  expect(r.actions[0].label).toBe('Mark deadline filed: Regulator');
});

test('rule-based reply only states facts, with citations', () => {
  const r = ruleBasedReply(facts, 'no key');
  expect(r.source).toBe('rules');
  expect(r.answer).toContain('Reset passwords [K12]');
  expect(r.answer).toContain('[D4]');
  expect(r.answer).not.toContain('Unplug machines');
  expect(r.actions).toEqual([]);
});

test('askAdvisor answers from rules when no Gemini key is configured, and needs membership', () => {
  const as = (sub: string) => TestAuth.fromJwtPayload(JSON.stringify({ sub, iss: 'test', aud: ['test'] }), ConnectionId.random());
  const h = createModuleTestHarness(mod.default, mod);
  h.withReducerTx(as('owner'), ctx => mod.init(ctx, {}));
  const admin = h.withReducerTx(as('admin'), ctx => ctx.sender);
  h.withReducerTx(as('owner'), ctx => mod.addMember(ctx, { target: admin, name: 'a', email: 'a', role: 'admin' }));
  h.withReducerTx(as('admin'), ctx => mod.createIncident(ctx, { title: 'x', severity: 'high', kind: 'ransomware' }));
  const args = { incidentId: 1n, question: 'What should I do next?', history: '', notices: '[{"key":"TX-Customers","label":"Texas customers","people":10,"dueMs":0}]' };
  const reply = JSON.parse(mod.askAdvisor(h.procedureContext(as('admin')), args) as string);
  expect(reply.source).toBe('rules');
  expect(reply.answer).toMatch(/\[K\d+\]/);
  expect(() => mod.askAdvisor(h.procedureContext(as('stranger')), args)).toThrow(/Not a member/);
});

test('each action carries the real id to act on', () => {
  const acts = checkActions([{ type: 'freeze_alert', target: 'F3', reason: '' }, { type: 'complete_task', target: 'K12', reason: '' }], facts);
  expect(acts.map(a => a.ref)).toEqual(['3', '12']);
});
