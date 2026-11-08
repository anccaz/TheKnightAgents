# TheKnightAgents · Knight Agent

> When a bank gets hacked, its communication infrastructure can no longer be trusted. Knight Agent is the independent command center that keeps security, fraud, legal and leadership coordinated until the bank recovers.

An out-of-band, real-time **cyber incident command center** for a bank's response team ("First Avon Bank" in the demo). It keeps the incident record, what data was hit, legal notice deadlines, fraud decisions and team chat in one place, and it runs entirely outside the compromised network, so it still works when the attacker owns email and Slack.

Built at HackUTD 2026 for three tracks:
- **Winstead PC**: Cyber Incident Response Dashboard (secure and isolated, access control, documentation, scope of compromised data, real-time comms).
- **Spacetime**: SpacetimeDB is the whole backend. Every rule is a reducer, every screen is a live subscription.
- **Capital One**: Best Use of Nessie. Nessie customers and transactions feed the notice chart and fraud alerts (Lane C importer).

## Who it's for and why
**Main goal:** detection tools tell a bank it has been hacked. Knight Agent shortens the time from that alarm to a coordinated team acting on the same plan, and proves every step afterwards.

**User story:** *As the incident lead at a bank, when our security tools flag an attack at 2 AM, I want one secure room outside our own network where IT, fraud, legal and executives see the same live picture and their next step, so that we contain the attack fast, stop the money moving, and can prove to regulators what we did.*

