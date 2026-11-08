// Re-checks the audit log's hash chain in the browser, with the browser's own SHA-256 (WebCrypto),
// so the check does not trust the server's hashing code. The server side is spacetimedb/src/auditChain.ts.
import type { Identity, Timestamp } from 'spacetimedb';

export type AuditRow = {
  id: bigint;
  at: Timestamp;
  actor: Identity;
  action: string;
  detail: string;
  prevHash: string;
  hash: string;
};

/** MUST stay identical to auditCanonical in spacetimedb/src/auditChain.ts. */
function auditCanonical(prevHash: string, r: AuditRow): string {
  return JSON.stringify([prevHash, r.id.toString(), r.at.microsSinceUnixEpoch.toString(), r.actor.toHexString(), r.action, r.detail]);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type ChainResult =
  | { ok: true; checked: number; unsealed: number; head: string }
  | { ok: false; id: bigint; reason: string; checked: number };

/**
 * Walks the log oldest to newest. Entries written before the chain existed (empty hash) are skipped as
 * "unsealed", but only at the very start: an empty hash after sealing began counts as tampering.
 * Limits: deleting the newest entries cannot be detected from the log alone (compare `head` with a copy
 * kept elsewhere), and someone with full database access could rebuild the whole chain.
 */
export async function verifyAuditChain(rows: readonly AuditRow[]): Promise<ChainResult> {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let prev = '';
  let sealed = false;
  let unsealed = 0;
  let checked = 0;
  for (const r of sorted) {
    if (!r.hash && !sealed) {
      unsealed++;
      continue;
    }
    sealed = true;
    if (r.prevHash !== prev)
      return { ok: false, id: r.id, checked, reason: `Entry #${r.id} does not link to the entry before it (an entry was deleted, inserted or altered)` };
    if (r.hash !== (await sha256Hex(auditCanonical(prev, r))))
      return { ok: false, id: r.id, checked, reason: `Entry #${r.id} was altered` };
    prev = r.hash;
    checked++;
  }
  return { ok: true, checked, unsealed, head: prev };
}
