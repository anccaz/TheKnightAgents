// "Who must we tell, and by when": a neon map of stolen customers by state, with each state's legal deadlines.
import { useEffect, useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';
import { tables } from '@/module_bindings';
import { CODE_BY_NAME, countdown, obligationsFor, stateName } from '@/lib/notifyRules';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type StateFeature = Feature<Geometry, { name: string }>;
type MapShapes = { states: { code: string; d: string; c: [number, number] }[]; borders: string; counties: string; nation: string };

// us-atlas ships Census shapes already projected (Albers USA) into a 975x610 box, so no projection is needed.
const path = geoPath();
let shapesPromise: Promise<MapShapes> | null = null;
function loadShapes() {
  shapesPromise ??= import('us-atlas/counties-albers-10m.json').then(m => {
    const us = m.default as unknown as Topology<{ states: GeometryCollection<{ name: string }>; counties: GeometryCollection; nation: GeometryCollection }>;
    const states = (feature(us, us.objects.states).features as StateFeature[]).map(f => ({
      code: CODE_BY_NAME[f.properties.name] ?? f.properties.name,
      d: path(f) ?? '',
      c: path.centroid(f) as [number, number],
    }));
    return {
      states,
      borders: path(mesh(us, us.objects.states, (a, b) => a !== b)) ?? '',
      counties: path(mesh(us, us.objects.counties, (a, b) => a !== b)) ?? '',
      nation: path(feature(us, us.objects.nation)) ?? '',
    };
  });
  return shapesPromise;
}

export default function NotificationMap({ incidentId }: { incidentId: bigint }) {
  const [rows] = useTable(tables.stateImpacts);
  const [shapes, setShapes] = useState<MapShapes | null>(null);
  const [now, setNow] = useState(Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    loadShapes().then(setShapes);
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
    <section aria-label="Notification map">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm tracking-[0.3em] text-white uppercase neon-text">Who must we tell</h2>
        <span className="text-sm text-muted-foreground">
          {total ? (
            <>
              <b className="text-foreground">{total.toLocaleString()}</b> stolen records across{' '}
              <b className="text-foreground">{impacts.length}</b> states
            </>
          ) : (
            'The map lights up as soon as customer data is marked Stolen.'
          )}
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Neon map: no frame, glows straight over the background */}
        <svg viewBox="0 0 975 610" className="w-full" role="img" aria-label="Map of affected states">
          <defs>
            <filter id="neon" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="hot" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {shapes ? (
            <>
              <path d={shapes.nation} fill="rgb(4 6 20 / 0.55)" />
              {/* county lines = the "street grid" texture */}
              <path d={shapes.counties} fill="none" stroke="#1e3fd8" strokeOpacity={0.45} strokeWidth={0.35} />
              {shapes.states.map(s => {
                const hit = byState.get(s.code);
                if (!hit) return null;
                const heat = 0.3 + 0.7 * Math.sqrt(hit.records / max);
                const isSel = selected?.state === s.code;
                return (
                  <path
                    key={s.code}
                    d={s.d}
                    role="button"
                    tabIndex={0}
                    aria-label={`${stateName(s.code)}: ${hit.records.toLocaleString()} records`}
                    fill={`rgb(202 1 83 / ${heat * 0.75})`}
                    stroke={isSel ? '#38bcf6' : '#ff2d6f'}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    filter="url(#hot)"
                    className="cursor-pointer outline-none transition-[fill] focus-visible:stroke-white"
                    onClick={() => setPicked(s.code)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setPicked(s.code)}
                  />
                );
              })}
              <path d={shapes.borders} fill="none" stroke="#38bcf6" strokeOpacity={0.75} strokeWidth={0.9} filter="url(#neon)" pointerEvents="none" />
              <path d={shapes.nation} fill="none" stroke="#82a6e0" strokeWidth={1.6} filter="url(#neon)" pointerEvents="none" />
              {shapes.states.map(s => {
                const hit = byState.get(s.code);
                return hit ? (
                  <g key={s.code} transform={`translate(${s.c[0]},${s.c[1]})`} pointerEvents="none" className="font-mono">
                    <text textAnchor="middle" y={-2} fontSize={15} fontWeight={700} fill="#fff" filter="url(#neon)">{s.code}</text>
                    <text textAnchor="middle" y={13} fontSize={11} fill="#ffd6e6">{hit.records.toLocaleString()}</text>
                  </g>
                ) : null;
              })}
            </>
          ) : (
            <text x={487} y={305} textAnchor="middle" fill="#8ea3c9" className="font-mono text-sm">Loading map…</text>
          )}
        </svg>

        {/* Obligations list */}
        <div className="glass flex flex-col gap-2 p-3">
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
