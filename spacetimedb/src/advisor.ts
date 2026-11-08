// Incident advisor: pure helpers (no database access), so tests can call them directly.
// The model only ever sees FACTS we hand it, and everything it returns is checked against those facts:
// citations to unknown tags are removed, actions must point at a real, still-open target, and the
// action labels shown to the user are rebuilt from our records, never taken from the model.

export const ADVISOR_ACTION_TYPES = [
  'complete_task',
  'set_phase',
  'freeze_alert',
  'dismiss_alert',
  'mark_notice_drafted',
  'mark_notice_sent',
  'file_deadline',
  'stay_in_phase',
] as const;
export type AdvisorActionType = (typeof ADVISOR_ACTION_TYPES)[number];

export type AdvisorFacts = {
  lines: string[]; // every fact the model may cite, each starting with its [TAG]
  phase: string;
  phases: readonly string[];
  phaseLabels: Record<string, string>;
  tasks: { tag: string; id: string; title: string; phase: string; done: boolean }[]; // tag "K12", id "12"
  alerts: { tag: string; id: string; label: string; status: string }[]; // tag "F3"
  clocks: { tag: string; id: string; label: string; done: boolean; msLeft: number }[]; // tag "D4"
  notices: { tag: string; key: string; label: string; status: string; msLeft: number | null }[]; // tag "Q1", key "TX-Customers"
};

/** target = the fact tag shown to people; ref = the real id the client acts on (task/alert/clock id, notice key, phase). */
export type AdvisorAction = { type: AdvisorActionType; target: string; ref: string; label: string; reason: string };
export type AdvisorReply = { answer: string; actions: AdvisorAction[]; source: 'ai' | 'rules'; model?: string };

const clipText = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');

export function left(ms: number | null): string {
  if (ms == null) return 'as soon as possible';
  if (ms <= 0) return 'OVERDUE';
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d ? `in ${d}d ${h}h` : `in ${h}h ${m}m`;
}

function validTags(f: AdvisorFacts) {
  return new Set(['I', 'P', ...f.lines.map(l => /^\[([A-Z][A-Za-z0-9]*)\]/.exec(l)?.[1]).filter((t): t is string => !!t)]);
}

/** Remove citation tags the facts don't contain, so the UI never shows a made-up source. */
export function stripUnknownTags(text: string, f: AdvisorFacts): string {
  const ok = validTags(f);
  return text.replace(/\[([A-Z][A-Za-z0-9]*)\]/g, (whole, tag: string) => (ok.has(tag) ? whole : '')).replace(/ {2,}/g, ' ').trim();
}

/** Keep only actions that target something real and still actionable; labels come from our records. */
export function checkActions(raw: unknown, f: AdvisorFacts): AdvisorAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AdvisorAction[] = [];
  const seen = new Set<string>();
  const label = (s: string) => f.phaseLabels[s] ?? s;
  for (const a of raw.slice(0, 5)) {
    const type = (a as { type?: unknown })?.type as AdvisorActionType;
    const target = clipText((a as { target?: unknown })?.target, 80).replace(/^\[|\]$/g, '');
    const reason = stripUnknownTags(clipText((a as { reason?: unknown })?.reason, 300), f);
    if (!ADVISOR_ACTION_TYPES.includes(type)) continue;
    let made: AdvisorAction | null = null;
    if (type === 'complete_task') {
      const t = f.tasks.find(x => x.tag === target && !x.done);
      if (t) made = { type, target: t.tag, ref: t.id, label: `Mark task done: "${t.title}"`, reason };
    } else if (type === 'set_phase') {
      if (f.phases.includes(target) && target !== f.phase) made = { type, target, ref: target, label: `Move incident to phase: ${label(target)}`, reason };
    } else if (type === 'freeze_alert' || type === 'dismiss_alert') {
      const al = f.alerts.find(x => x.tag === target && x.status === 'open');
      if (al) made = { type, target: al.tag, ref: al.id, label: `${type === 'freeze_alert' ? 'Freeze' : 'Dismiss'} fraud alert: ${al.label}`, reason };
    } else if (type === 'mark_notice_drafted' || type === 'mark_notice_sent') {
      const want = type === 'mark_notice_sent' ? 'sent' : 'drafted';
      const n = f.notices.find(x => x.tag === target && x.status !== 'sent' && x.status !== want);
      if (n) made = { type, target: n.tag, ref: n.key, label: `Mark notice ${want}: ${n.label}`, reason };
    } else if (type === 'file_deadline') {
      const c = f.clocks.find(x => x.tag === target && !x.done);
      if (c) made = { type, target: c.tag, ref: c.id, label: `Mark deadline filed: ${c.label}`, reason };
    } else if (type === 'stay_in_phase') {
      made = { type, target: '', ref: '', label: `Stay in ${label(f.phase)} (cancel any automatic move)`, reason };
    }
    if (made && !seen.has(made.type + made.target)) {
      seen.add(made.type + made.target);
      out.push(made);
    }
    if (out.length === 3) break;
  }
  return out;
}

