# Breach Room demo scripts

Three 3-minute scripts, one per sponsor. Same app, same drill; the story changes with the judge.

**Browser A** = admin (left screen). **Browser B** = exec viewer (right screen). **Browser C** = a private window, only for the join moment.

Drill timing to know (from `DRILL` in `spacetimedb/src/index.ts`, seconds after **Run 2 AM drill**):
- ~4 s: EDR encryption alert
- ~12 s: core banking database encrypted
- ~20 s: ransom note in #general
- ~30 s: 3.1 GB outbound transfer logged
- ~38 s: 12,500 records stolen (TX, CA, FL, NY, OK), legal clocks start, #exec status update
- ~48 to 62 s: three fraud alerts ($2,400 open, $18,750 and $24,000 auto-frozen)
- ~70 s: online banking server accessed
- ~76 s: "Drill script finished. The attacker is still inside: your move."

---

## Hands-free option
If you are presenting alone or want a looping screen, click **Autopilot** instead of Run 2 AM drill: the attack and the whole response play out on their own (about 3 minutes, all six phases). Narrate over it: "Every task you see ticking off is either verified by the system or done the way a responder would; phases advance themselves after a countdown the lead can stop."

For the real-incident story, show the 30-second banner after the Detect tasks are done and click **Stay here** once: "Automation moves the team forward, but the lead always has the final say."

## Setup before judging
- [ ] Maincloud republished from the latest `main` (`cd spacetimedb && npm run publish:cloud`), members re-added if data was wiped.
- [ ] Browser A logged in as **admin**, on the **Incident** tab.
- [ ] Browser B logged in as **exec viewer**, on the **Live Feed** tab with **#exec** selected.
- [ ] Browser C: a private window on the app, showing **Join the response team** (not a member).
- [ ] Fresh state: the drill has not been run yet for this judge. The app shows the newest incident, so the drill incident becomes current on its own. If an old drill is still running, click **Stop drill** first.
- [ ] Both browsers show **LINKED** in the header and the right online count.
- [ ] Backup video open in a tab, local server ready (see "If something breaks").
- [ ] Capital One only: Lane C importer tested against this database, or decide now to use the drill fallback.

---

## Winstead PC: secure, simple, legally defensible

| Time | Do | Say |
|---|---|---|
| 0:00 | Both browsers visible. | "It's 2 AM. Ransomware just hit First Avon Bank, and the attacker owns email and Slack. Breach Room runs outside the bank's network, so the response team still has a place to work." |
| 0:20 | Browser C: show **Join the response team**, click **Copy my ID**. | "There are no passwords and no invite codes to steal. Each device has a cryptographic identity. You read this ID to your admin by phone or in person." |
| 0:35 | Browser A: **Team** tab, paste into **Add member**, role **Legal**, click **Add member**. Browser C opens by itself. | "The admin adds that ID with a role. Five roles: admin, incident lead, responder, legal, exec viewer. The checks run on the server, not just hidden buttons." |
| 0:50 | Point at Browser B. | "Our exec viewer can't see the lawyers' privileged channel and can't see the Team page or the audit log. The data never reaches their browser." |
| 1:00 | Browser A: **Incident** tab, click **Run 2 AM drill**, confirm. | "Let's run the attack. This is a scripted 90-second breach, playing out live on every screen." |
| 1:15 | Let the alerts land; point at **What do I do next?** | "Nobody needs a tutorial. The checklist tells a stressed responder exactly what to do in this phase." |
| 1:40 | When records are stolen: Browser A **Live Feed** tab, point at **Deadlines**. | "The moment customer data is marked stolen, the legal clocks start themselves: bank regulator in 36 hours, SEC 8-K, Texas AG because more than 250 Texans were hit, and customer notices." |
| 2:00 | Point at **Who must we tell first**. | "This chart answers the question counsel asks first. Each bubble is a notice we owe. Left means less time, higher means more people. Top-left gets done first." |
| 2:15 | In the notice queue, find **Texas Attorney General**: click **Mark drafted**, then **Mark sent**. | "Legal drafts the Texas AG notice and marks it sent. That's one click each, and the bubble goes hollow." |
| 2:30 | Browser A: **Team** tab, **Security events**, filter to the notice. | "The audit log is append-only. It proves who sent which notice and when, which is what you want when the regulator asks." |
| 2:45 | Browser B: #exec. | "And executives get status updates in #exec on their own: phase, records stolen, states affected, notices sent, next deadline, money frozen. Nobody has to stop working to brief them." |
| 2:55 | | "Secure by design, simple under stress, and documented to the standard." |

---

## Spacetime: there is no server

