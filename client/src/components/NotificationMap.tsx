// "Who must we tell, and by when": stolen customers by state, with each state's legal deadlines.
import { useEffect, useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '@/module_bindings';
import { TILES, countdown, obligationsFor, stateName } from '@/lib/notifyRules';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export default function NotificationMap({ incidentId }: { incidentId: bigint }) {
  const [rows] = useTable(tables.stateImpacts);
  const [now, setNow] = useState(Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const impacts = useMemo(
    () =>
      rows
        .filter(r => r.incidentId === incidentId && r.records > 0n)
        .map(r => {
          const records = Number(r.records);
          const obligations = obligationsFor(r.state, records, r.since.toDate());
          const next = obligations.map(o => o.dueAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
          return { state: r.state, records, obligations, next };
        })
        .sort((a, b) => b.records - a.records),
    [rows, incidentId]
  );
  const byState = new Map(impacts.map(i => [i.state, i]));
  const max = Math.max(1, ...impacts.map(i => i.records));
  const total = impacts.reduce((n, i) => n + i.records, 0);
  const selected = byState.get(picked ?? '') ?? impacts[0];

  return (
    <section className="glass p-4" aria-label="Notification map">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-sm tracking-[0.2em] text-neon uppercase neon-text">Who must we tell</h2>
        <span className="text-sm text-muted-foreground">
          {total ? (
            <>
              <b className="text-foreground">{total.toLocaleString()}</b> stolen records across{' '}
              <b className="text-foreground">{impacts.length}</b> states
            </>
          ) : (
            'No stolen customer data yet: the map fills in as soon as data is marked Stolen.'
          )}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        {/* Tile map */}
        <div className="grid w-full max-w-md grid-cols-11 gap-1 self-start" role="list">
          {Object.entries(TILES).map(([code, [row, col]]) => {
            const hit = byState.get(code);
            const heat = hit ? 0.25 + 0.75 * Math.sqrt(hit.records / max) : 0;
            return (
              <button
                key={code}
                role="listitem"
                style={{
                  gridRow: row + 1,
                  gridColumn: col + 1,
                  ...(hit && {
                    background: `linear-gradient(135deg, rgb(202 1 83 / ${heat}), rgb(30 63 216 / ${heat * 0.8}))`,
                    boxShadow: `0 0 ${8 + heat * 18}px rgb(202 1 83 / ${heat * 0.7})`,
                  }),
                }}
                className={cn(
                  'aspect-square rounded-md border font-mono text-[10px] leading-none transition-all sm:text-xs',
                  hit ? 'border-magenta/70 text-white' : 'border-border/50 bg-muted/30 text-muted-foreground/60',
                  selected?.state === code && 'ring-2 ring-neon ring-offset-1 ring-offset-background'
                )}
                disabled={!hit}
                onClick={() => setPicked(code)}
                aria-label={hit ? `${stateName(code)}: ${hit.records.toLocaleString()} records` : stateName(code)}
              >
                {code}
              </button>
            );
          })}
        </div>

        {/* Obligations list */}
        <div className="flex flex-col gap-2">
          {impacts.length === 0 && <p className="text-sm text-muted-foreground italic">Nothing to notify yet.</p>}
          {impacts.map(i => (
            <button
              key={i.state}
              onClick={() => setPicked(i.state)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/40',
                selected?.state === i.state ? 'border-neon bg-muted/40' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {stateName(i.state)} <span className="text-muted-foreground">· {i.records.toLocaleString()}</span>
                </span>
                <Badge variant="outline" className={cn('font-mono', i.next && i.next.getTime() - now < 7 * 86_400_000 ? 'border-sev-high text-sev-high' : 'border-neon/60 text-neon')}>
                  ⏱ {countdown(i.next, now)}
                </Badge>
              </div>
              {selected?.state === i.state && (
                <ul className="mt-2 space-y-1 text-sm">
                  {i.obligations.map(o => (
                    <li key={o.who} className="flex justify-between gap-2">
                      <span>
                        <b>{o.who}</b> <span className="text-muted-foreground">{o.text}</span>
                      </span>
                      <span className="font-mono text-neon">{o.dueAt ? o.dueAt.toLocaleDateString() : 'ASAP'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          ))}
          {impacts.length > 0 && <p className="text-xs text-sev-medium">State rules: verify before relying on them. Not legal advice.</p>}
        </div>
      </div>
    </section>
  );
}
