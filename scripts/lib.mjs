// Pure helpers for the Nessie seed + importer: deterministic fake data and the suspicious-activity rule.
// Amounts are dollars (Nessie's unit); convert with toCents() before writing to SpacetimeDB.

export const SUSPICIOUS_MIN_DOLLARS = 5000;
export const LIVE_TARGET_MIN_BALANCE = 75_000; // covers 5 `--plant` runs

// Payees the bank's customers normally pay; anything else on a 2-4 AM bill is a "new payee".
export const KNOWN_PAYEES = new Set(['Avon Electric', 'Knight Water', 'Ledger Internet', 'Vault Insurance', 'Patch Rent']);

// Where customers live (weights = share of customers). Drives the notice priority chart.
export const STATE_INFO = {
  TX: { city: 'Richardson', zip: '75080', weight: 55 },
  CA: { city: 'Fresno', zip: '93701', weight: 20 },
  FL: { city: 'Tampa', zip: '33602', weight: 12 },
  NY: { city: 'Albany', zip: '12207', weight: 8 },
  OK: { city: 'Tulsa', zip: '74103', weight: 5 },
};
const STATE_BAG = Object.entries(STATE_INFO).flatMap(([s, i]) => Array(i.weight).fill(s));

// mulberry32: tiny seeded PRNG, returns floats in [0, 1).
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Testy', 'Sample', 'Demo', 'Faux', 'Mock', 'Dummy', 'Placeholder', 'Fakey', 'Proto', 'Stubby', 'Lorem', 'Ipsum'];
const LAST = ['McFakerson', 'Notreal', 'Fakeworth', 'Mockingbird', 'Testington', 'Sampleton', 'Dummyfield', 'Stubbs', 'Fixtureson', 'Seedly'];
const STREETS = ['Avon Main St', 'Breach Ave', 'Ledger Ln', 'Vault Rd', 'Firewall Way', 'Patch Blvd'];

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = n => String(n).padStart(2, '0');
const date = (rng, month = 10) => `2026-${pad(month)}-${pad(int(rng, 1, 28))}`;

export const toCents = dollars => Math.round(dollars * 100);

export function fakeAddress(rng) {
  const state = pick(rng, STATE_BAG);
  const { city, zip } = STATE_INFO[state];
  return { street_number: String(int(rng, 100, 9999)), street_name: pick(rng, STREETS), city, state, zip };
}

export function fakeCustomer(rng) {
  return { first_name: pick(rng, FIRST), last_name: pick(rng, LAST), address: fakeAddress(rng) };
}

/**
 * Builds the whole bank as a plan with local refs ([customerIdx, accountIdx]); the seed script resolves refs to Nessie ids.
 * Same seed + count => identical plan.
 * - suspicious: planted fraud, alternating large withdrawals (>= $10k, auto-freeze) and new-payee bills ($5.5-9.5k, needs a decision), all "2-4 AM".
 * - liveTargets: accounts kept clean so `seed-nessie.mjs --plant` can add fraud live during the demo.
 */
