# Agent prompts: Breach Room

Copy **Shared context** plus **one lane's prompt** into a fresh Claude / agent chat opened in this repo. Each lane prompt is self-contained.

Deadlines: initial Devpost **11 PM Sat** · feature freeze **8 AM Sun** · final Devpost **12 PM Sun**.

---

## Shared context (paste this first, every time)

```text
You are working on "Breach Room" (repo: TheKnightAgents), a HackUTD 2026 project: an out-of-band,
real-time cyber-incident command center for a bank's response team. It runs outside the bank's network
so the team can coordinate when attackers own email/Slack.

Tracks we compete in (judges score against these):
- Winstead PC (law firm): Cyber Incident Response Dashboard. Required: secure & isolated, access control,
  incident documentation to standards with real-time status, scope of compromised data and its status
  (locked/ransomware, exfiltrated...), real-time comms. Judged on SECURITY (assume attacker owns all internal
  systems) and EASE OF USE under stress (no tutorials), plus creativity.
- Spacetime: SpacetimeDB must power the core app (it does: all logic is reducers, all screens are live subscriptions).
  Public GitHub repo required, so NEVER commit secrets.
- Capital One: Best Use of Nessie (mock banking API) - customers/accounts/withdrawals/bills drive our data.
- MLH extras: Gemini API, GoDaddy domain (code MLHUTD84), DEV writing challenge.

Stack and layout:
- spacetimedb/src/index.ts  = SpacetimeDB v2 TypeScript module (the data contract). Tables are PRIVATE;
  clients read ONLY through views at the bottom (members, incidents, timelineEvents, scopeItems, tasks,
  channels, messages, legalClocks, fraudAlerts, stateImpacts, auditEntries). Views return [] to non-members.
  Shared helpers hold logic: newIncident, setScope, raiseAlert, startClock, setStateRecords, addGuidedTasks,
  audit, timeline, requireRole, requireIncident. Auto-rules: data marked 'exfiltrated' starts LEGAL_RULES clocks;
  fraud alerts >= $10,000 (AUTO_FREEZE_CENTS) auto-freeze; phase change creates GUIDED tasks; startDrill runs
  a scheduled scripted attack (DRILL) via the drillStep scheduled table.
- spacetimedb/test/*.test.ts = vitest tests using spacetimedb/server/test-utils (run: cd spacetimedb && npm test).
- client/ = Vite + React 18 + TypeScript, Tailwind v4 + shadcn "base-nova" (built on @base-ui/react, NOT Radix:
  read src/components/ui/* props before using). Import with "@/". Icons: lucide-react.
  3 pages only: src/pages/incident (record, phases, tasks, what was hit, fraud), src/pages/feed (notification map,
  deadlines, merged chat/timeline/security feed), src/pages/team (join by ID, add member, roles, security events).
  Shell: src/App.tsx. Map: src/components/NotificationMap.tsx (us-atlas shapes, neon SVG). State rules:
  src/lib/notifyRules.ts. Background: React Bits GradientASCII (src/components/GradientASCII.jsx) - do not
  re-add loseContext() in its cleanup (breaks under React StrictMode: white screen).
- scripts/ = Nessie seed + fraud rule (node --test scripts/*.test.mjs).
- Generated client bindings: client/src/module_bindings (never hand-edit; regenerate).

UI rules (from .claude/skills/breach-room-ui): stressed user, plain words, one obvious action, status readable
without color (text/icon), 3 colors only: cyan (primary), magenta (danger), white/gray (neutral). Solid panels,
no glows except the map, no emojis. Titles: Oxanium (font-heading), body: Space Grotesk.

Roles today: admin, incident_lead, responder, legal, exec_viewer. Server enforces with requireRole; the client
hides controls via can(me, LEADS|WRITERS|PRIVILEGED) from src/components/shared.tsx.

Commands:
- Module: cd spacetimedb && npm install && npx tsc --noEmit && npm test
- Local server: spacetime start --listen-addr 127.0.0.1:3010 ; npm run publish:local ; npm run generate
- Cloud: spacetime login ; npm run publish:cloud (db name "breach-room" on Maincloud)
- First admin: open the app, copy "Your ID", then the publisher runs:
  spacetime call [--server http://127.0.0.1:3010] breach-room add_member '{"__identity__":"0x<ID>"}' '"Name"' '"email"' '"admin"'
  (CLI reducer names are snake_case.)
- Client: cd client && npm install && npm run dev (client/.env: VITE_SPACETIME_URI, VITE_SPACETIME_DB; default is Maincloud)

Rules for you:
- Load the matching skill in .claude/skills before editing (spacetime-module, breach-room-ui, nessie-api).
- Stay in your lane's files. Only Lane A edits table definitions unless the lane prompt says otherwise; if you add
  a table, add its view and a test.
- Every write goes through a reducer that starts with requireRole; security actions call audit().
- After module changes: npx tsc --noEmit, npm test, publish, npm run generate, then cd client && npx tsc --noEmit.
- Exporting anything other than reducers/views/lifecycle hooks from the module breaks publish.
- Keys (Nessie, Gemini) live only in .env (gitignored) or server-side code paths, never in client/ or git.
- Commit messages: no Claude/Anthropic attribution or Co-Authored-By lines. Work on your lane branch; don't push
  to main without the team agreeing.
- Verify in the browser before saying something works.
```

