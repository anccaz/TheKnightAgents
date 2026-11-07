---
name: breach-room-ui
description: UI conventions for the Breach Room React client (client/). Use before building or changing any page, component, or SpacetimeDB hook usage in the frontend.
---

# Breach Room UI conventions

Winstead judges **ease of use under stress** almost as heavily as security. The user is a panicked responder at 2 AM who never read a tutorial.

## Rules
- One primary action per screen, as a big obvious button. Destructive actions confirm once.
- Always show: current incident, current phase, who's online. Never hide status behind a click.
- Plain words, no jargon in labels ("Mark as stolen", not "Set status: exfiltrated"). Tooltips are optional, never required.
- Dark theme, high contrast, severity colors: critical red, high orange, medium yellow, low gray. Status must also be readable without color (text or icon).
- Keyboard accessible, visible focus, real `<button>`/`<label>` elements.
- Empty states say what to do next ("No incident yet: Declare incident").

## Data
- All data comes from SpacetimeDB via generated bindings in `src/module_bindings/` (never edit them; run `npm run generate` in `spacetimedb/`).
- Read with `useTable(tables.<view>)` from `spacetimedb/react`. Only views exist on the client (`members`, `incidents`, `timelineEvents`, `scopeItems`, `tasks`, `channels`, `messages`, `legalClocks`, `fraudAlerts`, `auditEntries`); they already filter by the viewer's role. Write with `useReducer(reducers.x)` or `conn.reducers.x(...)`. No REST calls for app state.
- `u64` ids are `bigint`; timestamps are `Timestamp` (`.toDate()`).
- Show reducer errors (SenderError text) in a visible toast; never fail silently.

## Structure
- One folder per lane under `src/pages/` (access, incident, comms, scope, fraud, legal). Shared bits in `src/components/`.
- Plain CSS in `src/styles.css` with CSS variables. No UI framework unless the team agrees.
