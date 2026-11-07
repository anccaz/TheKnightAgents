// Pure helpers for the Nessie seed: deterministic fake data + the suspicious-transfer rule.
// Amounts are dollars (Nessie's unit); convert with toCents() before writing to SpacetimeDB.

export const SUSPICIOUS_MIN_DOLLARS = 5000;

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
const MERCHANT_NAMES = ['Avon Grocery Co', 'Knight Fuel', 'Ledger Coffee', 'Vault Electronics', 'Patch Pharmacy'];
const PURCHASE_DESCS = ['groceries', 'fuel', 'coffee', 'electronics', 'pharmacy'];

const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = n => String(n).padStart(2, '0');
const date = (rng, month = 10) => `2026-${pad(month)}-${pad(int(rng, 1, 28))}`;

export const toCents = dollars => Math.round(dollars * 100);

export function fakeAddress(rng) {
  // Avon, TX is fictional; zip is a placeholder in the TX range.
  return { street_number: String(int(rng, 100, 9999)), street_name: pick(rng, STREETS), city: 'Avon', state: 'TX', zip: '75999' };
}

export function fakeCustomer(rng) {
  return { first_name: pick(rng, FIRST), last_name: pick(rng, LAST), address: fakeAddress(rng) };
}

export function merchants(rng) {
  return MERCHANT_NAMES.map(name => ({
    name,
    category: 'retail',
    address: fakeAddress(rng),
    geocode: { lat: 32.9 + rng() / 10, lng: -96.7 - rng() / 10 },
  }));
}

/**
 * Builds the whole bank as a plan with local refs ([customerIdx, accountIdx]); the seed script resolves refs to Nessie ids.
 * Same seed + count => identical plan.
 */
export function generateBank({ count = 200, seed = 42, suspiciousCount = 6 } = {}) {
  const rng = makeRng(seed);
  const merchantList = merchants(rng);
  const customers = [];
  const refs = [];
  for (let ci = 0; ci < count; ci++) {
    const c = fakeCustomer(rng);
    const nAccounts = rng() < 0.5 ? 1 : 2;
    c.accounts = [];
    for (let ai = 0; ai < nAccounts; ai++) {
      const type = ai === 0 ? 'Checking' : 'Savings';
      const purchases = Array.from({ length: int(rng, 1, 3) }, () => {
        const m = int(rng, 0, merchantList.length - 1);
        return { merchant: m, medium: 'balance', purchase_date: date(rng), amount: int(rng, 300, 25000) / 100, description: PURCHASE_DESCS[m] };
      });
      c.accounts.push({ type, nickname: `${c.first_name}'s ${type}`, rewards: 0, balance: int(rng, 500, 40000), purchases });
      refs.push([ci, ai]);
    }
    customers.push(c);
  }

  // Normal transfers: daytime, modest, between existing customers.
  const transfers = [];
  if (refs.length > 1) {
    for (let i = 0; i < Math.ceil(count / 2); i++) {
      const from = pick(rng, refs);
      let to = pick(rng, refs);
      if (to[0] === from[0]) to = refs[(refs.indexOf(to) + 1) % refs.length];
      if (to[0] === from[0]) continue; // only one customer's accounts left
      const hh = int(rng, 9, 18);
      transfers.push({ from, to, medium: 'balance', amount: int(rng, 1000, 150000) / 100, transaction_date: date(rng), description: `Rent/bills ${pad(hh)}:${pad(int(rng, 0, 59))}` });
    }
  }

  // Planted fraud: distinct source accounts -> brand-new payee customer/account, large amount, 2-4 AM.
  const suspicious = [];
  const pool = [...refs];
  const nSuspicious = Math.min(suspiciousCount, pool.length);
  for (let i = 0; i < nSuspicious; i++) {
    const from = pool.splice(int(rng, 0, pool.length - 1), 1)[0];
    const payee = fakeCustomer(rng);
    payee.last_name = `Mule-${payee.last_name}`;
    payee.account = { type: 'Checking', nickname: 'New payee', rewards: 0, balance: 0 };
    const time = `${pad(int(rng, 2, 3))}:${pad(int(rng, 0, 59))}`;
    suspicious.push({
      from,
      payee,
      medium: 'balance',
      amount: int(rng, 7500, 24000),
      transaction_date: '2026-11-07',
      description: `Wire to new payee at ${time} AM`,
    });
  }

  return { merchants: merchantList, customers, transfers, suspicious };
}

/**
 * Suspicious-transfer rule used by the seed (and reusable by fraud watch).
 * Nessie transaction_date is date-only, so the time is read from the description ("HH:MM").
 * @param transfer Nessie transfer ({ payee_id, amount, description })
 * @param newPayees Set of payee account ids considered new (first seen during the incident window)
 * @returns reason string when suspicious, otherwise null
 */
export function isSuspicious(transfer, newPayees = new Set()) {
  const m = /\b(\d{1,2}):(\d{2})\b/.exec(transfer.description ?? '');
  const hour = m ? Number(m[1]) : -1;
  const oddHour = hour >= 2 && hour < 4;
  const big = Number(transfer.amount) >= SUSPICIOUS_MIN_DOLLARS;
  const newPayee = newPayees.has(transfer.payee_id);
  if (!(oddHour && big && newPayee)) return null;
  return `$${Number(transfer.amount).toLocaleString('en-US')} to new payee at ${m[0]} (2-4 AM window)`;
}
