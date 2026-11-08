# Agent prompts: Knight Agent

Paste **Shared context** plus **one lane's prompt** into a fresh Claude / agent chat opened in this repo. Each lane prompt is self-contained and lists only what's **still left**. Everything finished is in the shared context.

Deadlines: initial Devpost **11 PM Sat** · feature freeze **8 AM Sun** · final Devpost **12 PM Sun**.
Branches: `main` (shared, deployable), lane branches (`lane-b`, `annie` for Lane A, ...). Merge to `main` when your lane's work is tested.

---

## Shared context (paste this first, every time)

```text
=== PROJECT ===
"Knight Agent" (repo github.com/anccaz/TheKnightAgents, public) - HackUTD 2026.
An out-of-band, real-time cyber-incident command center for a bank's response team. It runs outside the bank's
network so the team can coordinate when attackers own email/Slack. Demo bank: "First Avon Bank".

Tracks (judges score against these):
- Winstead PC (law firm): Cyber Incident Response Dashboard. Required: secure & isolated, access control, incident
  documentation to standards with real-time status, scope of compromised data + its status (locked/ransomware,
  exfiltrated...), real-time comms. Judged on SECURITY (assume attacker owns all internal systems), EASE OF USE under
  stress (no tutorials), creativity.
- Spacetime: SpacetimeDB must power the core app (it does: every rule is a reducer, every screen a live subscription,
  the drill is a scheduled reducer). Public source required -> NEVER commit secrets.
- Capital One: Best Use of Nessie (mock banking API).
- MLH extras: Gemini API, GoDaddy domain (code MLHUTD84), DEV writing challenge.

=== ARCHITECTURE ===
No app server. Browser <-> SpacetimeDB directly (websocket subscriptions + reducer calls).

spacetimedb/src/index.ts  (SpacetimeDB v2.14 TypeScript module = the data contract)
- Tables (ALL PRIVATE): owner, user, incident, timelineEvent, scopeItem, task, channel, message, legalClock,
  fraudAlert, auditLog, stateImpact (stolen records per US state), notifyStatus (per-notice not_started/drafted/sent),
  drillStep, phaseAdvance, autopilotStep (scheduled tables), phaseHold.
- Views (the ONLY thing clients read; return [] to non-members): members, incidents, timelineEvents, scopeItems, tasks,
  channels, messages (#legal hidden unless admin/incident_lead/legal), legalClocks, fraudAlerts, stateImpacts,
  notifyStatuses, phaseAdvances, auditEntries (admin only).
- Reducers: init (stores owner), onConnect/onDisconnect (online flag), addMember (admin or DB owner), setRole (blocks
  removing last admin), createIncident, setPhase, addTimelineEvent, addTask, toggleTask, sendMessage, upsertScopeItem,
  raiseFraudAlert, setFraudAlertStatus, startLegalClock, completeLegalClock, setStateImpact, setNotifyStatus,
  startDrill, stopDrill, runDrillStep, stayInPhase, runPhaseAdvance, startAutopilotDrill, runAutopilotStep
  (run* = scheduled, internal-only guard).
- Shared helpers (logic lives here; reducers check roles then call them): requireRole, requireIncident, audit,
  timeline, oneOf, newIncident, addGuidedTasks, startClock, autoLegalClocks, setScope, raiseAlert, setStateRecords.
- Auto-rules: incident/phase change -> GUIDED tasks; scope status 'exfiltrated' -> LEGAL_RULES clocks (bank regulator 36h,
  SEC 8-K, Texas AG at 250+, Texas customers); fraud alert >= $10,000 (AUTO_FREEZE_CENTS) -> auto-frozen + audit;
  DRILL = scripted ~90 s attack (encryption alert, ransom note, data theft -> state impacts TX/CA/FL/NY/OK + clocks,
  3 fraudulent transfers, online-banking access).
- Roles: admin, incident_lead, responder, legal, exec_viewer. WRITERS = incident_lead, responder (+admin).
- Tests: spacetimedb/test/roles.test.ts, automation.test.ts (vitest + spacetimedb/server/test-utils), 10 passing.

client/  (Vite + React 18 + TS, Tailwind v4 + shadcn "base-nova" on @base-ui/react - NOT Radix: read
src/components/ui/* props first; import with "@/"; icons lucide-react)
- src/App.tsx: shell, header (incident/phase/severity/online/connection), 3 tabs, full-screen React Bits
  GradientASCII background (src/components/GradientASCII.jsx + .d.ts; do NOT re-add loseContext() in its cleanup -
  React StrictMode remount -> white screen).
- src/pages/incident/IncidentPage.tsx: declare form, drill buttons, 6-phase stepper, NIST-style incident record
  (derived), "What do I do next?" tasks, What was hit (counters + table + add form), Fraud: needs a decision.
- src/pages/feed/FeedPage.tsx: NotifyPriorityChart at top, Deadlines strip (countdowns, mark filed, add deadline),
  merged feed (chat per channel + timeline + security events) with All/Chat/Auto/Security filters, composer
  (message or "log as incident note").
- src/pages/team/TeamPage.tsx: JoinScreen (copy your ID), Add member by ID, members + role dropdown, security events
  with action filter.
- src/components/NotifyPriorityChart.tsx: bubble chart "Who must we tell first" - each bubble = one notice owed
  (state customers, state AG, federal regulator/SEC); x = time left (log days), y = people affected (log), size =
  people, color customers #1f9ad8 / authorities #ff2d6f (palette validated for CVD/contrast); 1-week + Average
  reference lines; dodged overlaps; hover tooltip; notice queue with status chips and Mark drafted / Mark sent /
  Reopen (sent federal notice also completes its legal clock). Sent bubbles hollow, drafted dashed.
- src/lib/notifyRules.ts: state rules (TX, CA, FL, NY + default) -> obligationsFor(state, records, since).
- src/components/shared.tsx: useMe, useCurrentIncident (newest incident), can(), LEADS/WRITERS/PRIVILEGED, labels,
  SeverityChip. src/components/Toast.tsx: useRun() - wrap every reducer call: run(promise, okText?).
- Generated bindings: src/module_bindings (never hand-edit; `npm run generate` in spacetimedb/).

scripts/: Nessie seed (seed-nessie.mjs - NEEDS FIXES, see Lane C), fraud rule lib.mjs + tests.
docs/: plan.md (original plan), agent-prompts.md (this). .claude/skills/: spacetime-module, breach-room-ui, nessie-api.

UI rules: stressed user, plain words, one obvious action, status readable without color (text/icon). 3 colors only:
cyan (primary), magenta (danger), white/gray (neutral). Solid panels, no glows, no emojis. Titles Oxanium
(font-heading, white), body Space Grotesk, labels/numbers font-mono.

=== WHAT'S FINISHED ===
- Secure access: join by identity (no invite codes), owner makes first admin via CLI, private tables + role views,
  server-side role checks, last-admin guard, append-only audit log, Maincloud republished with the security fix.
- Incident flow end to end, live across browsers; guided tasks; drill; auto legal clocks; auto-freeze.
- Notice priority chart + per-notice drafted/sent status (audited).
- Smart flow: AUTO_TASKS tick verifiable guided tasks; progress() schedules a phaseAdvance (30 s, 6 s for AUTOPILOT
  incidents) when a phase's tasks are all done; stayInPhase holds (phaseHold table); runPhaseAdvance moves via
  movePhase. Client: AutoAdvanceBanner with countdown + "Stay here".
- Autopilot drill: startAutopilotDrill = attack DRILL + autopilotStep ticks (every 5 s, does the next open task of the
  current phase, freezes open alerts, sends state customer notices, files clocks) through all 6 phases.
- Cyberpunk UI (3 pages), fonts, background, calmer 3-color theme.
- Lane A's annie branch merged into lane-b and main. lane-b may be ahead of main (notice status) - check git log.

=== COMMANDS ===
- Module: cd spacetimedb && npm install && npx tsc --noEmit && npm test
- Local server: spacetime start --listen-addr 127.0.0.1:3010 ; npm run publish:local ; npm run generate
- Cloud: spacetime login ; npm run publish:cloud   (db "breach-room" on Maincloud; add --delete-data if a schema
  change is refused - demo data only)
- First admin: open app, copy "Your ID", publisher runs:
  spacetime call [--server http://127.0.0.1:3010] breach-room add_member '{"__identity__":"0x<ID>"}' '"Name"' '"email"' '"admin"'
  (CLI reducer names are snake_case; client calls camelCase.)
- Client: cd client && npm install && npm run dev. Default URI = Maincloud; client/.env can override
  VITE_SPACETIME_URI (e.g. ws://127.0.0.1:3010) and VITE_SPACETIME_DB.

=== RULES FOR YOU ===
- Load the matching skill in .claude/skills before editing.
- Stay in your lane's files. New table => add its view + a test, and tell Lane A (they republish Maincloud).
- Every write = reducer starting with requireRole; security-relevant actions call audit(); incident-visible ones timeline().
- Only export reducers/views/lifecycle hooks from the module (anything else breaks publish).
- After module changes: npx tsc --noEmit && npm test, publish, npm run generate, then cd client && npx tsc --noEmit.
- Keys (Nessie, Gemini) only in .env (gitignored) or server-side paths; never in client/ or git.
- Commit messages: no Claude/Anthropic attribution or Co-Authored-By lines.
- Verify in the browser before saying something works.
```

