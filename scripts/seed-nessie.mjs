#!/usr/bin/env node
// Seeds "First Avon Bank" into Nessie. Usage: node scripts/seed-nessie.mjs [--reset] [--count N] [--dry-run]
//
// ASSUMED (Nessie docs were unreachable when written; verify at the Capital One table):
//  - Base http://api.nessieisreal.com, auth via ?key=
//  - POST /merchants {name, category, address, geocode}
//  - POST /customers {first_name, last_name, address{street_number, street_name, city, state, zip}}
//  - POST /customers/{id}/accounts {type: Checking|Savings, nickname, rewards, balance}
//  - POST /accounts/{id}/purchases {merchant_id, medium, purchase_date, amount, description}
//  - POST /accounts/{id}/transfers {medium, payee_id, amount, transaction_date, description}
//  - POST responses look like {code, message, objectCreated: {_id, ...}}
//  - DELETE /data?type=Customers|Accounts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBank, isSuspicious, toCents } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NESSIE_BASE_URL ?? 'http://api.nessieisreal.com';
const SLEEP_MS = 100;

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const dryRun = args.includes('--dry-run');
const countIdx = args.indexOf('--count');
const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 200;
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

async function api(method, path, body) {
  if (dryRun) return `dry-${++fakeId}`;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${path}${sep}key=${encodeURIComponent(KEY)}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // Never print the URL: it carries the key.
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  await sleep(SLEEP_MS);
  if (method === 'DELETE') return null;
  const json = JSON.parse(text);
  const id = json.objectCreated?._id ?? json._id;
  if (!id) throw new Error(`${method} ${path}: no _id in response ${text.slice(0, 300)}`);
  return id;
}

const bank = generateBank({ count });
const nAccounts = bank.customers.reduce((n, c) => n + c.accounts.length, 0);
const nPurchases = bank.customers.reduce((n, c) => n + c.accounts.reduce((m, a) => m + a.purchases.length, 0), 0);
console.log(
  `${dryRun ? '[dry-run] Would create' : 'Creating'}: ${bank.merchants.length} merchants, ${count} customers, ${nAccounts} accounts, ` +
    `${nPurchases} purchases, ${bank.transfers.length} normal transfers, ${bank.suspicious.length} suspicious transfers (+${bank.suspicious.length} payee customers/accounts)`
);
if (dryRun) {
  const c = bank.customers[0];
  console.log('Sample customer:', JSON.stringify({ ...c, accounts: undefined }));
  console.log('Sample account:', JSON.stringify(c.accounts[0]));
  if (bank.transfers[0]) console.log('Sample transfer:', JSON.stringify(bank.transfers[0]));
  for (const s of bank.suspicious) console.log('Suspicious:', JSON.stringify({ from: s.from, payee: `${s.payee.first_name} ${s.payee.last_name}`, amount: s.amount, description: s.description }));
}

if (reset) {
  console.log(dryRun ? '[dry-run] Would DELETE /data?type=Accounts and Customers' : 'Resetting Accounts and Customers...');
  // Accounts first so customers have no dependents.
  await api('DELETE', '/data?type=Accounts');
  await api('DELETE', '/data?type=Customers');
}

const merchantIds = [];
for (const m of bank.merchants) merchantIds.push(await api('POST', '/merchants', m));

const out = { createdAt: new Date().toISOString(), customers: [], accounts: [], suspicious: [] };
const accountIds = []; // accountIds[ci][ai]
for (const [ci, c] of bank.customers.entries()) {
  const { accounts, ...customerBody } = c;
  const customerId = await api('POST', '/customers', customerBody);
  out.customers.push({ id: customerId, name: `${c.first_name} ${c.last_name}` });
  accountIds[ci] = [];
  for (const { purchases, ...accountBody } of accounts) {
    const accountId = await api('POST', `/customers/${customerId}/accounts`, accountBody);
    accountIds[ci].push(accountId);
    out.accounts.push({ id: accountId, customerId, type: accountBody.type, balanceCents: toCents(accountBody.balance) });
    for (const { merchant, ...p } of purchases) await api('POST', `/accounts/${accountId}/purchases`, { ...p, merchant_id: merchantIds[merchant] });
  }
  if ((ci + 1) % 25 === 0) console.log(`  ${ci + 1}/${count} customers`);
}

for (const { from, to, ...t } of bank.transfers)
  await api('POST', `/accounts/${accountIds[from[0]][from[1]]}/transfers`, { ...t, payee_id: accountIds[to[0]][to[1]] });

for (const { from, payee, ...t } of bank.suspicious) {
  const { account, ...payeeBody } = payee;
  const payeeCustomerId = await api('POST', '/customers', payeeBody);
  const payeeAccountId = await api('POST', `/customers/${payeeCustomerId}/accounts`, account);
  const accountId = accountIds[from[0]][from[1]];
  const transfer = { ...t, payee_id: payeeAccountId };
  const transferId = await api('POST', `/accounts/${accountId}/transfers`, transfer);
  out.suspicious.push({
    accountId,
    transferId,
    payeeAccountId,
    amountCents: toCents(t.amount),
    reason: isSuspicious(transfer, new Set([payeeAccountId])),
  });
}

if (dryRun) {
  console.log('[dry-run] No network calls made; seed-output.json not written.');
} else {
  writeFileSync(join(here, 'seed-output.json'), JSON.stringify(out, null, 2));
  console.log(`Done. Wrote scripts/seed-output.json (${out.customers.length} customers, ${out.accounts.length} accounts, ${out.suspicious.length} suspicious).`);
}