---

## Lane A: access, security, Maincloud

```text
You own Lane A: access control, security hardening, and the shared Maincloud database.
Files: spacetimedb/src/index.ts (tables, access reducers, views), spacetimedb/test/roles.test.ts,
client/src/pages/team/TeamPage.tsx, README setup section.

Tasks, in order:
1. BLOCKER - Republish Maincloud from main: cd spacetimedb && spacetime login && npm run publish:cloud.
   The live database runs an OLD module that still has bootstrap_admin (first visitor becomes admin).
   If publish refuses because the schema changed, re-run with --delete-data (demo data only). Then make the
   first admin with spacetime call ... add_member (see shared context) and add each teammate by their ID.
   Done when: the app with default .env (Maincloud) shows the join screen for strangers and works for members.
2. Tamper-evident audit chain: add a `hash` (string) and `prevHash` column to auditLog (or a new auditChain
   table), compute hash = sha256(prevHash + at + actor + action + detail) inside audit(). Add a reducer-free
   check: a view or client function that recomputes the chain and reports the first broken link. UI: a
   "Verify record" button on Team > Security events showing "Record intact" or "Broken at event N".
   Add a test that editing a row breaks verification. (SpacetimeDB modules have no Node crypto: implement a
   small hash in TS or check what spacetimedb/server exposes; keep it deterministic.)
3. Fix "0 online": members added while already connected stay offline until reload. Option: mark online in
   addMember when the target currently has a live connection (track connections in a table updated by
   clientConnected/clientDisconnected keyed by identity).
4. Security pitch notes (3 bullets in docs/plan.md): out-of-band hosting, private tables + role views +
   server-side checks, append-only verified audit trail, join by identity with no shared secrets.
Out of scope: changing to 3 roles (team decided to skip), UI redesign.
```

---

## Lane B: incident, live feed, notification map, demo

```text
You own Lane B: the Incident page, the Live Feed page, the notification map UI, and the demo.
Files: client/src/pages/incident/IncidentPage.tsx, client/src/pages/feed/FeedPage.tsx,
client/src/components/NotificationMap.tsx, README demo section, docs/demo-script.md (new).
You may add the backend pieces for task 1 (coordinate with Lane A: tell them which table you added).

Tasks, in order:
1. Notification map status + gaps (Winstead "documentation" and creativity):
   - Backend: table notifyStatus {id, incidentId index, state, who ('Customers'|'Attorney General'|'Credit bureaus'),
     status ('not_started'|'drafted'|'sent'), updatedAt, updatedBy} + reducer setNotifyStatus (writers + legal),
     view notifyStatuses, audit() on 'sent', timeline 'action' entry; test it.
   - Rules: add credit-bureau obligation when a state has >= 1000 residents affected (Lane D confirms the threshold
     per state in client/src/lib/notifyRules.ts).
   - UI in NotificationMap obligations list: each obligation shows status chip + buttons "Mark drafted" / "Mark sent"
     (confirm once), sent ones show who/when. Header shows "N of M notices sent".
   - Show "What was stolen" per incident (e.g. "Names + account numbers") from the scope items labels/types.
2. Auto status update to #exec: in the module's setPhase (and when a drill step marks data stolen), post a message
   in the incident's 'exec' channel like "Phase: Contain · 12,500 records stolen · 4 deadlines, next in 1d 11h ·
   $42,750 frozen". Sender is ctx.sender. Add a test.
3. README: replace outdated page names with the 3-page flow (Incident / Live Feed / Team), how to run the drill,
   Maincloud vs local setup.
4. docs/demo-script.md: a 3-minute script per sponsor (Winstead: security + ease of use + legal map;
   Spacetime: "no server, every rule is a reducer, every screen is a live subscription, the drill is a scheduled
   reducer"; Capital One: Nessie customers light the map, Nessie withdrawals/bills trigger fraud + auto-freeze).
   Then record a backup screen video of the drill on Maincloud.
Keep the UI rules (3 colors, no glows except map, no emojis, Oxanium titles).
```

---

## Lane C: Nessie (Capital One)

