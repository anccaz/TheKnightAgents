# TheKnightAgents · Breach Room

An out-of-band, real-time **cyber incident command center** for a bank's response team: incident record, live scope of compromised customer data, legal notification clocks, fraud watch and team comms. It runs entirely outside the compromised network.

Built at HackUTD 2026 for **Winstead PC** (Cyber Incident Response Dashboard), **Spacetime** (main track) and **Capital One** (Best Use of Nessie).

## Stack
- **SpacetimeDB** (TypeScript module): every table, permission check and real-time sync
- **React + Vite** client using `spacetimedb/react` hooks
- **Nessie** for synthetic bank customers, accounts and transfers
- **Gemini** for notification-letter drafts (Lane D)

## Setup
1. Install the SpacetimeDB CLI: https://spacetimedb.com/install (Windows: run the PowerShell one-liner there). Redeem credit with code `HACKUTD2026`.
2. Module:
   ```bash
   cd spacetimedb && npm install && npm run typecheck
   spacetime login
   npm run publish:cloud     # or: spacetime start  +  npm run publish:local
   npm run generate          # writes client/src/module_bindings
   ```
3. Client:
   ```bash
   cd client && npm install && cp .env.example .env && npm run dev
   ```
4. Seed Nessie (needs `NESSIE_API_KEY` in root `.env`):
   ```bash
   node scripts/seed-nessie.mjs --reset
   ```
5. First person to open the app clicks **Become admin** (`bootstrapAdmin`), then invites the team.

## Lanes
| Lane | Owner | Owns | Reducers |
|---|---|---|---|
| A | _name_ | Access control, roles, audit log, security hardening (role-filtered views) | `bootstrapAdmin` `createInvite` `acceptInvite` `setRole` |
| B | _name_ | Incident record, phases, timeline, tasks, comms | `createIncident` `setPhase` `addTimelineEvent` `addTask` `toggleTask` `sendMessage` |
| C | _name_ | Nessie seed, scope board, fraud watch | `upsertScopeItem` `raiseFraudAlert` `setFraudAlertStatus` |
| D | _name_ | Legal clocks, Gemini drafts, Devpost, pitch | `startLegalClock` `completeLegalClock` |

**Contract:** tables and reducers are defined in `spacetimedb/src/index.ts`. Only Lane A edits table definitions; ask A for new fields. Merge to `main` every 2–3 hours.

## Working with Claude Code
Project skills live in `.claude/skills/`: `spacetime-module`, `breach-room-ui`, `nessie-api`. `CLAUDE.md` tells each session to load the right one for its folder.
