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
   npm run publish:cloud     # or local: spacetime start --listen-addr 127.0.0.1:3010  +  npm run publish:local
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

## Checklist

Tick boxes as you go (edit this file, commit, push). Deadlines: **initial Devpost 11 PM Sat**, **feature freeze 8 AM Sun**, **final Devpost 12 PM Sun**.

### Everyone, first 30 min
- [ ] Put your name in the Lanes table above
- [ ] Pull `main`, then `npm install` in `spacetimedb/` and `client/`
- [ ] Copy `.env.example` to `.env` (root) and `client/.env.example` to `client/.env`
- [ ] Wait for Lane A's bindings push, pull again, then run `npm run dev` in `client/` and confirm the app loads
- [ ] Work on a branch named after your lane (`lane-a`, ...) and merge to `main` every 2–3 h

### Lane A: access + security (blocks everyone, start here)
- [ ] Install the Spacetime CLI, `spacetime login`, redeem `HACKUTD2026`
- [ ] `npm run publish:cloud` then `npm run generate`; commit `client/src/module_bindings/` and push **ASAP**
- [ ] Fix any client typecheck errors left after bindings (`npx tsc --noEmit` in `client/`)
- [ ] Test the invite flow in two browsers: bootstrap admin → invite → accept → role shows up
- [ ] Replace `public: true` tables with role-filtered views (e.g. `exec_viewer` can't read #legal, only admin reads `auditLog`)
- [ ] Write 3 bullet points for the security pitch: out-of-band hosting, server-side role checks, append-only audit log

### Lane B: incident + comms
- [ ] Two browsers: declare incident → 4 channels appear → timeline updates live on both
- [ ] Fill the "What do I do next?" checklist for each of the 6 NIST phases with real steps
- [ ] Phase stepper, tasks and timeline: make the main path one obvious click each
- [ ] Comms: auto-scroll, sender names, privileged banner on #legal
- [ ] Own the 2 AM demo walkthrough (declare → scope → fraud → legal) and rehearse it

### Lane C: Nessie + scope + fraud
- [ ] Get a Nessie key at the Capital One table and **confirm the endpoints** guessed at the top of `scripts/seed-nessie.mjs`
- [ ] `node scripts/seed-nessie.mjs --reset` and check `scripts/seed-output.json`
- [ ] Scope board: "Load compromised customers" button that bulk-calls `upsertScopeItem` from the seed output
- [ ] Fraud watch: feed `seed-output.json` `suspicious` entries into `raiseFraudAlert` (start with a button, automate later)
- [ ] Freeze/Dismiss updates the timeline live

### Lane D: legal + AI + submission
- [ ] **Initial Devpost by 11 PM**: title, one-liner, select Winstead, Spacetime, Capital One plus MLH Gemini, GoDaddy
- [ ] Verify the SEC 8-K, GDPR and Texas deadlines; fix the presets in `client/src/pages/legal/LegalPage.tsx`
- [ ] Auto-start legal clocks when the first scope item is marked `exfiltrated`
- [ ] Gemini notification-letter draft from scope data. Keep the key **server-side** (Spacetime procedure or a tiny Node endpoint), never in `client/`
- [ ] Register the domain with GoDaddy code `MLHUTD84`
- [ ] Slides, a 3-minute pitch for each sponsor, and a backup demo video by 11 AM Sunday
- [ ] After submitting: write the DEV post (leave out sponsor-confidential challenge text)

**Contract:** tables and reducers are defined in `spacetimedb/src/index.ts`. Only Lane A edits table definitions; ask A for new fields. Merge to `main` every 2–3 hours.

## Working with Claude Code
Project skills live in `.claude/skills/`: `spacetime-module`, `breach-room-ui`, `nessie-api`. `CLAUDE.md` tells each session to load the right one for its folder.