```text
You own Lane C: Capital One Nessie integration.
Files: scripts/ (seed-nessie.mjs, lib.mjs, tests, new importer), .claude/skills/nessie-api/SKILL.md.
Nessie facts (verified from https://nessieisreal.com/docs):
- Base URL https://prod-api.nessieisreal.com , auth ?key=YOUR_KEY (get the key by logging in with GitHub).
- Create+list: customers (GET/POST /customers, /customers/{id}/accounts), accounts (GET /accounts),
  deposits & withdrawals (GET/POST /accounts/{id}/deposits|withdrawals), bills (GET /customers/{id}/bills,
  GET/POST /accounts/{id}/bills, PUT/DELETE /bills/{id}), merchants, loans.
  Enterprise read-all: GET /enterprise/customers.
- Transfers: create only via POST /accounts/{id}/transfers; read by GET /transfers/{id} (no list endpoint).
- Purchases: only GET/PUT/DELETE /purchase/{id} documented (no create/list) - do not rely on them.
- No reset endpoint and no customer delete; delete accounts/bills one by one. Dates have no time of day.
- Bills can be cancelled (PUT status) - use this as a real "freeze" action.

Tasks, in order:
1. Fix scripts/seed-nessie.mjs: base URL, --reset deletes accounts/bills individually, replace purchases with
   withdrawals + bills (planted suspicious: large withdrawals and new-payee bills on a few accounts, 2-4 AM in the
   description). Keep tests passing (node --test scripts/*.test.mjs). Update the nessie-api skill with the facts above.
2. Importer scripts/import-nessie.mjs (Node 22, no deps): reads NESSIE_API_KEY from root .env; connects to
   SpacetimeDB as a member (use the spacetimedb npm client SDK with a token for an identity an admin added, or
   call reducers via `spacetime call`); for a given incident id:
   - picks the compromised customers (e.g. those whose accounts were seeded as compromised, or a --percent),
     groups them by address.state and calls set_state_impact(incidentId, state, count) -> lights up the map;
   - calls upsert_scope_item for each compromised account (assetType 'account', assetRef Nessie _id,
     status 'exfiltrated', recordsCount 1) or one aggregated row;
   - scans withdrawals/bills of compromised accounts with lib.mjs rules and calls raise_fraud_alert
     (amountCents = dollars*100) -> >= $10,000 auto-freezes server-side;
   - optional --watch mode polling every 10 s for new withdrawals/bills (great live demo).
   Add a short section to README: how to run it during the demo.
Done when: running the importer against a live Nessie key lights states on the map and fills Fraud alerts.
```

---

## Lane D: legal, Gemini, submission

```text
You own Lane D: legal accuracy, the Gemini notice draft, and the submission.
Files: client/src/lib/notifyRules.ts, LEGAL_RULES/GUIDED text in spacetimedb/src/index.ts (text/numbers only),
Gemini integration (new), Devpost, slides, domain.

Tasks, in order:
1. BLOCKER (11 PM): initial Devpost submission - title "Breach Room", one-liner, tracks: Winstead, Spacetime,
   Capital One, MLH Gemini, MLH GoDaddy. Repo link github.com/anccaz/TheKnightAgents (public).
2. Verify legal rules against current statutes and fix numbers/labels:
   - client/src/lib/notifyRules.ts: TX (customers 60 days; AG at 250+ within 30 days), CA, FL, NY customer and
     AG rules; add credit-bureau (consumer reporting agency) thresholds per state; DEFAULT for other states.
   - spacetimedb/src/index.ts LEGAL_RULES: bank regulator 36h (OCC/Fed/FDIC computer-security incident rule),
     SEC 8-K 4 business days (material incidents, public companies), Texas AG/customer clocks.
   Cite sources in comments. Keep "verify before relying" wording in the UI.
3. Gemini "Draft notice": per state on the notification map, a button that drafts the customer notice letter
   using that state's affected count, what was stolen, incident date, and required content. The API key must
   NOT be in the client: either a SpacetimeDB procedure making an HTTP call (check spacetimedb/server procedures
   + http support in v2.14) with the key from module environment, or a tiny local Node endpoint the client calls.
   Draft lands as a message in #legal (privileged) and sets that state's notifyStatus to 'drafted' (Lane B builds
   notifyStatus). Human approves before "sent".
4. Register the GoDaddy domain (code MLHUTD84) and point it at the deployed client (e.g. Vercel/Netlify static
   build of client/ with VITE_SPACETIME_URI=Maincloud).
5. Slides (5-6): problem, live drill, notification map, security model, Spacetime architecture, Nessie data flow.
   Then the DEV writing-challenge post after final submission (no sponsor-confidential challenge text).
```
