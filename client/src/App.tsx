import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { Radio, ShieldAlert, Users } from 'lucide-react';
import { tables } from '@/module_bindings';
import GradientASCII from '@/components/GradientASCII';
import { PHASE_LABEL, ROLE_LABEL, SeverityChip, useCurrentIncident, useMe } from '@/components/shared';
import { cn } from '@/lib/utils';
import IncidentPage from '@/pages/incident/IncidentPage';
import FeedPage from '@/pages/feed/FeedPage';
import TeamPage, { JoinScreen } from '@/pages/team/TeamPage';

// Three pages. Simple state router: no router dependency.
const PAGES = {
  incident: { label: 'Incident', Icon: ShieldAlert, Page: IncidentPage, adminOnly: false },
  feed: { label: 'Live Feed', Icon: Radio, Page: FeedPage, adminOnly: false },
  team: { label: 'Team', Icon: Users, Page: TeamPage, adminOnly: true },
} as const;
type PageKey = keyof typeof PAGES;

function Background() {
  // Full-screen React Bits background (settings from the team's chosen preset).
  return (
    <div style={{ width: '100%', height: '100vh', position: 'fixed', inset: 0, zIndex: 0 }}>
      <GradientASCII
        colors={['#1e3fd8', '#82a6e0', '#38bcf6', '#ca0153', '#580534']}
        shape="horizon"
        characters=" =+xX0S8#@"
        cellSize={18}
        density={0.8}
        glyphOpacity={0.85}
        glow={0.4}
        depthOfField={0}
        flicker={0.2}
        softness={0.5}
        scale={1.7}
        flow={0.5}
        speed={1}
        gradientOpacity={0.9}
        grain={0.08}
        variation={0}
        mouseInteraction
        scrambleRadius={0.1}
        clickEffect="burst"
        intro
        lightMode={false}
      />
    </div>
  );
}

export default function App() {
  const { isActive, connectionError } = useSpacetimeDB();
  const [users] = useTable(tables.members);
  const me = useMe();
  const incident = useCurrentIncident();
  const [page, setPage] = useState<PageKey>('incident');

  const online = users.filter(u => u.online);
  const visible = (Object.keys(PAGES) as PageKey[]).filter(k => !PAGES[k].adminOnly || me?.role === 'admin');
  const current = visible.includes(page) ? page : 'incident';
  const { Page } = PAGES[current];

  return (
    <div className="min-h-screen text-foreground">
      <Background />
      <div className="relative z-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background/35 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-heading text-xl font-bold tracking-[0.25em] text-white neon-text">
            BREACH<span className="text-magenta magenta-text">//</span>ROOM
          </span>
          {incident ? (
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <strong className="truncate">{incident.title}</strong>
              <span className="rounded-full border border-neon/50 px-2.5 py-0.5 font-mono text-xs text-neon">
                PHASE: {(PHASE_LABEL[incident.phase] ?? incident.phase).toUpperCase()}
              </span>
              <SeverityChip severity={incident.severity} />
            </span>
          ) : (
            <span className="text-muted-foreground">No active incident</span>
          )}
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span title={online.map(u => u.name).join(', ')} className="text-ok">● {online.length} online</span>
            {me && (
              <span className="text-muted-foreground">
                {me.name} · {ROLE_LABEL[me.role] ?? me.role}
              </span>
            )}
            <span className={cn('font-mono text-xs', isActive ? 'text-ok' : 'text-sev-critical')}>
              {isActive ? '◉ LINKED' : connectionError ? '✕ OFFLINE' : '… CONNECTING'}
            </span>
          </span>
        </div>
        {me && (
          <nav className="mx-auto flex max-w-7xl gap-1 px-4" aria-label="Sections">
            {visible.map(k => {
              const { label, Icon } = PAGES[k];
              return (
                <button
                  key={k}
                  onClick={() => setPage(k)}
                  aria-current={k === current ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 border-b-2 px-4 py-2 font-mono text-sm tracking-wider uppercase transition-colors',
                    k === current ? 'border-neon text-neon neon-text' : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              );
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{me ? <Page /> : <JoinScreen />}</main>
      </div>
    </div>
  );
}
