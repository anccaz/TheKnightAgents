# Knight Agent

**The out-of-band command center for a bank under cyberattack.**

> When a bank gets hacked, its communication infrastructure can no longer be trusted. Knight Agent is the independent command center that keeps security, fraud, legal and leadership coordinated until the bank recovers.

Built at HackUTD 2026.

## The problem
Detection tools tell a bank it has been hacked. What happens in the next hour decides how bad it gets, and that hour usually goes wrong:

- **The attacker may be reading the chat.** In the 2022 Uber breach, the attacker announced it in Uber's own Slack. Email and chat inside the network can't be trusted.
- **The right people hear late.** The alert reaches one engineer while fraud, legal and executives find out hours later.
- **Money keeps moving** while people debate who is allowed to freeze it.
- **Deadlines start immediately.** Bank regulators expect notice within 36 hours, the SEC within 4 business days, and every state has its own customer notice rules.
- **Regulators want proof.** Teams rebuild the timeline from screenshots weeks later.

## What Knight Agent does
**User story:** *As the incident lead at a bank, when our security tools flag an attack at 2 AM, I want one secure room outside our own network where IT, fraud, legal and executives see the same live picture and their next step, so that we contain the attack fast, stop the money moving, and can prove to regulators what we did.*

| Problem | Knight Agent |
|---|---|
| Compromised email and chat | Runs fully outside the bank's network. Members join by ID; there is no shared password. |
| People hear late | **Incoming detections** show up live on every member's screen; executives get automatic status updates in #exec. |
| Nobody knows what to do first | Guided tasks for each of the six NIST phases. Tasks the system can verify tick themselves, and phases advance on their own after a countdown the lead can stop. |
| Money keeps moving | From the **Contain** phase on, fraud transfers of $10,000 or more freeze automatically. Smaller ones wait for a person. |
| "We removed it" is only a claim | **Two-person sign-offs** in Remove threat and Recover: one person does the work, a different lead verifies it. |
| Missed legal deadlines | Marking data stolen starts the deadline clocks, and **Who must we tell first** charts every notice owed by state, deadline and people affected. |
| No proof afterwards | Every action lands in the timeline and an append-only audit log; the after-action summary is built from the record. |

Compared with what banks use today: Slack and Teams live inside the network and keep no incident record. PagerDuty pages engineers but knows nothing about fraud or notice law. SOAR tools automate technical containment but run inside the network and serve only the security team. Knight Agent covers the human and business side of the response.

## Features
- **Incident page.** Declare an incident, then follow a six-phase stepper (Detect, Analyze, Contain, Remove threat, Recover, Lessons learned) with one big "Done with this phase" button. Sections appear as the incident moves on: **What was hit** opens in Analyze, **Fraud: needs a decision** in Contain.
- **Need-to-know access**, enforced on the server. Responders never receive money or customer details; lawyers see deadlines but not money; admins and executives see everything. Details are in the table below.
- **Real bank data from Capital One's Nessie API.** One click imports the bank's customers and transactions. Customer addresses become people affected per state, which drives the notice obligations; withdrawals and bills are scanned for breach-style fraud (large withdrawals between 2 and 4 AM, bills to new payees) and become fraud alerts.
- **AI agents (Gemini).** At every phase change, **Counsel** briefs #legal (deadlines, notices to draft, one legal risk) and **Comms** briefs #exec (situation, money, the next decision). Each agent sees only what its role may see, so Counsel never sees money. The agents advise; people decide.
- **Incident advisor (Gemini).** Ask a question and get an answer built only from this incident's record, with cited sources. It can suggest actions, and each one needs a separate human confirmation.
- **AI notice drafts.** Gemini drafts each breach notice into the privileged #legal channel for a lawyer to review.
- **Live Feed.** The notice priority chart, live deadline countdowns, and one merged feed of chat, timeline and security events. Channels: #general, #containment, #legal (lawyers and leads) and #exec (leadership).
- **Team page.** Admins add members by ID, change roles, remove a compromised member instantly, and read the security event log.
- **Drills and autopilot.** **Run 2 AM drill** plays a scripted ransomware attack on every screen. **Autopilot** plays the attack *and* the response through all six phases in under a minute, and **Run autopilot on this data** does the same on imported Nessie data.
- **After-action summary.** Total time, time to contain, money frozen, notices sent on time, and how much work was automatic versus done by people.

## How it works
There is no app server: the browser talks to SpacetimeDB directly over a websocket, and SpacetimeDB is the whole backend.

- **Reducers are the only way to write.** Each one checks the caller's role, then applies the automatic rules (deadline clocks, freezes, guided tasks, #exec updates) inside the same transaction.
- **Private tables and per-role views.** Every table is private. Clients read only through views that filter by role, so the browser never receives data its user may not see.
- **Scheduled reducers** run the drill, the autopilot and the phase countdown, and reject anyone calling them by hand.
- **Procedures** make the outbound HTTP calls to Gemini and Nessie. API keys live in the database's private environment, never in git or the browser.
- **Live subscriptions.** A change in one browser appears in every other browser instantly.