| Time | Do | Say |
|---|---|---|
| 0:00 | Both browsers visible. | "Breach Room has no app server. The browser talks straight to SpacetimeDB. That's the whole backend." |
| 0:20 | Open `spacetimedb/src/index.ts` briefly, or just point at the app. | "Every rule is a reducer: declare an incident, change phase, freeze an account, mark a notice sent. Each one checks the caller's role, then runs in one transaction." |
| 0:40 | Browser A: click **Run 2 AM drill**, confirm. | "The drill is a scheduled reducer. Each step is a row in a scheduled table, and SpacetimeDB runs the next one on time. Nobody can call a step by hand; the reducer rejects it." |
| 1:00 | Point back and forth as events land in both browsers. | "Every screen is a live subscription. Watch both browsers: the same event shows up in both at the same moment, no polling, no refresh." |
| 1:25 | When records are stolen, point at **Deadlines** and the chart. | "One reducer marks data stolen. In that same transaction, helpers start four legal clocks, update the timeline, and post a status update to #exec. The rules live in the database." |
| 1:50 | Fraud alerts land; point at **Fraud: needs a decision** and the auto-frozen line. | "Fraud alerts over 10,000 dollars freeze themselves inside the reducer that raised them, and write to the audit log. The client can't skip that rule." |
| 2:10 | Browser A: **Live Feed**, show #legal. Browser B: show it is missing for the exec viewer. | "Views decide who sees what. Every table is private. Clients only read views, and a view runs per caller: non-members get nothing, the exec viewer never receives #legal, only admins receive the audit log." |
| 2:35 | Browser A: click **Done with Detect: move to Analyze**. Both update; #exec gets a status update. | "One click, one reducer, every screen updated, and the execs are briefed." |
| 2:50 | | "Tables, permissions, automation, scheduling and real-time sync: all SpacetimeDB." |

---

## Capital One: Nessie drives the response

Depends on the Lane C importer (`scripts/import-nessie.mjs`). If it isn't ready, use the fallback lines in the last column.

| Time | Do | Say | Fallback (drill only) |
|---|---|---|---|
| 0:00 | Both browsers visible. | "A breach at a bank isn't abstract. It's real customers, real accounts and real money moving at 2 AM. We model First Avon Bank on Capital One's Nessie API." | Same. |
| 0:20 | Browser A: click **Run 2 AM drill** (or declare an incident) to get an incident id. | "Here's the incident. Now we pull the bank's data from Nessie." | "Here's the incident. The drill plays the data an importer reads from Nessie." |
| 0:35 | Terminal: run the importer for this incident. | "Our importer reads the compromised customers from Nessie and groups them by their home state." | Skip the terminal. |
| 0:55 | **Live Feed**: **Who must we tell first** fills. | "Those states fill the notice chart. Each state's law sets its own deadline and threshold, so where Nessie customers live decides who we must tell first." | "Stolen records per state fill the chart: Texas, California, Florida, New York, Oklahoma. In production these counts come from Nessie customer addresses." |
| 1:25 | **Incident** tab: **What was hit** and **Fraud: needs a decision**. | "It scans withdrawals and bills on compromised accounts. A new payee, a big amount, an odd hour: each one raises a fraud alert." | "Three fraudulent transfers hit compromised accounts, each flagged for new payee and odd hour." |
| 1:50 | Point at the auto-frozen line. | "Anything 10,000 dollars or more freezes itself, no human needed, and it's audited." | "18,750 and 24,000 dollars froze themselves. That's $42,750 saved before anyone woke up." |
| 2:10 | Browser A: on the $2,400 alert, click **Freeze**, confirm. | "Smaller ones wait for a person. One click to freeze, one to clear." | Same. |
| 2:25 | (Importer `--watch`, if ready) create a large Nessie withdrawal; it appears live. | "New fraud in Nessie shows up here in seconds." | Skip. |
| 2:35 | Browser B: #exec. | "The executive channel gets the running total: records stolen, states affected, notices sent, money frozen." | Same. |
| 2:50 | | "Nessie data drives who we notify and which accounts we freeze. That's the core of the response." | Same. |

---

## If something breaks
- **App won't connect or Maincloud is down:** switch to the local server. `spacetime start --listen-addr 127.0.0.1:3010`, `cd spacetimedb && npm run publish:local`, set `client/.env` to `VITE_SPACETIME_URI=ws://127.0.0.1:3010`, restart `npm run dev`, add yourself as admin with `spacetime call --server http://127.0.0.1:3010 breach-room add_member ...` (see README). Say: "Same app, now on a laptop that's fully off the network. That's the out-of-band story."
- **Drill stuck or a step fails:** click **Stop drill**, then **Run 2 AM drill** again; it opens a fresh incident.
- **Not enough time for a live run:** play the backup video (two browsers side by side, drill on Maincloud) and narrate the same beats.
- **Importer fails during Capital One:** use the fallback column; don't debug in front of the judges.
- **A member shows offline:** reload that browser.