export function generateBank({ count = 260, seed = 42, suspiciousCount = 6, liveTargetCount = 5 } = {}) {
  const rng = makeRng(seed);
  const customers = [];
  const refs = [];
  for (let ci = 0; ci < count; ci++) {
    const c = fakeCustomer(rng);
    const nAccounts = rng() < 0.5 ? 1 : 2;
    c.accounts = [];
    for (let ai = 0; ai < nAccounts; ai++) {
      const type = ai === 0 ? 'Checking' : 'Savings';
      const withdrawals = Array.from({ length: int(rng, 0, 2) }, () => ({
        medium: 'balance',
        transaction_date: date(rng),
        status: 'completed',
        amount: int(rng, 2000, 60000) / 100,
        description: `ATM withdrawal ${pad(int(rng, 9, 18))}:${pad(int(rng, 0, 59))}`,
      }));
      const bills =
        rng() < 0.6
          ? [{ status: 'pending', payee: pick(rng, [...KNOWN_PAYEES]), nickname: 'Monthly bill', payment_date: date(rng, 11), recurring_date: int(rng, 1, 28), payment_amount: int(rng, 3000, 30000) / 100 }]
          : [];
      c.accounts.push({ type, nickname: `${c.first_name}'s ${type}`, rewards: 0, balance: int(rng, 500, 40000), withdrawals, bills });
      refs.push([ci, ai]);
    }
    customers.push(c);
  }

  const suspicious = [];
  const pool = [...refs];
  const nSuspicious = Math.min(suspiciousCount, pool.length);
  for (let i = 0; i < nSuspicious; i++) {
    const from = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
    const time = `${pad(int(rng, 2, 3))}:${pad(int(rng, 0, 59))}`;
    if (i % 2 === 0) {
      suspicious.push({
        from,
        kind: 'withdrawal',
        body: { medium: 'balance', transaction_date: '2026-11-07', status: 'completed', amount: int(rng, 10000, 24000), description: `Cash withdrawal at ${time} AM` },
      });
    } else {
      suspicious.push({
        from,
        kind: 'bill',
        body: { status: 'pending', payee: `Mule-${pick(rng, LAST)} LLC`, nickname: `New payee wire at ${time} AM`, payment_date: '2026-11-07', recurring_date: 7, payment_amount: int(rng, 5500, 9500) },
      });
    }
  }

  const liveTargets = [];
  for (let i = 0; i < Math.min(liveTargetCount, pool.length); i++) liveTargets.push(pool.splice(int(rng, 0, pool.length - 1), 1)[0]);

  // Funded accounts: a planted withdrawal never exceeds its balance (Nessie may reject that, and it looks fake),
  // and live targets can absorb several `--plant` withdrawals (~$12-13k each).
  const accountAt = ([ci, ai]) => customers[ci].accounts[ai];
  for (const s of suspicious) {
    const a = accountAt(s.from);
    const amount = s.kind === 'withdrawal' ? s.body.amount : s.body.payment_amount;
    a.balance = Math.max(a.balance, amount + int(rng, 2000, 8000));
  }
  for (const r of liveTargets) accountAt(r).balance = Math.max(accountAt(r).balance, LIVE_TARGET_MIN_BALANCE);

  return { customers, suspicious, liveTargets };
}

/** Turns a raw Nessie withdrawal or bill into { kind, ref, amount, description, payee? }. */
export function normalizeActivity(kind, raw) {
  if (kind === 'bill')
    return { kind: 'bill', ref: raw._id, amount: Number(raw.payment_amount), description: raw.nickname ?? '', payee: raw.payee ?? '' };
  return { kind: 'withdrawal', ref: raw._id, amount: Number(raw.amount), description: raw.description ?? '' };
}

/**
 * Suspicious-activity rule (seed + importer). Nessie dates have no time of day, so the time is read
 * from the description/nickname ("HH:MM"). Bills also need a payee outside knownPayees.
 * @returns reason string when suspicious, otherwise null
 */
export function isSuspicious(item, knownPayees = KNOWN_PAYEES) {
  const m = /\b(\d{1,2}):(\d{2})\b/.exec(item.description ?? '');
  const hour = m ? Number(m[1]) : -1;
  const oddHour = hour >= 2 && hour < 4;
  const big = Number(item.amount) >= SUSPICIOUS_MIN_DOLLARS;
  if (!(oddHour && big)) return null;
  const amount = `$${Number(item.amount).toLocaleString('en-US')}`;
  if (item.kind === 'bill') {
    if (knownPayees.has(item.payee)) return null;
    return `${amount} bill to new payee ${item.payee} at ${m[0]} (2-4 AM window)`;
  }
  return `${amount} withdrawal at ${m[0]} (2-4 AM window)`;
}

/** Customers per 2-letter state code, from Nessie customer objects. */
export function countByState(customers) {
  const out = new Map();
  for (const c of customers) {
    const s = String(c.address?.state ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

/** Short readable account label, e.g. CHK-AB12 (last 4 of the Nessie id). */
export function accountLabel(account) {
  const prefix = account.type === 'Savings' ? 'SAV' : account.type === 'Credit Card' ? 'CC' : 'CHK';
  return `${prefix}-${String(account._id).slice(-4).toUpperCase()}`;
}

/** Runs fn over items with at most n in flight; results keep input order. */
export async function pmap(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
