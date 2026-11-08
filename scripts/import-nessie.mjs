#!/usr/bin/env node
// Imports the Nessie "First Avon Bank" data into a Breach Room incident (shells out to `spacetime call`).
//
// Usage: node scripts/import-nessie.mjs --incident <id> [--server <name|url>] [--db breach-room]
//                                       [--watch] [--interval 10] [--watch-all] [--all] [--fresh] [--dry-run]
//
//  1. customers grouped by address.state      -> set_state_impact   (fills the notice priority chart)
//  2. one aggregate customer scope item       -> upsert_scope_item  (exfiltrated; starts the legal clocks)
//  3. accounts with fraud                     -> upsert_scope_item  (assetType 'account', assetRef = Nessie _id)
//  4. withdrawals + bills scanned by lib.mjs  -> raise_fraud_alert  (>= $10,000 auto-freezes server-side)
//  --watch keeps polling for new withdrawals/bills (live demo; pair with `seed-nessie.mjs --plant`).
//
// The `spacetime` CLI identity must be a member with role incident_lead or responder (an admin adds it by ID).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isSuspicious, normalizeActivity, countByState, accountLabel, toCents, pmap } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.NESSIE_BASE_URL ?? 'https://prod-api.nessieisreal.com';
const SEED_OUT = join(here, 'seed-output.json');
const STATE_PATH = join(here, 'import-state.json');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const dryRun = flag('--dry-run');
const watch = flag('--watch');
const intervalSec = Number(opt('--interval', '10'));
const SERVER = opt('--server', process.env.SPACETIME_SERVER);
const DB = opt('--db', process.env.SPACETIME_DB ?? 'breach-room');
const incidentRaw = opt('--incident') ?? (/^\d+$/.test(args[0] ?? '') ? args[0] : undefined);
if (!incidentRaw || !/^\d+$/.test(incidentRaw) || !(intervalSec > 0)) {
  console.error('Usage: node scripts/import-nessie.mjs --incident <id> [--server <name|url>] [--watch] [--interval 10] [--watch-all] [--all] [--fresh] [--dry-run]');
  process.exit(1);
}
const incidentId = Number(incidentRaw);

// Minimal .env loader; real env vars win.
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const KEY = process.env.NESSIE_API_KEY;
if (!KEY) {
  console.error('NESSIE_API_KEY is not set (env or root .env).');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// GET a Nessie list. The URL carries the key, so errors only ever show the path.
async function nessieGet(path) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(KEY)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.status === 404) return []; // "none found"
    if (res.status === 400 && path.endsWith('/bills')) return []; // old bills missing required fields can't be listed
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text);
  }
}

