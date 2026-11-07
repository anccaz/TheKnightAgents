# Breach Room (TheKnightAgents) — HackUTD 2026

Out-of-band cyber incident command center for a bank. Tracks: Winstead (incident dashboard), Spacetime (real-time backend), Capital One (Nessie). Full plan: docs/plan.md.

## Layout
- `spacetimedb/` — SpacetimeDB module, the data contract. Skill: `spacetime-module`.
- `client/` — Vite + React UI. Skill: `breach-room-ui`.
- `scripts/` — Nessie seed + fraud rules. Skill: `nessie-api`.

## Rules for every Claude session on this repo
- Load the matching skill before editing a folder.
- Stay in your lane's files (see README "Lanes"). Only Lane A edits table definitions.
- Repo is PUBLIC (Spacetime rule): no secrets, no sponsor-confidential challenge text. Keys go in `.env` (gitignored).
- Commit messages: no Claude/Anthropic attribution or Co-Authored-By trailers.