---

## Lane A: access, security, Maincloud (owner: Annie)

**Finished:** Maincloud publish, member bootstrap, role switching, audit filter (merged).

```text
You own Lane A: security hardening and the shared Maincloud database.
Files: spacetimedb/src/index.ts (tables/access/views), spacetimedb/test/roles.test.ts,
client/src/pages/team/TeamPage.tsx, README setup section, docs/plan.md security notes.

Still to do, in order:
1. Republish Maincloud from the latest main (it now has the notifyStatus table and setNotifyStatus reducer):
   cd spacetimedb && npm run publish:cloud (add --delete-data if refused), re-add members by ID, confirm the
   Live Feed "Mark sent" works on Maincloud. Redo this after every backend merge.
2. Tamper-evident audit chain: add prevHash + hash to auditLog (or a parallel auditChain table); in audit() compute
   hash = H(prevHash + at + actor + action + detail) with a small deterministic TS hash (no Node crypto in modules).
   Client: "Verify record" button on Team > Security events recomputing the chain -> "Record intact" or
   "Broken at event N". Test: tampering a row breaks verification.
3. "0 online" glitch: members added while already connected show offline until reload. Track live connections
   (table keyed by identity, updated in onConnect/onDisconnect) and set online in addMember if connected.
4. Security pitch bullets in docs/plan.md: out-of-band hosting; private tables + role-filtered views + server-side
   checks; join by identity, no shared secrets; append-only, verifiable audit trail.
Skip: reducing to 3 roles.
```

