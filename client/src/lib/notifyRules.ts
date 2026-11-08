// State breach-notification rules used by the notice priority chart.
// NOT LEGAL ADVICE. Checked against the statute text on 2026-11-07; laws change, so Legal must
// re-verify before relying on any number here. The UI says so next to the queue.
//
// Bank caveat: several states treat notice given under the bank's federal regulator / GLBA rules as
// compliant for *customer* notice (e.g. FL 501.171(4)(g), NY GBL 899-aa(2)(b)), but AG and credit-bureau
// notices are usually still owed. We show every obligation and let Legal decide.
export type StateRule = {
  name: string;
  customerDays: number | null; // null = "without unreasonable delay"
  agMin: number | null; // residents affected before the Attorney General must be told; null = never required here
  agDays: number | null; // null = same timing as customers / "without unreasonable delay"
  craMin: number | null; // credit bureaus (consumer reporting agencies) told when MORE than this many people are notified
  craDays: number | null; // null = "without unreasonable delay"
  note?: string;
};

export const RULES: Record<string, StateRule> = {
  // Tex. Bus. & Com. Code 521.053: individuals (b) within 60 days of determining the breach;
  // AG (i) within 30 days if 250+ Texans, via the AG's online form; credit bureaus (h) if >10,000 notified.
  TX: { name: 'Texas', customerDays: 60, agMin: 250, agDays: 30, craMin: 10_000, craDays: null },
  // Cal. Civ. Code 1798.82 as amended by SB 446 (effective 2026-01-01): residents within 30 calendar days of
  // discovery (a)(2)(A); AG gets a sample notice within 15 days AFTER consumers are notified if >500 residents (f),
  // so worst case 30 + 15 = 45 days from discovery. No credit-bureau notice duty (only their phone numbers go in the letter).
  CA: { name: 'California', customerDays: 30, agMin: 501, agDays: 45, craMin: null, craDays: null, note: 'AG gets a sample notice 15 days after customers' },
  // Fla. Stat. 501.171: individuals (4)(a) within 30 days; Dept. of Legal Affairs (3)(a) within 30 days if 500+
  // (15-day extension for good cause); credit bureaus (5) if >1,000, without unreasonable delay.
  FL: { name: 'Florida', customerDays: 30, agMin: 500, agDays: 30, craMin: 1_000, craDays: null },
  // N.Y. Gen. Bus. Law 899-aa: affected persons (2) within 30 days of discovery; AG, Dept. of State and State Police (8)(a)
  // whenever any NY resident is notified; credit bureaus (8)(b) if >5,000 NY residents. DFS-covered entities
  // (a NY-chartered/licensed bank) must also tell DFS within 72 hours under 23 NYCRR 500.17.
  NY: { name: 'New York', customerDays: 30, agMin: 1, agDays: null, craMin: 5_000, craDays: null, note: 'Also notify Dept. of State and State Police; DFS within 72h if DFS-licensed' },
};

// States we have not checked: timing is usually "without unreasonable delay". 1,000 is the most common
// credit-bureau threshold across state laws, so we flag it as a likely duty, not a certain one.
const DEFAULT_RULE: Omit<StateRule, 'name'> = {
  customerDays: null,
  agMin: null,
  agDays: null,
  craMin: 1_000,
  craDays: null,
  note: 'Not checked: most states require notice without unreasonable delay',
};

export type Who = 'Customers' | 'Attorney General' | 'Credit bureaus';
export type Obligation = { who: Who; dueAt: Date | null; text: string };

export const ruleFor = (state: string): StateRule => RULES[state] ?? { name: stateName(state), ...DEFAULT_RULE };

export function obligationsFor(state: string, records: number, since: Date): Obligation[] {
  const r = ruleFor(state);
  const checked = state in RULES;
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
  if (r.craMin != null && records > r.craMin)
    out.push({
      who: 'Credit bureaus',
      dueAt: due(r.craDays),
      text: `${checked ? 'Required' : 'Likely required (check state law)'}: more than ${r.craMin.toLocaleString()} people notified`,
    });
  return out;
}

export function stateName(code: string) {
  return RULES[code]?.name ?? US_NAMES[code] ?? code;
}

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