Where response breaks today, and what we do about it:
| Problem in the first hour | Knight Agent |
|---|---|
| The attacker may be inside email and Slack (in the 2022 Uber breach the attacker posted in Uber's own Slack) | Runs fully outside the bank's network; members join by ID, no shared password |
| The alert reaches one engineer; fraud, legal and execs hear about it late | **Incoming detections** at the top of the Incident page, live for every member; #exec gets status updates automatically |
| People who rarely do this don't know what to do first | Guided tasks for each NIST phase; tasks the system can check tick themselves |
| Money keeps moving while people debate | From **Contain** on, fraud transfers of $10,000+ freeze automatically; smaller ones wait for a person |
| "We removed it" is a claim, not proof | **Two-person sign-offs** in Remove threat and Recover: one person does it, a different lead verifies it |
| Regulators want a timeline; teams rebuild it from screenshots | Every action lands in the timeline and an audit log nobody can edit; legal deadline clocks and the notice chart follow from what was stolen |

Compared with what banks use today: Slack/Teams live inside the network and have no record; PagerDuty pages engineers but knows nothing about fraud or notice law; SOAR tools (XSOAR, Splunk SOAR) automate technical containment better than we do, but run inside the network and serve only the security team. Knight Agent covers the human and business side of the response.

The product was renamed from "Breach Room" to **Knight Agent**. The technical id `breach-room` is kept on purpose (database name, browser storage keys, package names, the `breach-room-ui` skill), so existing databases and logins keep working.

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

Port 3010 is used because 3000 is often taken; any free port works if you change it in all three places. On Windows, if `spacetime` is not found, add it to the path for that terminal: `$env:Path += ";$env:LOCALAPPDATA\SpacetimeDB"` (PowerShell).

**Switching between local and Maincloud.** `client/.env` decides the server. Delete or rename it (for example to `client/.env.local-dev`) to use Maincloud, then restart `npm run dev`. The browser keeps a separate login per server, so you may need to be added again by ID on the other one. If the app shows a rejected-login screen, it clears the bad token and reloads once by itself.

**AI notice drafts and the incident advisor (optional, Gemini).** Both use the same key. It lives in the database's private environment, never in git or the browser:
```bash
cd spacetimedb
export GEMINI_API_KEY=<your key>   # from https://aistudio.google.com/apikey
npm run publish:local              # or publish:cloud; the CLI picks up declared env vars from the shell
# change only the key later, without republishing code:
spacetime publish --server http://127.0.0.1:3010 breach-room --env-only
```
```powershell
# PowerShell equivalent
$env:GEMINI_API_KEY="<your key>"
spacetime publish --server http://127.0.0.1:3010 breach-room --env-only
```
By default it uses the newest stable Flash-Lite model your key has; set `GEMINI_MODEL=<name>` to pin one. If Gemini is busy it posts a labeled template draft instead; without a key the button shows an error and everything else works.

**Careful:** publishing (or resetting) a database from a terminal where `GEMINI_API_KEY` (or `NESSIE_API_KEY`) is not set clears the stored key. Easiest: keep both in the root `.env` and publish with `set -a; . ../.env; set +a; npm run publish:local` from `spacetimedb/` (Git Bash). If the advisor suddenly says "Rule-based (AI is not configured)", set the key again with `--env-only`. Gemini keys from AI Studio start with `AIza`. Never paste a key into chat or a commit; rotate it if you do.

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
The header always shows the incident ID (for example `INC-2026-0005`, from the database id), the phase, severity, who is online and the connection state. The same ID is the first row of the **Incident record**.

**Incident.** With no incident, fill in **What is happening?**, **How bad?** and **Type**, then click **Declare incident** (or **Run 2 AM drill**). Once declared: a 6-phase NIST stepper (Detect, Analyze, Contain, Remove threat, Recover, Lessons learned) with one big **Done with X: move to Y** button; **Incoming detections** (security alerts, systems hit and fraud, newest first, with a NEW tag and the source); the **Incident record** built from what has happened; **What do I do next?** (guided tasks for the current phase, plus **Add task**; Remove threat and Recover tasks use **I did this** / **Verify** sign-offs); **What was hit** (record counters, status per system, **Quick pick** of common bank systems, rows added by the drill or Nessie marked **Auto**); and **Fraud: needs a decision** with **Freeze** and **It's fine** per alert, plus the list of frozen accounts and whether a person or the system froze them.

**Live Feed.** **Who must we tell first** at the top: a bubble chart of every notice owed (state customers, state Attorney General, bank regulator, SEC), placed by time left and people affected, with a notice queue where you click **Mark drafted**, **Mark sent** or **Reopen**. Below it, **Deadlines** (live countdowns, mark filed, **Start clock** for a custom one), then one merged feed of chat, timeline and security events with **All / Chat / Auto / Security** filters. The composer sends to the selected channel (#general, #containment, #legal for lawyers and leads only, #exec) or, with **Log as incident note**, writes to the timeline.

**Team** (admins only). **Add member** by ID with a name, email and role (admin, incident lead, responder, legal, exec viewer), change roles from the **Members** list, **Remove** a member at once (for example if their laptop is compromised; the last admin cannot be removed, and it is audited), and read **Security events**, the append-only audit log, with an action filter.

## Demo: Run 2 AM drill
An incident lead clicks **Run 2 AM drill** on the Incident page. A new incident "DRILL: Ransomware at First Avon Bank" opens and a scripted attack plays out over about 90 seconds on every connected screen: an EDR encryption alert, the core banking database encrypted, a ransom note in #general, a 3.1 GB outbound transfer, 12,500 customer records stolen (TX, CA, FL, GA, NC, NY, TN), three fraudulent transfers, and an online banking server accessed. **Stop drill** cancels the remaining steps.

The app reacts on its own (shown as **Auto** in the feed):
- **Legal clocks on stolen data.** The first time data is marked stolen, the deadlines start: bank regulator (36h), SEC 8-K if material (4 business days), Texas AG at 250+ Texans (30 days), Texas customer notices (60 days).
- **$10,000 auto-freeze, from Contain on.** Freezing customer accounts is a containment decision, so before Contain a fraud alert of $10,000 or more is only flagged ("Freezes automatically when you reach Contain"). The moment the incident enters Contain, every flagged one freezes in one go, and new ones freeze instantly; each freeze is written to the audit log. In the drill, $18,750 and $24,000 freeze on reaching Contain; the $2,400 one waits for a human under **Fraud: needs a decision**. **Freeze** by hand works in any phase.
- **Two-person sign-offs.** Remove threat (remove the malware, patch the hole, scan for backdoors) and Recover (rebuild from clean backups, verify the hashes of the rebuilt core banking container, confirm clean EDR scans, rotate service account keys) need two people: someone clicks **I did this**, then a *different* incident lead or admin clicks **Verify**. The server enforces it, the task only ticks once verified, the phase can't advance until then, and each step is in the audit log ("Done by Annie · Verified by Maria").
- **Guided tasks.** Declaring an incident or changing phase adds that phase's checklist to **What do I do next?**
- **Notice priority chart.** Stolen records per state fill **Who must we tell first**; the team works the queue with **Mark drafted** and **Mark sent** (sending a federal notice also completes its clock; sends are audited).
- **Tasks tick themselves.** Tasks the system can verify (a timeline note exists, systems are listed in What was hit, legal clocks exist, no fraud alert is open, every state's customer notice is sent, every deadline is filed) are checked off automatically. Judgement calls stay manual.
- **Phases advance themselves.** When every task in a phase is done, a banner counts down 30 seconds ("Moving to Contain automatically") and then moves on, unless the incident lead clicks **Stay here**. Re-opening a task cancels the countdown; going back to an earlier phase holds there.
- **Autopilot drill.** **Autopilot** (next to Run 2 AM drill) plays the attack *and* the response: every few seconds it does the next unfinished task of the current phase (sign-offs are recorded as "Autopilot (drill)"; real incidents need two people), freezes open fraud alerts, sends the customer notices and files the deadlines, and walks the incident through all six phases in under a minute (the attack runs at double speed, a move every 2 seconds, 3-second phase countdowns). Good for the backup video and a looping demo screen.
- **After-action summary.** Appears on the Incident page when the incident reaches Lessons learned (or any time via **Summary**): total time, time to contain, time per phase, records locked/stolen/seen, money frozen (automatic vs by a person), notices sent on time, deadlines filed, tasks done, and how much work was automatic vs by people vs advisor-confirmed. Computed from the existing record; no extra backend.
- **Incident advisor (Gemini).** The **Advisor** button (bottom-left) opens a chat (bottom-right). Every answer is built on the server from this incident's live record only (tasks, timeline, what was hit, fraud alerts, deadlines, notices, chat your role may see), cites its sources as chips, and says "I don't have that in the incident record" instead of guessing. Citations the record doesn't contain are stripped. It can suggest up to 3 actions (complete a task, change phase, freeze/dismiss an alert, mark a notice drafted/sent, file a deadline, stay in phase); each opens a separate confirmation page showing what will run, why, and as whom, and needs a checkbox plus **Proceed**. Confirmed suggestions are logged as "Advisor suggestion confirmed by <name>". Without a Gemini key (or when Gemini is busy) it answers with a rule-based, facts-only summary.
- **Status updates in #exec.** On a phase change, when data is stolen, and when a notice is sent, #exec gets a message like "Status update — Phase: Contain · 12,500 records stolen · 5 states affected · 1 notice sent · next deadline in 1d 11h · $42,750 frozen", so executives never have to ask.

Rules live in `spacetimedb/src/index.ts`: `DRILL`, `LEGAL_RULES`, `AUTO_FREEZE_CENTS`, `GUIDED`. State notice rules live in `client/src/lib/notifyRules.ts`: checked rules for TX, CA, FL, NY, and unverified first drafts for the other Winstead PC office states GA, NC, TN (marked "Unverified" in the code). Any other state still shows, with a "not checked" default; the full list of state names there is only for labels. Legal rules are for the demo; verify before relying on them.

Per-sponsor demo scripts: [docs/demo-script.md](docs/demo-script.md). A recorded 2.5-minute autopilot demo with voice-over exists locally in `demo/knight-agent-demo.mp4` (not committed; videos are too big for git, share it through Drive or Devpost).

## Demo: real bank data from Nessie (Capital One)
**In the app (one click).** On the Incident page, **Import from Nessie (Capital One)** sits in Incoming detections. The server (a SpacetimeDB procedure, like the Gemini calls) reads Nessie: customers by state fill **Who must we tell first**, their records are marked stolen (legal clocks start), and withdrawals/bills are scanned with the same fraud rule as the CLI importer. Procedures make HTTP calls one at a time, so each click checks the next 20 accounts plus the "hot" ones (the live `--plant` targets and accounts already flagged); click again for the next batch. Reruns never duplicate alerts. It needs `NESSIE_API_KEY` in the database environment (publish with it set, or `--env-only`). Tested locally: 786 customers in 6 states, 3 real planted withdrawals flagged in about 15 seconds. Live moment: run `node scripts/seed-nessie.mjs --plant`, then click **Check next accounts in Nessie**: the new withdrawal appears (and freezes if the team is in Contain).

Freezes are recorded in Knight Agent as the team's decision; Nessie has no freeze endpoint, so nothing is changed in Nessie itself. In production this is where the bank's core system would be called.

**From the terminal.** Instead of the scripted drill, an incident can be filled from Capital One's Nessie API. Put `NESSIE_API_KEY=...` in the root `.env` (never commit it). The `spacetime` CLI identity must be a member: run `spacetime login show`, then add that ID on **Team** (incident lead or admin if it should also create incidents, responder is enough to import).

**1. Seed the bank** (about 1 minute):
```bash
node scripts/seed-nessie.mjs --reset          # "First Avon Bank": 260 fake customers in TX/CA/FL/NY/OK, 6 planted fraud items
```
**2. Get a clean incident.** The app always shows the newest incident, and the declare form only appears when there is none. Don't import into a drill incident (its fake numbers mix with Nessie's). Create one from the CLI and note the ID it gets (`INC-2026-0005` means ID 5):
```bash
spacetime call --server maincloud breach-room create_incident '"Nessie import test"' '"critical"' '"data_theft"'
spacetime sql --server maincloud breach-room "SELECT id, title FROM incidents"
```
**3. Import:**
```bash
node scripts/import-nessie.mjs --incident <id> --server maincloud
```
The importer fills **Who must we tell first** (customers per state: TX 162, CA 40, FL 25, NY 22, OK 11), marks the 260 customer records stolen (legal clocks start: bank regulator, SEC 8-K, Texas AG, Texas customers), and raises 6 fraud alerts: the three $10,000+ withdrawals freeze themselves, the three new-payee bills wait under **Fraud: needs a decision**.

**4. Look at it in the browser.** `client/.env` usually points at a local server; to see Maincloud without editing it, start the client with `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com npm run dev`. Your browser has a different key on each server, so on Maincloud it may show the access gateway first: copy the raw key and have an admin add it (or `spacetime call --server maincloud breach-room add_member '"0x<key>"' '"<name>"' '"<email>"' '"admin"'`).

Note: the Texas AG *clock* starts on 250+ stolen records in total, but the chart only draws a **TX AG** bubble at 250+ *Texans*. With 162 Texans, Texas AG shows as a deadline, not a bubble.

**Live moment:** keep the importer watching, then plant a new fraud withdrawal from a second terminal. A new frozen alert appears on every screen within about 10 seconds.
```bash
node scripts/import-nessie.mjs --incident <id> --server maincloud --watch   # terminal 1
node scripts/seed-nessie.mjs --plant                                         # terminal 2, run it again for another one
```
Reruns never duplicate alerts (progress is in `scripts/import-state.json`, per server and incident). After wiping a local database, add `--fresh`. Preview without network: `node scripts/seed-nessie.mjs --dry-run`. Tests: `node --test scripts/lib.test.mjs`.

## Architecture
There is no app server. The browser talks to SpacetimeDB directly over a websocket.
- **Reducers** are the only way to write. Each one checks the caller's role first, then calls shared helpers that apply the auto-rules (clocks, freeze, guided tasks, #exec updates) inside the same transaction.
- **Private tables + views.** Every table is private. Clients read only through views that return nothing to non-members, hide #legal from roles without privilege, and show the audit log to admins only.
- **Scheduled drill.** Each drill step is a row in a scheduled table; SpacetimeDB runs the next step on time and rejects anyone calling it by hand.
- **Live subscriptions.** Every screen is a subscription, so a change in one browser shows up in all of them instantly.

```
spacetimedb/              SpacetimeDB TypeScript module (tables, views, reducers, drill)
  src/index.ts            the whole backend and data contract
  src/advisor.ts          advisor prompt, citation and action checks, rule-based fallback
  src/nessie.ts           Nessie fraud rule and batching for the in-app import
  test/                   vitest: roles, automation, advisor
client/                   React 18 + Vite + Tailwind
  src/App.tsx             header, 3 tabs, background
  src/pages/incident/     Incident page
  src/pages/feed/         Live Feed page
  src/pages/team/         Team page + join screen
  src/components/         NotifyPriorityChart, AdvisorWidget, AfterActionSummary, shared hooks, toasts, ui/
  src/lib/notifyRules.ts  state notice rules
  src/module_bindings/    generated, do not edit
scripts/                  Nessie seed and fraud rules (Lane C)
docs/                     plan.md, agent-prompts.md, demo-script.md
```

## Lanes
| Lane | Owner | Owns | Reducers |
|---|---|---|---|
| A | Annie | Access control, roles, audit log, views, Maincloud | `addMember` `setRole` `removeMember` |
| B | Sameeraa | Incident page, Live Feed, notice chart, drill, demo | `createIncident` `setPhase` `addTimelineEvent` `addTask` `toggleTask` `signOffTask` `sendMessage` `setNotifyStatus` `startDrill` `startAutopilotDrill` `stopDrill` `stayInPhase` `askAdvisor` `logAdvisorAction` |
| C | Navya | Nessie seed and importer, scope, fraud watch | `importFromNessie` `upsertScopeItem` `raiseFraudAlert` `setFraudAlertStatus` `setStateImpact` |
| D | Navya | Legal rules, Gemini drafts, Devpost, pitch | `startLegalClock` `completeLegalClock` `draftNotice` |

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
- [x] Smart flow: tasks tick themselves, phases auto-advance with **Stay here**, Autopilot drill
- [x] Incoming detections strip, freeze-at-Contain, two-person sign-offs, What was hit quick pick
- [x] Incident ID in the header and record
- [x] Incident advisor (Gemini, cited, two-step confirm) and after-action summary
- [x] Backup demo video with voice-over (recorded on the local DB, `demo/`, not committed)
- [ ] Optional: re-record on Maincloud with Gemini answers in the advisor

### Lane C: Nessie + scope + fraud
- [x] Fix `scripts/seed-nessie.mjs` against the verified Nessie endpoints (unit tested; confirm on the first real `--reset` run)
- [x] `scripts/import-nessie.mjs`: customers by state into `set_state_impact`, compromised accounts into `upsert_scope_item`, suspicious withdrawals/bills into `raise_fraud_alert`
- [x] Document how to run the importer here (see **Demo: real bank data from Nessie**)
- [x] Done-when check on Maincloud (incident 5): 5 states on the chart, 6 fraud alerts (3 frozen), Texas AG clock, `--watch` + `--plant` added a live frozen alert
- [ ] Decide with Lane D: should the TX AG clock count Texans only (matches the chart) instead of all stolen records?
- [ ] Add GA, NC and TN customers to the Nessie seed so the Winstead office states show up on the chart

### Lane D: legal + AI + submission
- [ ] **Initial Devpost by 11 PM**: title, one-liner, select Winstead, Spacetime, Capital One plus MLH Gemini, GoDaddy
- [ ] Verify the legal rules (`LEGAL_RULES` in the module, `client/src/lib/notifyRules.ts`) with sources, especially the new GA, NC, TN entries
- [x] Auto-start legal clocks when data is first marked stolen
- [x] Gemini notice draft (**Draft with AI** in the notice queue), key kept server-side in the database environment
- [ ] Register the domain with GoDaddy code `MLHUTD84`
- [ ] Slides and a backup demo video by 11 AM Sunday
- [ ] After submitting: write the DEV post (leave out sponsor-confidential challenge text)

**Contract:** tables and reducers are defined in `spacetimedb/src/index.ts`. A new table needs a view and a test; tell Lane A so they republish Maincloud.

## Working with Claude Code
Ready-made prompts per lane, with the current architecture and what is finished, are in [docs/agent-prompts.md](docs/agent-prompts.md): paste the Shared context plus your lane's block into a new chat.

Project skills live in `.claude/skills/`: `spacetime-module`, `breach-room-ui`, `nessie-api`. `CLAUDE.md` tells each session to load the right one for its folder.
