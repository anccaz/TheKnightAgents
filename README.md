# TheKnightAgents · Breach Room

An out-of-band, real-time **cyber incident command center** for a bank's response team ("First Avon Bank" in the demo). It keeps the incident record, what data was hit, legal notice deadlines, fraud decisions and team chat in one place, and it runs entirely outside the compromised network, so it still works when the attacker owns email and Slack.

Built at HackUTD 2026 for three tracks:
- **Winstead PC**: Cyber Incident Response Dashboard (secure and isolated, access control, documentation, scope of compromised data, real-time comms).
- **Spacetime**: SpacetimeDB is the whole backend. Every rule is a reducer, every screen is a live subscription.
- **Capital One**: Best Use of Nessie. Nessie customers and transactions feed the notice chart and fraud alerts (Lane C importer).

## Quick start for a teammate (Maincloud, 1 terminal)
```bash
cd client
npm install
npm run dev
```
Open the URL Vite prints. With no `client/.env`, the app connects to the shared `breach-room` database on Maincloud. You will see **Join the response team**: click **Copy my ID** and send it to an admin over a channel you trust. Once they add you, the page opens by itself.

## Local backend setup (3 terminals)
Install the SpacetimeDB CLI first: https://spacetimedb.com/install

1. Terminal 1, the local server:
   ```bash
   spacetime start --listen-addr 127.0.0.1:3010
   ```
2. Terminal 2, the module:
   ```bash
   cd spacetimedb
   npm install
   npm run publish:local   # publishes "breach-room" to 127.0.0.1:3010
   npm run generate        # writes client/src/module_bindings (never hand-edit)
   npm test                # role checks, views, auto-rules
   ```
3. Terminal 3, the client. Create `client/.env` (or copy `client/.env.example`):
   ```
   VITE_SPACETIME_URI=ws://127.0.0.1:3010
   VITE_SPACETIME_DB=breach-room
   ```
   then `cd client && npm install && npm run dev`.

**First admin.** Open the app, click **Copy my ID**, then the person who published the database runs:
```bash
# Git Bash / macOS / Linux (and PowerShell 7.3+)
spacetime call --server http://127.0.0.1:3010 breach-room add_member '{"__identity__":"0x<ID>"}' '"Your Name"' '"you@example.com"' '"admin"'
```
```powershell
# Windows PowerShell 5.1 strips inner double quotes, so escape them
spacetime call --server http://127.0.0.1:3010 breach-room add_member '{\"__identity__\":\"0x<ID>\"}' '\"Your Name\"' '\"you@example.com\"' '\"admin\"'
```
Drop `--server ...` to target Maincloud. CLI reducer names are snake_case (`add_member`); the client uses camelCase. After this, admins add everyone else on the **Team** page.

Cloud publish: `spacetime login` then `npm run publish:cloud` in `spacetimedb/` (add `--delete-data` if a schema change is refused; demo data only). Re-add members by ID afterwards.

## The 3 pages
**Incident.** With no incident, fill in **What is happening?**, **How bad?** and **Type**, then click **Declare incident** (or **Run 2 AM drill**). Once declared: a 6-phase NIST stepper (Detect, Analyze, Contain, Eradicate, Recover, Post-incident) with one big **Done with X: move to Y** button, the **Incident record** built from what has happened, **What do I do next?** (guided tasks for the current phase, plus **Add task**), **What was hit** (record counters, status per system, **Add system**), and **Fraud: needs a decision** with **Freeze** and **It's fine** per alert.

