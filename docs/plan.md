# Breach Room: Bank Breach Command Center

HackUTD 2026 · Zero Day

**One line:** an out-of-band, real-time command center a bank's response team uses during and after a cyber incident, with legal notification clocks and live scope of compromised customer data.

---

## Tracks

| Track | Prize | What wins it |
|---|---|---|
| **Winstead PC** (sponsor) | $1,500 / $900 / $300 per team | All 5 required components + security + ease of use under stress + creativity |
| **Spacetime** main (sponsor) | $2,048 / $1,024 / $512 | Spacetime powers the *core* app (incidents, scope, tasks, comms), **public GitHub repo** |
| **Capital One** "Best Use of Nessie" (sponsor) | $300 per member | Compromised customers/accounts and suspicious transfers come from Nessie |
| MLH: Gemini API | swag | Notification letter drafts and exec summary |
| MLH: GoDaddy Registry domain | gift card | Code `MLHUTD84` |
| MLH: DEV writing | $100 | Post after submitting |
| *Optional:* Spacetime ScrabbleBot | $1,024 / $512 / $256 | Live at **10:45 PM Sat**; one person, separate from main build |

Skip: MongoDB / Tiger Data (Spacetime is the DB), Vultr (Spacetime hosts).

---

## Winstead requirements → features

| # | Requirement | Feature | Owner |
|---|---|---|---|
| 01 | Secure & isolated | Hosted on Spacetime Maincloud, **outside** the bank network (out-of-band). Members added by ID only, no signup and no shared invite codes. Tables private, read through role-filtered views. Append-only audit log. Pitch line: "assume the attacker owns AD, email and Slack, so we don't use any of them." | A |
| 02 | Access control | Admin adds users by their ID; roles: `admin`, `incident_lead`, `responder`, `legal`, `exec_viewer`. Role checks inside reducers (server-side), not just hidden buttons. | A |
| 03 | Incident documentation | Incident record following NIST SP 800-61 phases: Detect → Analyze → Contain → Eradicate → Recover → Post-incident. Fields: severity, type, detected_at, systems, IOCs, actions taken. Immutable timeline. Live status for everyone. | B |
| 04 | Scope definitions | Scope board: data assets and Nessie customers/accounts, each tagged `encrypted` / `exfiltrated` / `accessed` / `unknown` / `clear`. Live counters ("48,210 records exposed"). | C |
| 05 | Real-time comms | Channels per workstream (#containment, #legal, #exec). Messages, tasks and status changes all stream via Spacetime subscriptions. | B |

### Creativity (what sets us apart)
- **Legal clocks:** once scope is confirmed, start countdowns: SEC 8-K (4 business days for material incidents), GDPR 72h, state breach notification laws (e.g. Texas 60 days, plus AG notice if ≥250 residents). Shown as big timers. *(Verify each rule before the demo, keep a "not legal advice" footer.)*
- **Privileged mode:** messages in #legal are labelled "Privileged & Confidential, prepared at direction of counsel".
- **Gemini drafts:** customer notification letter and 1-paragraph exec summary, both built from scope data, with a human approval step.
- **"What do I do next?" panel:** a checklist driven by the current phase, so a stressed user never needs a tutorial.

### Capital One / Nessie
- Seed a fake bank in Nessie: ~200 customers, accounts, purchases, transfers.
- Breach scenario marks a subset of customers as compromised → feeds the scope board.
- **Fraud watch:** flag unusual transfers from compromised accounts during the incident window (new payee + large amount + odd hour). One-click "freeze" (simulated in our DB if Nessie has no freeze endpoint).

---

## Architecture

```
React (Vite + TS) ──subscribe/call reducers──▶ SpacetimeDB module (TS) on Maincloud
        │                                         tables: user, role, incident, timeline_event,
        │                                                 scope_item, task, channel, message,
        │                                                 legal_clock, fraud_alert, audit_log
        └──▶ small API route / script ──▶ Nessie API (seed + read customers/accounts/transfers)
                                    └──▶ Gemini API (drafts)
```

- Use Spacetime's **TypeScript starter**. Redeem credit: code `HACKUTD2026`.
- All writes go through reducers, and every reducer appends to `audit_log` (who, what, when).
- Nessie and Gemini keys live in server env only, never in the client bundle.

---

## Team split (4 people)

- **A: Backend/Spacetime:** schema, reducers, auth and roles, audit log.
- **B: Frontend:** layout, incident page, timeline, channels, "what's next" panel.
- **C: Data:** Nessie seed script, scope board, fraud watch.
- **D: Legal and AI, plus pitch:** legal clocks, Gemini drafts, domain, Devpost, slides, demo script. *(Optionally ScrabbleBot before 10:45 PM.)*

---

## Timeline (Sat → Sun)

| When | Goal |
|---|---|
| **Hour 0–1** | Agree on schema (tables above) and the demo scenario. Repo public on GitHub. Spacetime hello-world deployed. Nessie key works. |
| **Hour 1–5** | A: tables, reducers, roles · B: shell UI, incident create/view · C: Nessie seed · D: legal clock logic, Gemini prompt |
| **Hour 5–8** | Wire UI to live subscriptions. Scope board reading Nessie data. Channels working. |
| **Before 11 PM Sat** | **Initial Devpost submission** (title, one-liner, all 3 sponsor tracks + MLH tracks selected). |
| **Overnight** | Fraud watch, legal clocks in UI, Gemini drafts, audit log view. Sleep in shifts. |
| **Sun ~8 AM** | **Feature freeze.** Only bug fixes and polish from here. |
| **8–11 AM** | Seed the demo scenario, rehearse the 3 pitches, record a backup demo video, write the README. |
| **Before 12 PM Sun** | **Final Devpost submission.** Repo public. |
| **1–4 PM** | Judging. |

### Cut order if behind (cut from the top)
1. Gemini exec summary (keep the notification letter)
2. Fraud watch "freeze"
3. Privileged mode label
4. Extra roles (keep admin + responder)
5. **Never cut:** the 5 Winstead components, Spacetime live sync, Nessie-driven scope.

---

## Demo script (3 min)

1. **0:00** "It's 2 AM. Ransomware just hit First Avon Bank. Email and Slack are compromised." Open Breach Room on a laptop that's off-network.
2. **0:20** Admin adds the legal lead by ID → they appear live with a restricted view.
3. **0:40** Lead declares the incident and logs IOCs → timeline updates on both screens instantly *(Spacetime)*.
4. **1:10** Responder marks the core-banking DB `exfiltrated` → scope board pulls affected customers from **Nessie**, counter jumps, **legal clocks start**.
5. **1:50** Fraud alert: suspicious transfer from a compromised account → freeze.
6. **2:20** Gemini drafts the customer notice → legal approves.
7. **2:40** Show the audit log and role enforcement. Close on the security model.

Tailor the opening to each judge: Winstead → security + ease of use + legal; Spacetime → live sync and that every table/reducer is Spacetime; Capital One → Nessie data flow.

---

## Open questions (ask at sponsor tables / Discord)
- [ ] Spacetime: does Maincloud hosting count as "isolated", or should we self-host on an offline laptop for the demo?
- [ ] Nessie: current base URL, rate limits, and whether a freeze/close-account endpoint exists.
- [ ] HackUTD: max tracks per project (we assume 3 sponsor tracks + unlimited MLH).
- [ ] Grand Prize "twist": check the Hackerpack.

## Rules to remember
- Spacetime requires **public source on GitHub**, so keep the GS challenge text and any secrets out of the repo.
- Wear badges. Initial Devpost **11 PM**, final **12 PM**.