---

## Lane B: incident, live feed, notice chart, demo (owner: Sameeraa)

**Finished:** Incident page, Live Feed, Team page UI; drill + auto-rules; notice priority chart; per-notice drafted/sent; theme; automatic status updates in #exec (execUpdate: phase, records stolen, states affected, notices sent, next deadline, money frozen - on phase change, data stolen in the drill, notice sent); README refresh; docs/demo-script.md.

```text
You own Lane B: Incident page, Live Feed, the notice priority chart, and the demo.
Files: client/src/pages/incident/*, client/src/pages/feed/*, client/src/components/NotifyPriorityChart.tsx,
README demo section, docs/demo-script.md.

Still to do:
1. Record a backup screen video of the drill on Maincloud following docs/demo-script.md (two browsers side by side:
   admin + exec viewer, to show live sync and #legal hidden from the viewer).
2. Rehearse the three sponsor scripts in docs/demo-script.md; adjust timings to the real drill.
3. Merge lane-b -> main after each tested change; ask Lane A to republish Maincloud whenever the backend changed.
```

---

## Lane C: Nessie / Capital One

**Finished:** seed script draft + fraud rule with tests (endpoints were guessed and are partly wrong).

```text
You own Lane C: Capital One Nessie integration.
Files: scripts/ (seed-nessie.mjs, lib.mjs, tests, new import-nessie.mjs), .claude/skills/nessie-api/SKILL.md.

Nessie facts (verified from https://nessieisreal.com/docs):
- Base URL https://prod-api.nessieisreal.com , auth ?key=YOUR_KEY (log in with GitHub on nessieisreal.com).
- Create+list: customers (GET/POST /customers, GET/POST /customers/{id}/accounts), GET /accounts,
  deposits & withdrawals (GET/POST /accounts/{id}/deposits|withdrawals), bills (GET /customers/{id}/bills,
  GET/POST /accounts/{id}/bills, PUT/DELETE /bills/{id}), merchants, loans. Read-all: GET /enterprise/customers.
- Transfers: create only (POST /accounts/{id}/transfers), read by GET /transfers/{id}; no list endpoint.
- Purchases: only GET/PUT/DELETE /purchase/{id} documented - don't rely on them.
- No reset endpoint, no customer delete; delete accounts/bills one by one. Dates have no time of day.
- Bills can be cancelled (PUT status) - a real "freeze" action.

Still to do, in order:
1. Fix scripts/seed-nessie.mjs: base URL; --reset deletes accounts/bills individually; replace purchases with
   withdrawals + bills; plant suspicious large withdrawals and new-payee bills ("2-4 AM" in description).
   Keep node --test scripts/*.test.mjs green. Update the nessie-api skill with the facts above.
2. scripts/import-nessie.mjs (Node 22, no deps; key from root .env): connect to SpacetimeDB as a member
   (spacetimedb npm client SDK with a token for an identity an admin added, or shell out to `spacetime call`), and
   for a given incident id:
   - group compromised customers by address.state -> set_state_impact(incidentId, state, count)
     (this fills the notice priority chart);
   - upsert_scope_item for compromised accounts (assetType 'account', assetRef Nessie _id, status 'exfiltrated');
   - scan withdrawals/bills of compromised accounts with lib.mjs rules -> raise_fraud_alert (amountCents =
     dollars*100; >= $10,000 auto-freezes server-side);
   - optional --watch: poll every 10 s for new withdrawals/bills (live demo moment).
   Document how to run it in README.
Done when: with a live key, the importer fills the chart and Fraud alerts on Maincloud.
```