**Live Feed.** **Who must we tell first** at the top: a bubble chart of every notice owed (state customers, state Attorney General, bank regulator, SEC), placed by time left and people affected, with a notice queue where you click **Mark drafted**, **Mark sent** or **Reopen**. Below it, **Deadlines** (live countdowns, mark filed, **Start clock** for a custom one), then one merged feed of chat, timeline and security events with **All / Chat / Auto / Security** filters. The composer sends to the selected channel (#general, #containment, #legal for lawyers and leads only, #exec) or, with **Log as incident note**, writes to the timeline.

**Team** (admins only). **Add member** by ID with a name, email and role (admin, incident lead, responder, legal, exec viewer), change roles from the **Members** list, and read **Security events**, the append-only audit log, with an action filter.

## Demo: Run 2 AM drill
An incident lead clicks **Run 2 AM drill** on the Incident page. A new incident "DRILL: Ransomware at First Avon Bank" opens and a scripted attack plays out over about 90 seconds on every connected screen: an EDR encryption alert, the core banking database encrypted, a ransom note in #general, a 3.1 GB outbound transfer, 12,500 customer records stolen (TX, CA, FL, NY, OK), three fraudulent transfers, and an online banking server accessed. **Stop drill** cancels the remaining steps.

The app reacts on its own (shown as **Auto** in the feed):
- **Legal clocks on stolen data.** The first time data is marked stolen, the deadlines start: bank regulator (36h), SEC 8-K if material (4 business days), Texas AG at 250+ Texans (30 days), Texas customer notices (60 days).
- **$10,000 auto-freeze.** Any fraud alert of $10,000 or more is frozen immediately and written to the audit log. In the drill, $18,750 and $24,000 freeze themselves; the $2,400 one waits for a human under **Fraud: needs a decision**.
- **Guided tasks.** Declaring an incident or changing phase adds that phase's checklist to **What do I do next?**
- **Notice priority chart.** Stolen records per state fill **Who must we tell first**; the team works the queue with **Mark drafted** and **Mark sent** (sending a federal notice also completes its clock; sends are audited).
- **Tasks tick themselves.** Tasks the system can verify (a timeline note exists, systems are listed in What was hit, legal clocks exist, no fraud alert is open, every state's customer notice is sent, every deadline is filed) are checked off automatically. Judgement calls stay manual.
- **Phases advance themselves.** When every task in a phase is done, a banner counts down 30 seconds ("Moving to Contain automatically") and then moves on, unless the incident lead clicks **Stay here**. Re-opening a task cancels the countdown; going back to an earlier phase holds there.
- **Autopilot drill.** **Autopilot** (next to Run 2 AM drill) plays the attack *and* the response: every few seconds it does the next unfinished task of the current phase, freezes open fraud alerts, sends the customer notices and files the deadlines, and walks the incident through all six phases in about 3 minutes. Good for the backup video and a looping demo screen.
- **Status updates in #exec.** On a phase change, when data is stolen, and when a notice is sent, #exec gets a message like "Status update — Phase: Contain · 12,500 records stolen · 5 states affected · 1 notice sent · next deadline in 1d 11h · $42,750 frozen", so executives never have to ask.

Rules live in `spacetimedb/src/index.ts`: `DRILL`, `LEGAL_RULES`, `AUTO_FREEZE_CENTS`, `GUIDED`. State notice rules live in `client/src/lib/notifyRules.ts`. Legal rules are for the demo; verify before relying on them.

Per-sponsor demo scripts: [docs/demo-script.md](docs/demo-script.md).

## Architecture
There is no app server. The browser talks to SpacetimeDB directly over a websocket.
- **Reducers** are the only way to write. Each one checks the caller's role first, then calls shared helpers that apply the auto-rules (clocks, freeze, guided tasks, #exec updates) inside the same transaction.
- **Private tables + views.** Every table is private. Clients read only through views that return nothing to non-members, hide #legal from roles without privilege, and show the audit log to admins only.
- **Scheduled drill.** Each drill step is a row in a scheduled table; SpacetimeDB runs the next step on time and rejects anyone calling it by hand.
- **Live subscriptions.** Every screen is a subscription, so a change in one browser shows up in all of them instantly.

```
spacetimedb/              SpacetimeDB TypeScript module (tables, views, reducers, drill)
  src/index.ts            the whole backend and data contract
  test/                   vitest: roles.test.ts, automation.test.ts
client/                   React 18 + Vite + Tailwind
  src/App.tsx             header, 3 tabs, background
  src/pages/incident/     Incident page
  src/pages/feed/         Live Feed page
  src/pages/team/         Team page + join screen
  src/components/         NotifyPriorityChart, shared hooks, toasts, ui/
  src/lib/notifyRules.ts  state notice rules
  src/module_bindings/    generated, do not edit
scripts/                  Nessie seed and fraud rules (Lane C)
docs/                     plan.md, agent-prompts.md, demo-script.md
```

## Lanes
| Lane | Owner | Owns | Reducers |
|---|---|---|---|
| A | Annie | Access control, roles, audit log, views, Maincloud | `addMember` `setRole` |
| B | Sameeraa | Incident page, Live Feed, notice chart, drill, demo | `createIncident` `setPhase` `addTimelineEvent` `addTask` `toggleTask` `sendMessage` `setNotifyStatus` `startDrill` `stopDrill` |
| C | _name_ | Nessie seed and importer, scope, fraud watch | `upsertScopeItem` `raiseFraudAlert` `setFraudAlertStatus` `setStateImpact` |
| D | _name_ | Legal rules, Gemini drafts, Devpost, pitch | `startLegalClock` `completeLegalClock` |

## Checklist

Tick boxes as you go (edit this file, commit, push). Deadlines: **initial Devpost 11 PM Sat**, **feature freeze 8 AM Sun**, **final Devpost 12 PM Sun**.

### Everyone, first 30 min
- [ ] Put your name in the Lanes table above
- [ ] Pull `main`, then `npm install` in `spacetimedb/` and `client/`
- [ ] Copy `.env.example` to `.env` (root); copy `client/.env.example` to `client/.env` only for a local server
- [ ] Run `npm run dev` in `client/` and confirm the app loads
- [ ] Work on a branch named after your lane and merge to `main` every 2–3 h

### Lane A: access + security
- [x] Install the Spacetime CLI, `spacetime login`, publish to Maincloud, generate bindings
- [x] Role-filtered views: tables are private; non-members see nothing, `exec_viewer` can't read #legal, only admin reads the audit log
- [x] Add-by-ID in two browsers: second browser copies its ID, admin adds it, page opens with the right role
- [ ] Republish Maincloud after every backend merge
- [ ] Tamper-evident audit chain with a "Verify record" button
- [ ] Write 3 bullet points for the security pitch: out-of-band hosting, server-side role checks, append-only audit log

### Lane B: incident + feed + demo
- [x] Incident, Live Feed and Team pages, live across browsers
- [x] Guided "What do I do next?" tasks for all 6 NIST phases
- [x] 2 AM drill (scheduled reducer) with auto legal clocks and $10k auto-freeze
- [x] "Who must we tell first" notice chart with Mark drafted / Mark sent
- [x] Status updates posted to #exec
- [x] README refresh and [docs/demo-script.md](docs/demo-script.md)
- [ ] Record the backup drill video on Maincloud (two browsers side by side)

### Lane C: Nessie + scope + fraud
- [ ] Fix `scripts/seed-nessie.mjs` against the verified Nessie endpoints
- [ ] `scripts/import-nessie.mjs`: customers by state into `set_state_impact`, compromised accounts into `upsert_scope_item`, suspicious withdrawals/bills into `raise_fraud_alert`
- [ ] Document how to run the importer here

### Lane D: legal + AI + submission
- [ ] **Initial Devpost by 11 PM**: title, one-liner, select Winstead, Spacetime, Capital One plus MLH Gemini, GoDaddy
- [ ] Verify the legal rules (`LEGAL_RULES` in the module, `client/src/lib/notifyRules.ts`) with sources
- [x] Auto-start legal clocks when data is first marked stolen
- [ ] Gemini notice draft. Keep the key **server-side** (Spacetime procedure or a tiny Node endpoint), never in `client/`
- [ ] Register the domain with GoDaddy code `MLHUTD84`
- [ ] Slides and a backup demo video by 11 AM Sunday
- [ ] After submitting: write the DEV post (leave out sponsor-confidential challenge text)

**Contract:** tables and reducers are defined in `spacetimedb/src/index.ts`. A new table needs a view and a test; tell Lane A so they republish Maincloud.

## Working with Claude Code
Ready-made prompts per lane, with the current architecture and what is finished, are in [docs/agent-prompts.md](docs/agent-prompts.md): paste the Shared context plus your lane's block into a new chat.

Project skills live in `.claude/skills/`: `spacetime-module`, `breach-room-ui`, `nessie-api`. `CLAUDE.md` tells each session to load the right one for its folder.