// Calls a reducer through the CLI (snake_case name, each argument as JSON). No shell, so no quoting issues.
function stdb(reducer, ...callArgs) {
  const cli = ['call', ...(SERVER ? ['--server', SERVER] : []), DB, reducer, ...callArgs.map(a => JSON.stringify(a))];
  if (dryRun) {
    console.log(`[dry-run] spacetime ${cli.join(' ')}`);
    return;
  }
  try {
    execFileSync('spacetime', cli, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    const msg = String(e.stderr || e.message).trim().split('\n').slice(-3).join(' ');
    throw new Error(`${reducer} failed: ${msg}`);
  }
}

// What we already pushed per server + database + incident, so reruns and --watch never duplicate alerts or timeline
// entries. Keyed by server too: incident 1 on a local server and incident 1 on Maincloud are different incidents.
// --fresh forgets this target's progress (e.g. after wiping a local database, when incident ids restart at 1).
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : {};
const stateKey = `${SERVER ?? 'default'}/${DB}/${incidentId}`;
if (flag('--fresh')) delete state[stateKey];
const mine = (state[stateKey] ??= { scopes: [], alerts: [] });
const save = () => !dryRun && writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const seed = existsSync(SEED_OUT) ? JSON.parse(readFileSync(SEED_OUT, 'utf8')) : null;
const seededIds = seed && !flag('--all') ? new Set(seed.customers.map(c => c.id)) : null;

async function scan(accounts) {
  const found = [];
  await pmap(accounts, 6, async a => {
    const [w, b] = await Promise.all([nessieGet(`/accounts/${a._id}/withdrawals`), nessieGet(`/accounts/${a._id}/bills`)]);
    for (const [kind, rows] of [['withdrawal', w], ['bill', b]])
      for (const raw of rows) {
        const item = normalizeActivity(kind, raw);
        const reason = isSuspicious(item);
        if (reason) found.push({ account: a, item, reason });
      }
  });
  return found;
}

function report(found, nameOf) {
  let raised = 0;
  for (const f of found) {
    const ref = `${f.item.kind}:${f.item.ref}`;
    if (mine.alerts.includes(ref)) continue;
    const label = accountLabel(f.account);
    if (!mine.scopes.includes(f.account._id)) {
      stdb('upsert_scope_item', incidentId, 'account', f.account._id, `Account ${label} (${nameOf(f.account) ?? 'customer'})`, 'exfiltrated', 1);
      mine.scopes.push(f.account._id);
    }
    stdb('raise_fraud_alert', incidentId, label, ref, toCents(f.item.amount), f.reason);
    mine.alerts.push(ref);
    save();
    raised++;
    console.log(`  fraud alert: ${label} ${f.reason}${f.item.amount >= 10000 ? ' -> auto-freeze' : ''}`);
  }
  return raised;
}

async function main() {
  const customers = (await nessieGet('/customers')).filter(c => !seededIds || seededIds.has(c._id));
  const custIds = new Set(customers.map(c => c._id));
  const names = new Map(customers.map(c => [c._id, `${c.first_name} ${c.last_name}`]));
  const accounts = (await nessieGet('/accounts')).filter(a => custIds.has(a.customer_id));
  const nameOf = a => names.get(a.customer_id);
  if (!customers.length) throw new Error('No Nessie customers found. Run scripts/seed-nessie.mjs first (or pass --all).');
  console.log(`Nessie: ${customers.length} customers, ${accounts.length} accounts -> incident ${incidentId} (${SERVER ?? 'default server'}/${DB})`);

  // 1. Notice priority chart
  for (const [st, n] of countByState(customers)) {
    stdb('set_state_impact', incidentId, st, n);
    console.log(`  ${st}: ${n} customers`);
  }
  // 2. One aggregate scope item (per-customer items would flood the timeline); stolen records start the legal clocks.
  stdb('upsert_scope_item', incidentId, 'customer', 'nessie-customers', 'Customer records (First Avon Bank)', 'exfiltrated', customers.length);

  // 3 + 4. Fraud
  console.log('Scanning withdrawals and bills...');
  const found = await scan(accounts);
  console.log(`Raised ${report(found, nameOf)} new fraud alert(s) (${found.length} suspicious item(s) found).`);

  if (!watch) return;
  const hotIds = new Set([...(seed?.liveTargets ?? []), ...found.map(f => f.account._id)]);
  const hot = flag('--watch-all') ? accounts : accounts.filter(a => hotIds.has(a._id));
  console.log(`Watching ${hot.length} account(s) every ${intervalSec}s. Ctrl+C to stop.`);
  for (;;) {
    await sleep(intervalSec * 1000);
    try {
      const n = report(await scan(hot), nameOf);
      if (n) console.log(`  ${new Date().toLocaleTimeString()}: ${n} new alert(s)`);
    } catch (e) {
      console.error(`  poll failed, will retry: ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error(`\n${e.message}`);
  if (/Not a member|Requires role/i.test(e.message))
    console.error(
      'The spacetime CLI identity is not a member with a writer role.\n' +
        '  1. Run: spacetime login show   (copy the identity)\n' +
        '  2. In the app: Team > Add member by ID, role incident_lead or responder.\n' +
        '  3. Rerun this command.'
    );
  process.exit(1);
});
