// State breach-notification rules used by the notice priority chart.
// Lane D: VERIFY every rule against current statutes before the demo. Not legal advice.
export type StateRule = {
  name: string;
  customerDays: number | null; // null = "without unreasonable delay"
  agMin: number | null; // residents affected before the Attorney General must be told; null = never required here
  agDays: number | null; // null = same timing as customers / "without unreasonable delay"
  note?: string;
};

export const RULES: Record<string, StateRule> = {
  TX: { name: 'Texas', customerDays: 60, agMin: 250, agDays: 30 },
  CA: { name: 'California', customerDays: 30, agMin: 501, agDays: null, note: 'AG gets a sample notice' },
  FL: { name: 'Florida', customerDays: 30, agMin: 500, agDays: 30 },
  NY: { name: 'New York', customerDays: 30, agMin: 1, agDays: null, note: 'Also notify Dept. of State and State Police' },
};

const DEFAULT_RULE: Omit<StateRule, 'name'> = {
  customerDays: null,
  agMin: null,
  agDays: null,
  note: 'Check state law: most require notice without unreasonable delay',
};

export type Obligation = { who: 'Customers' | 'Attorney General'; dueAt: Date | null; text: string };

export function obligationsFor(state: string, records: number, since: Date): Obligation[] {
  const r = RULES[state] ?? { name: state, ...DEFAULT_RULE };
  const due = (days: number | null) => (days == null ? null : new Date(since.getTime() + days * 86_400_000));
  const out: Obligation[] = [
    {
      who: 'Customers',
      dueAt: due(r.customerDays),
      text: r.customerDays == null ? 'Without unreasonable delay' : `Within ${r.customerDays} days`,
    },
  ];
  if (r.agMin != null && records >= r.agMin)
    out.push({
      who: 'Attorney General',
      dueAt: due(r.agDays ?? r.customerDays),
      text: r.agMin > 1 ? `Required: ${r.agMin}+ residents affected` : 'Required',
    });
  return out;
}

export const stateName = (code: string) => RULES[code]?.name ?? US_NAMES[code] ?? code;

const US_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function countdown(due: Date | null, now: number) {
  if (!due) return 'ASAP';
  const ms = due.getTime() - now;
  if (ms <= 0) return 'OVERDUE';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}
