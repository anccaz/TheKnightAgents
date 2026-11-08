// Pure Nessie helpers for the in-app "Import from Nessie" button (same rules as scripts/lib.mjs, which the CLI importer uses).
// Amounts from Nessie are dollars.

export const NESSIE_BASE = 'https://prod-api.nessieisreal.com';
export const SUSPICIOUS_MIN_DOLLARS = 5000;
export const KNOWN_PAYEES = new Set(['Avon Electric', 'Knight Water', 'Ledger Internet', 'Vault Insurance', 'Patch Rent']);

export type NessieCustomer = { _id: string; first_name?: string; last_name?: string; address?: { state?: string } };
export type NessieAccount = { _id: string; type?: string; customer_id?: string; balance?: number };
export type Activity = { kind: 'withdrawal' | 'bill'; ref: string; amount: number; description: string; payee?: string };

export function normalizeActivity(kind: 'withdrawal' | 'bill', raw: any): Activity {
  if (kind === 'bill')
    return { kind, ref: String(raw?._id ?? ''), amount: Number(raw?.payment_amount), description: String(raw?.nickname ?? ''), payee: String(raw?.payee ?? '') };
  return { kind, ref: String(raw?._id ?? ''), amount: Number(raw?.amount), description: String(raw?.description ?? '') };
}

/** >= $5,000 between 2 and 4 AM (time read from the description, Nessie dates have none); bills also need a new payee. */
export function isSuspicious(item: Activity): string | null {
  const m = /\b(\d{1,2}):(\d{2})\b/.exec(item.description);
  const hour = m ? Number(m[1]) : -1;
  if (!(hour >= 2 && hour < 4 && item.amount >= SUSPICIOUS_MIN_DOLLARS)) return null;
  const amount = `$${item.amount.toLocaleString('en-US')}`;
  if (item.kind === 'bill') return KNOWN_PAYEES.has(item.payee ?? '') ? null : `${amount} bill to new payee ${item.payee} at ${m![0]} (2-4 AM window)`;
  return `${amount} withdrawal at ${m![0]} (2-4 AM window)`;
}

export function countByState(customers: NessieCustomer[]) {
  const out = new Map<string, number>();
  for (const c of customers) {
    const s = String(c.address?.state ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

export function accountLabel(a: NessieAccount) {
  const prefix = a.type === 'Savings' ? 'SAV' : a.type === 'Credit Card' ? 'CC' : 'CHK';
  return `${prefix}-${String(a._id).slice(-4).toUpperCase()}`;
}

/** Which accounts this click scans: a window of `size` starting at `offset`, wrapping around so repeat clicks cover all. */
export function batch<T>(items: T[], offset: number, size: number): { picked: T[]; next: number } {
  if (!items.length) return { picked: [], next: 0 };
  const start = offset % items.length;
  const picked = Array.from({ length: Math.min(size, items.length) }, (_, i) => items[(start + i) % items.length]);
  return { picked, next: (start + picked.length) % items.length };
}
