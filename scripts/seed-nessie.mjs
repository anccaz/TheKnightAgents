#!/usr/bin/env node
// Seeds "First Avon Bank" into Nessie.
// Usage: node scripts/seed-nessie.mjs [--reset] [--count N] [--dry-run]
//        node scripts/seed-nessie.mjs --plant      (add one live fraud withdrawal to a reserved clean account)
//
// Nessie facts (https://nessieisreal.com/docs):
//  - Base https://prod-api.nessieisreal.com, auth via ?key=
//  - POST /customers, POST /customers/{id}/accounts, POST /accounts/{id}/withdrawals|bills
//  - POST responses look like {code, message, objectCreated: {_id, ...}}
//  - No reset endpoint and no customer delete: --reset deletes every account's bills and the accounts one by one.
//  - Dates have no time of day, so planted fraud puts "HH:MM AM" in the description/nickname.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBank, isSuspicious, normalizeActivity, toCents, pmap } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NESSIE_BASE_URL ?? 'https://prod-api.nessieisreal.com';
const OUT_PATH = join(here, 'seed-output.json');
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const dryRun = args.includes('--dry-run');
const plant = args.includes('--plant');
const countIdx = args.indexOf('--count');
// 260 customers (~160 in TX): 250+ records stolen in total, which starts the Texas AG legal clock in the module.
const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 260;
if (!Number.isInteger(count) || count < 1) {
  console.error('--count must be a positive integer');
  process.exit(1);
}

// Minimal .env loader (no dotenv dep); real env vars win.
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const KEY = process.env.NESSIE_API_KEY;
if (!dryRun && !KEY) {
  console.error('NESSIE_API_KEY is not set (env or .env). Use --dry-run to preview without it.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fakeId = 0;

// One request with retry on 429/5xx. The URL carries the key, so errors only ever show the path.
async function request(method, path, body) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(KEY)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    return { status: res.status, ok: res.ok, text };
  }
}

async function get(path, { tolerate400 = false } = {}) {
  if (dryRun) return [];
  const r = await request('GET', path);
  if (r.status === 404) return []; // Nessie answers 404 for "none found"
  // Old bills missing required fields (recurring_date, upcoming_payment_date) fail Nessie's own validation when listed.
  if (r.status === 400 && tolerate400) return [];
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
  return JSON.parse(r.text);
}

async function del(path) {
  if (dryRun) return;
  const r = await request('DELETE', path);
  if (!r.ok && r.status !== 404) throw new Error(`DELETE ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
}

async function post(path, body) {
  if (dryRun) return `dry-${++fakeId}`;
  const r = await request('POST', path, body);
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${r.text.slice(0, 300)}`);
  const json = JSON.parse(r.text);
  const id = json.objectCreated?._id ?? json._id;
  if (!id) throw new Error(`POST ${path}: no _id in response ${r.text.slice(0, 300)}`);
  return id;
}

