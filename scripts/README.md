# Nessie seed (First Avon Bank)
- Put `NESSIE_API_KEY=...` in the repo-root `.env` (or export it). Never commit it.
- Preview without network: `node scripts/seed-nessie.mjs --dry-run --count 5`
- Seed for real: `node scripts/seed-nessie.mjs --reset --count 200` (wipes your key's Customers/Accounts first; writes `scripts/seed-output.json` with ids and the planted `suspicious` transfers).
- Tests: `node --test scripts/*.test.mjs` (fake data is deterministic: same `--count` gives the same bank).
