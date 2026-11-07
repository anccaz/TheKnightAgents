---
name: spacetime-module
description: How to add or change tables and reducers in the Breach Room SpacetimeDB module (spacetimedb/src/index.ts), using the SpacetimeDB v2 TypeScript API. Use before touching the module, adding a field, writing a reducer, or regenerating client bindings.
---

# SpacetimeDB module (v2 TypeScript API)

The module lives in `spacetimedb/src/index.ts`. It is the **data contract** for the whole team.

## Ownership
- Only **Lane A** changes table definitions. Other lanes: ask A, or add a reducer that uses existing tables.
- After any module change: `npm run typecheck` in `spacetimedb/`, publish, then `npm run generate` so `client/src/module_bindings/` matches.

## API cheat sheet (spacetimedb@2.14.x; older 1.x examples online are WRONG)
```ts
import { schema, table, t, SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';

const thing = table({ public: true }, {
  id: t.u64().primaryKey().autoInc(),   // insert with id: 0n
  incidentId: t.u64().index(),          // gives ctx.db.thing.incidentId.filter(x)
  owner: t.identity(),
  at: t.timestamp(),
  note: t.string().optional(),
});
const db = schema({ thing });           // object keys become ctx.db accessors
export default db;

export const doThing = db.reducer({ note: t.string() }, (ctx, { note }) => {
  ctx.sender; ctx.timestamp; ctx.random.fill(new Uint8Array(8));
  ctx.db.thing.insert({ id: 0n, incidentId: 1n, owner: ctx.sender, at: ctx.timestamp, note });
  ctx.db.thing.id.find(1n);             // primary key / unique lookup
  ctx.db.thing.id.update({ ...row });   // update only via primary key
  ctx.db.thing.id.delete(1n);
  throw new SenderError('shown to caller');
});
export const onConnect = db.clientConnected(ctx => {});
```
- Exported const name = reducer name. Client calls it camelCase: `conn.reducers.doThing({ note })`.
- `u64` columns are `bigint` (`0n`, `BigInt(x)`).
- Timestamps: `new Timestamp(ctx.timestamp.microsSinceUnixEpoch + micros)`.

## House rules
- Every write goes through a reducer. Start each reducer with `requireRole(ctx, ...)`.
- Security-relevant actions call `audit(ctx, action, detail)`. Incident-visible actions call `timeline(...)`.
- Validate enum strings with `oneOf(value, LIST, 'what')` against the constants at the top of the file.
- Never trust client-sent identities for authorization; use `ctx.sender`.
- Known gap: all tables are `public: true`. Hardening with role-filtered views is Lane A's job before the demo.