// ---- --plant: one live fraud event for the demo (the importer's --watch picks it up) ----
if (plant) {
  if (!existsSync(OUT_PATH)) {
    console.error('No seed-output.json. Run the seed first.');
    process.exit(1);
  }
  const out = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  const targets = out.liveTargets ?? [];
  if (!targets.length) {
    console.error('seed-output.json has no liveTargets. Re-run the seed.');
    process.exit(1);
  }
  const used = out.planted ?? [];
  const accountId = targets.find(id => !used.includes(id)) ?? targets[used.length % targets.length];
  const amount = 12_400 + 100 * used.length;
  const time = `02:5${used.length % 10}`;
  const today = new Date().toISOString().slice(0, 10);
  const id = await post(`/accounts/${accountId}/withdrawals`, {
    medium: 'balance',
    transaction_date: today,
    status: 'completed',
    amount,
    description: `Cash withdrawal at ${time} AM`,
  });
  out.planted = [...used, accountId];
  if (!dryRun) writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Planted $${amount.toLocaleString('en-US')} withdrawal ${id} on account ${accountId}${dryRun ? ' [dry-run]' : ''}.`);
  process.exit(0);
}

// ---- seed ----
const bank = generateBank({ count });
const nAccounts = bank.customers.reduce((n, c) => n + c.accounts.length, 0);
const nWithdrawals = bank.customers.reduce((n, c) => n + c.accounts.reduce((m, a) => m + a.withdrawals.length, 0), 0);
const nBills = bank.customers.reduce((n, c) => n + c.accounts.reduce((m, a) => m + a.bills.length, 0), 0);
console.log(
  `${dryRun ? '[dry-run] Would create' : 'Creating'}: ${count} customers, ${nAccounts} accounts, ` +
    `${nWithdrawals} withdrawals, ${nBills} bills, ${bank.suspicious.length} planted fraud items, ${bank.liveTargets.length} live-demo accounts`
);
if (dryRun) {
  const c = bank.customers[0];
  console.log('Sample customer:', JSON.stringify({ ...c, accounts: undefined }));
  console.log('Sample account:', JSON.stringify(c.accounts[0]));
  for (const s of bank.suspicious) console.log('Planted:', s.kind, JSON.stringify(s.body));
}

if (reset) {
  console.log(dryRun ? '[dry-run] Would delete all accounts and their bills' : 'Resetting: deleting every account and bill under this key (customers stay; Nessie has no customer delete)...');
  const accounts = await get('/accounts');
  await pmap(accounts, CONCURRENCY, async a => {
    for (const b of await get(`/accounts/${a._id}/bills`, { tolerate400: true })) await del(`/bills/${b._id}`);
    await del(`/accounts/${a._id}`);
  });
  console.log(`  deleted ${accounts.length} accounts`);
}

const out = { createdAt: new Date().toISOString(), customers: [], accounts: [], suspicious: [], liveTargets: [], planted: [] };
const accountIds = []; // accountIds[ci][ai]
let done = 0;
const perCustomer = await pmap(bank.customers, CONCURRENCY, async c => {
  const { accounts, ...customerBody } = c;
  const customerId = await post('/customers', customerBody);
  const made = [];
  for (const { withdrawals, bills, ...accountBody } of accounts) {
    const accountId = await post(`/customers/${customerId}/accounts`, accountBody);
    made.push({ id: accountId, type: accountBody.type, balanceCents: toCents(accountBody.balance) });
    for (const w of withdrawals) await post(`/accounts/${accountId}/withdrawals`, w);
    for (const b of bills) await post(`/accounts/${accountId}/bills`, b);
  }
  if (++done % 25 === 0) console.log(`  ${done}/${count} customers`);
  return { customerId, name: `${c.first_name} ${c.last_name}`, state: c.address.state, accounts: made };
});
perCustomer.forEach((pc, ci) => {
  out.customers.push({ id: pc.customerId, name: pc.name, state: pc.state });
  accountIds[ci] = pc.accounts.map(a => a.id);
  for (const a of pc.accounts) out.accounts.push({ id: a.id, customerId: pc.customerId, type: a.type, balanceCents: a.balanceCents });
});

for (const s of bank.suspicious) {
  const accountId = accountIds[s.from[0]][s.from[1]];
  const path = s.kind === 'bill' ? `/accounts/${accountId}/bills` : `/accounts/${accountId}/withdrawals`;
  const id = await post(path, s.body);
  const item = normalizeActivity(s.kind, { _id: id, ...s.body });
  out.suspicious.push({ accountId, kind: s.kind, id, amountCents: toCents(item.amount), reason: isSuspicious(item) });
}
out.liveTargets = bank.liveTargets.map(([ci, ai]) => accountIds[ci][ai]);

if (dryRun) {
  console.log('[dry-run] No network calls made; seed-output.json not written.');
} else {
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Done. Wrote scripts/seed-output.json (${out.customers.length} customers, ${out.accounts.length} accounts, ${out.suspicious.length} planted, ${out.liveTargets.length} live targets).`);
}