/** Validate a model reply (already parsed JSON). Returns null if it isn't usable. */
export function checkReply(raw: unknown, f: AdvisorFacts, model: string): AdvisorReply | null {
  const answer = stripUnknownTags(clipText((raw as { answer?: unknown })?.answer, 2000), f);
  if (!answer) return null;
  return { answer, actions: checkActions((raw as { actions?: unknown })?.actions, f), source: 'ai', model };
}

/** No AI available: a fixed, fact-only status summary with citations. Never guesses. */
export function ruleBasedReply(f: AdvisorFacts, why: string): AdvisorReply {
  const lab = (p: string) => f.phaseLabels[p] ?? p;
  const open = f.tasks.filter(t => t.phase === f.phase && !t.done);
  const risky = f.clocks.filter(c => !c.done && c.msLeft < 24 * 3_600_000).sort((a, b) => a.msLeft - b.msLeft);
  const alerts = f.alerts.filter(a => a.status === 'open');
  const unsent = f.notices.filter(n => n.status !== 'sent').sort((a, b) => (a.msLeft ?? 0) - (b.msLeft ?? 0));
  const lines = [`Rule-based summary (${why}).`, `- Phase: ${lab(f.phase)} [I]`];
  lines.push(open.length ? `- Open tasks now: ${open.map(t => `${t.title} [${t.tag}]`).join('; ')}` : '- All tasks in this phase are done.');
  if (risky.length) lines.push(`- Deadlines at risk: ${risky.map(c => `${c.label} ${left(c.msLeft)} [${c.tag}]`).join('; ')}`);
  if (alerts.length) lines.push(`- Fraud alerts waiting for a decision: ${alerts.map(a => `${a.label} [${a.tag}]`).join('; ')}`);
  if (unsent.length) lines.push(`- Notices not sent yet: ${unsent.slice(0, 4).map(n => `${n.label} due ${left(n.msLeft)} [${n.tag}]`).join('; ')}`);
  return { answer: lines.join('\n'), actions: [], source: 'rules' };
}

export function advisorPrompt(f: AdvisorFacts, question: string, history: string): string {
  return [
    "You are Knight Agent's incident advisor for a US bank's cyber-incident response team.",
    'RULES (follow strictly):',
    '1. Use ONLY the FACTS below. Do not use outside knowledge about this incident, and never invent names, numbers, dates or tags.',
    '2. After every factual statement, cite the fact tags it comes from in square brackets exactly as written, e.g. [D4] or [K12][T88].',
    '3. If the FACTS do not contain the answer, say exactly: "I don\'t have that in the incident record." and suggest who to ask.',
    '4. You are not a lawyer: for legal questions, state what the record shows and say Legal must confirm.',
    '5. Be brief and practical: at most 6 short bullet points (start lines with "- "), plain words, no markdown headings.',
    `6. You may propose up to 3 actions, only if they directly help. Allowed types: ${ADVISOR_ACTION_TYPES.join(', ')}.`,
    '   target = the fact tag (e.g. K12, F3, D4, Q2), a phase key for set_phase, or "" for stay_in_phase. reason = one sentence with citations.',
    '   A human will review and confirm every action; never claim an action was done.',
    '',
    'FACTS:',
    ...f.lines,
    '',
    history ? `RECENT CHAT (for context only, not facts):\n${history}\n` : '',
    `QUESTION: ${question}`,
  ].join('\n');
}

/** JSON shape we ask Gemini for (responseSchema). */
export const ADVISOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: [...ADVISOR_ACTION_TYPES] },
          target: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['type', 'target', 'reason'],
      },
    },
  },
  required: ['answer', 'actions'],
};
