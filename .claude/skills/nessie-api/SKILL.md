---
name: nessie-api
description: How Knight Agent uses Capital One's Nessie mock-banking API (seeding customers/accounts/transfers, reading them for scope and fraud watch). Use when writing the seed script, scope board data loading, or fraud detection.
---

# Nessie (Capital One hackathon API)

- Base URL: `https://api.nessieisreal.com` (verify at the Capital One table or https://api.nessieisreal.com/documentation, docs may have moved).
- Auth: `?key=NESSIE_API_KEY` query param. The key lives in `.env` only; **never** ship it in the client bundle.
- Common endpoints (verify against the docs before relying on them):
  - `GET/POST /customers`, `GET /customers/{id}/accounts`, `POST /customers/{id}/accounts`
  - `GET/POST /accounts/{id}/transfers`, `GET/POST /accounts/{id}/purchases`, `GET/POST /accounts/{id}/deposits`
  - `GET/POST /merchants`
  - `DELETE /data?type=Customers|Accounts|...` wipes your key's data (seed script reset).
- Amounts are dollars (numbers), not cents; convert to cents (`u64`) before writing to SpacetimeDB.

## How Knight Agent uses it
1. `scripts/seed-nessie.mjs` creates "First Avon Bank": ~200 customers with accounts, purchases and transfers, plus a few planted suspicious transfers (new payee, large amount, 2-4 AM).
2. The scope board marks Nessie customers/accounts as compromised via `upsertScopeItem` (`assetType: 'customer' | 'account'`, `assetRef: <Nessie _id>`).
3. Fraud watch reads transfers for compromised accounts and calls `raiseFraudAlert`. "Freeze" is simulated in SpacetimeDB (Nessie has no freeze endpoint as far as we know).

## Rules
- Seed data is synthetic. No real names/SSNs; use obviously fake names.
- Keep request volume low (sleep between bulk POSTs) to avoid rate limits.