---

## Lane D: legal, Gemini, submission

**Finished:** nothing confirmed yet. Check with the team whether the initial Devpost was submitted.

```text
You own Lane D: legal accuracy, the Gemini notice draft, and the submission.
Files: client/src/lib/notifyRules.ts, LEGAL_RULES / GUIDED text in spacetimedb/src/index.ts (numbers & labels only),
new Gemini integration, Devpost, slides, domain/deploy.

Still to do, in order:
1. Initial Devpost (if not done): title "Knight Agent", one-liner, tracks Winstead, Spacetime, Capital One,
   MLH Gemini, MLH GoDaddy; repo github.com/anccaz/TheKnightAgents.
2. Verify legal rules with sources (comments in code), keep "verify before relying" in UI:
   - notifyRules.ts: TX (customers 60 days; AG 250+ within 30 days), CA, FL, NY customer + AG rules; add
     credit-bureau (consumer reporting agency) thresholds per state (many states: 1,000+) - add 'Credit bureaus'
     as a third obligation in obligationsFor so it shows in the notice chart (group 'authorities').
   - LEGAL_RULES: bank regulator 36h (OCC/Fed/FDIC computer-security incident notification rule), SEC 8-K
     4 business days (material incidents, public companies), Texas clocks.
3. Gemini "Draft notice": in NotifyPriorityChart's notice queue, a "Draft with AI" button for the selected notice that
   writes the letter (state, people affected, what was stolen, incident date, required content). The API key must
   NOT reach the client: use a SpacetimeDB procedure with HTTP (check spacetimedb/server procedures + http in v2.14;
   key from module environment) or a tiny local Node endpoint. Post the draft into #legal (privileged) and call
   setNotifyStatus(..., 'drafted'). A human still clicks Mark sent.
4. Deploy client (static build, VITE_SPACETIME_URI = Maincloud) and register the GoDaddy domain (MLHUTD84).
5. Slides (5-6): problem, live drill, notice priority chart, security model, Spacetime architecture, Nessie flow.
   DEV writing-challenge post after final submission (no sponsor-confidential challenge text).
```
