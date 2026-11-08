---
name: nessie-api
description: How Knight Agent uses Capital One's Nessie mock-banking API (seeding customers/accounts/withdrawals/bills, importing them into an incident for the notice chart, scope and fraud alerts). Use when writing the seed script, the importer, or fraud detection.
---

# Nessie (Capital One hackathon API)

Verified from https://nessieisreal.com/docs.

- Base URL: `https://prod-api.nessieisreal.com`
- Auth: `?key=NESSIE_API_KEY` query param (log in with GitHub on nessieisreal.com). The key lives in the root `.env` only; **never** ship it in the client bundle, and never print URLs (they carry the key).
- Create + list:
  - customers: `GET/POST /customers`; accounts: `GET/POST /customers/{id}/accounts`, `GET /accounts`
  - `GET/POST /accounts/{id}/deposits|withdrawals`
  - bills: `GET /customers/{id}/bills`, `GET/POST /accounts/{id}/bills`, `PUT/DELETE /bills/{id}`
  - merchants, loans; read-all: `GET /enterprise/customers`
- Transfers: create only (`POST /accounts/{id}/transfers`), read by `GET /transfers/{id}`. **No list endpoint**, so we don't use transfers.
- Purchases: only `GET/PUT/DELETE /purchase/{id}` are documented. Don't rely on them; use withdrawals + bills.
- No reset endpoint and no customer delete. Reset = delete each account's bills and then the account, one by one (customers stay).
- Dates have no time of day: put "HH:MM AM" in the withdrawal `description` or bill `nickname`; the fraud rule reads it from there.
- Bills can be cancelled (`PUT` status) - a real "freeze" action. Knight Agent's freeze is simulated in SpacetimeDB.
- "None found" lists come back as 404; treat as empty.
- Amounts are dollars (numbers). Convert to cents (`toCents`) before calling reducers.

## How Knight Agent uses it
1. `scripts/seed-nessie.mjs [--reset] [--count N]` creates "First Avon Bank": 260 fake customers across TX/CA/FL/NY/OK with accounts, withdrawals and bills, plus 6 planted fraud items (3 withdrawals >= $10k that auto-freeze, 3 new-payee bills $5.5-9.5k that wait for a decision; all 2-4 AM, on accounts funded to cover them) and 5 clean "live target" accounts. Writes `scripts/seed-output.json`. `--plant` adds one live fraud withdrawal for the demo.
2. `scripts/import-nessie.mjs --incident <id> [--server maincloud] [--watch]` pushes it into an incident through `spacetime call`: `set_state_impact` per state (fills the notice chart), one aggregate customer scope item (starts legal clocks), account scope items + `raise_fraud_alert` for suspicious activity (>= $10,000 auto-freezes server-side). Progress is kept in `scripts/import-state.json` per server/db/incident so reruns don't duplicate; `--fresh` forgets it (e.g. after wiping a local database).
3. The CLI identity must be a member (`incident_lead` or `responder`); an admin adds it by ID in Team.

## Rules
- Seed data is synthetic. No real names/SSNs; use obviously fake names.
- Keep request volume low (small concurrency, retry on 429).
- Fraud rule lives in `scripts/lib.mjs` (`isSuspicious`): >= $5,000, 2-4 AM, and for bills a payee outside `KNOWN_PAYEES`.