**Need to know:**

| | Admin | Executive | Incident lead | Responder | Legal |
|---|---|---|---|---|---|
| Phases, tasks, detections, systems hit | yes | yes | yes | yes | yes |
| Record counts, deadlines, notices by state | yes | yes | yes | no | yes |
| Fraud alerts, money frozen, Nessie accounts, #exec | yes | yes | yes | no | no |
| #legal (lawyers and CISO-level leads) | yes | no | yes | no | yes |
| Security event log | yes | yes | no | no | no |

Fraud decisions, Nessie imports and AI agent runs are limited to incident leads and admins.

## Tech stack
| Layer | What we use |
|---|---|
| Backend | SpacetimeDB 2.14 TypeScript module on Maincloud: private tables, per-role views, reducers, scheduled reducers, procedures with outbound HTTP |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Base UI), React Bits (GradientASCII, ParticleText), lucide icons |
| APIs | Capital One Nessie, Google Gemini (Flash-Lite) |
| Testing | Vitest with SpacetimeDB's module test harness (roles, need-to-know, automation, advisor, AI agents, Nessie rules) |

## Getting started

### Run the client against the hosted database
```bash
cd client
npm install
npm run dev
```
Open the URL Vite prints. Without a `client/.env`, the app connects to the shared `breach-room` database on Maincloud. Click **Copy my ID** and send it to an admin over a channel you trust; the page opens once they add you.

### Run everything locally
Install the [SpacetimeDB CLI](https://spacetimedb.com/install), then use three terminals:

```bash
# 1. local server
spacetime start --listen-addr 127.0.0.1:3010
```
```bash
# 2. backend module
cd spacetimedb
npm install
npm run publish:local   # publishes "breach-room" to 127.0.0.1:3010
npm run generate        # writes client/src/module_bindings
npm test
```
```bash
# 3. client: create client/.env with
#    VITE_SPACETIME_URI=ws://127.0.0.1:3010
#    VITE_SPACETIME_DB=breach-room
cd client
npm install
npm run dev
```
On Windows, if `spacetime` is not found: `$env:Path += ";$env:LOCALAPPDATA\SpacetimeDB"` (PowerShell).

### API keys (optional)
Gemini powers the advisor, the AI agents and the notice drafts; Nessie powers the bank data import. Put both in the root `.env` (gitignored, see `.env.example`) and publish with them loaded:
```bash
cd spacetimedb
set -a; . ../.env; set +a
npm run publish:local
```
Publishing from a terminal where a key is not set clears that stored key. To change only the keys later: `spacetime publish --server http://127.0.0.1:3010 breach-room --env-only`. Without a Gemini key, the AI features fall back to rule-based summaries and templates.

### Add the first admin
Open the app, click **Copy my ID**, then the person who published the database runs:
```bash
spacetime call --server http://127.0.0.1:3010 breach-room add_member '{"__identity__":"0x<ID>"}' '"Your Name"' '"you@example.com"' '"admin"'
```
(In Windows PowerShell 5.1, escape the inner double quotes as `\"`.) Drop `--server ...` to target Maincloud. After that, admins add everyone else on the **Team** page.

### Seed the bank in Nessie
```bash
node scripts/seed-nessie.mjs --reset   # "First Avon Bank": fake customers, accounts and planted fraud
node scripts/seed-nessie.mjs --plant   # plant one more fraud withdrawal during a live demo
```
Then click **Import from Nessie (Capital One)** in an incident. A command-line importer also exists: `node scripts/import-nessie.mjs --incident <id> --server maincloud [--watch]`.

## Project structure
```
spacetimedb/            SpacetimeDB TypeScript module
  src/index.ts          tables, views, reducers, drill, autopilot, AI agents
  src/advisor.ts        advisor prompt, citation and action checks
  src/nessie.ts         Nessie fraud rule and batching
  test/                 vitest suites
client/                 React app
  src/pages/home/       home screen
  src/pages/incident/   Incident page
  src/pages/feed/       Live Feed
  src/pages/team/       Team page and join screen
  src/components/       notice chart, advisor, after-action summary, shared UI
  src/lib/notifyRules.ts  state notice rules
scripts/                Nessie seed and import
docs/                   plan and demo script
```

## Notes and limits
- The legal rules (federal deadlines and state notice rules for TX, CA, FL, NY, plus first drafts for GA, NC and TN) are for the demo and are not legal advice.
- Nessie has no freeze endpoint, so freezes are recorded in Knight Agent as the team's decision. In production, this is where the bank's core system would be called.
- The AI agents' role limits are applied in our code rather than through real member accounts; they only advise and never act.
- The technical id `breach-room` (database name, package names) is kept from the project's earlier name so existing databases and logins keep working.

## Team
Annie, Navya, Kavya and Sameeraa, at HackUTD 2026, for the Winstead PC, Spacetime and Capital One tracks.
