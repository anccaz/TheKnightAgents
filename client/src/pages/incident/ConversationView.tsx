// Conversation view: the incident as one live thread. Detections, AI briefings and fraud alerts arrive as messages
// you act on in place, and Knight Agent asks the next question (next step, sign-off, phase move). Same data and reducers
// as the classic view.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useProcedure, useReducer, useTable } from 'spacetimedb/react';
import { Bot, ChevronRight, Hash, Lock, Radar, Send, ShieldAlert, Snowflake, Sparkles, ThumbsUp, Zap } from 'lucide-react';
import { procedures, reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { LEADS, PHASES, PHASE_LABEL, PRIVILEGED, SCOPE_LABEL, SEE_RECORDS, WRITERS, can, useCurrentIncident, useMe } from '@/components/shared';
import AfterActionSummary from '@/components/AfterActionSummary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AutoAdvanceBanner } from './IncidentPage';
import { AgentPrompts, AskBubbles, NessieCard, type Ask } from './AgentPrompts';

type Incident = NonNullable<ReturnType<typeof useCurrentIncident>>;
type Item =
  | { type: 'chat'; key: string; at: Date; who: string; mine: boolean; channel: string; privileged: boolean; text: string }
  | { type: 'agent'; key: string; at: Date; channel: string; title: string; body: string }
  | { type: 'event'; key: string; at: Date; kind: string; who: string; text: string }
  | { type: 'phase'; key: string; at: Date; text: string }
  | { type: 'fraud'; key: string; at: Date; id: bigint; account: string; cents: bigint; reason: string; status: string }
  | { type: 'nessie'; key: string; at: Date }
  | Ask;

const money = (cents: bigint) => `$${(cents / 100n).toLocaleString()}`;
const AVATAR = ['from-sky-400 to-indigo-500', 'from-fuchsia-400 to-pink-500', 'from-emerald-400 to-teal-500', 'from-amber-300 to-orange-500', 'from-violet-400 to-purple-600'];
const avatarOf = (name: string) => AVATAR[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

export default function ConversationView({ incident }: { incident: Incident }) {
  const summary = incident.phase === 'post_incident';
  return (
    <div className="flex flex-col gap-4">
      <PhaseRail incident={incident} />
      {summary && <AfterActionSummary incident={incident} />}
      <Thread incident={incident} />
    </div>
  );
}

function Thread({ incident }: { incident: Incident }) {
  const me = useMe();
  const [channels] = useTable(tables.channels);
  const [messages] = useTable(tables.messages);
  const [events] = useTable(tables.timelineEvents);
  const [alerts] = useTable(tables.fraudAlerts);
  const [scope] = useTable(tables.scopeItems);
  const [users] = useTable(tables.members);
  const sendMessage = useReducer(reducers.sendMessage);
  const addTimelineEvent = useReducer(reducers.addTimelineEvent);
  const setFraudAlertStatus = useReducer(reducers.setFraudAlertStatus);
  const [cursors] = useTable(tables.nessieCursors);
  const askAdvisor = useProcedure(procedures.askAdvisor);
  const [asks, setAsks] = useState<Ask[]>([]);
  const run = useRun();
  const [view, setView] = useState<'all' | bigint>('all');
  const [target, setTarget] = useState<bigint | 'note' | null>(null);
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);

  const privileged = can(me, PRIVILEGED);
  const mine = channels.filter(c => c.incidentId === incident.id && (!c.privileged || privileged));
  const chName = new Map(mine.map(c => [c.id, c]));
  const general = mine.find(c => c.name === 'general');
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name;
  const meHex = me?.identity.toHexString();

  const items: Item[] = [];
  for (const m of messages) {
    const ch = chName.get(m.channelId);
    if (!ch || (view !== 'all' && view !== ch.id)) continue;
    const at = m.sentAt.toDate();
    if (m.text.startsWith('🤖')) {
      const [head, ...body] = m.text.replace(/^🤖 /, '').split('\n');
      items.push({ type: 'agent', key: `m${m.id}`, at, channel: ch.name, title: head.replace(/:$/, ''), body: body.join('\n').replace(/\s*\[[A-Z]\d*(?:,\s*[A-Z]\d*)*\]/g, '') });
    } else {
      const hex = m.sender.toHexString();
      items.push({ type: 'chat', key: `m${m.id}`, at, who: nameOf(hex) ?? 'Knight Agent', mine: hex === meHex, channel: ch.name, privileged: ch.privileged, text: m.text });
    }
  }
  if (view === 'all') {
    for (const e of events) {
      if (e.incidentId !== incident.id) continue;
      if (e.kind === 'phase_change') {
        items.push({ type: 'phase', key: `t${e.id}`, at: e.at.toDate(), text: e.text.split(' -> ').map(p => PHASE_LABEL[p] ?? p).join(' → ') });
        continue;
      }
      const text = e.kind === 'scope_change' ? e.text.replace(/: (\w+)$/, (_, st) => `: ${SCOPE_LABEL[st] ?? st}`) : e.text;
      items.push({ type: 'event', key: `t${e.id}`, at: e.at.toDate(), kind: e.kind, who: nameOf(e.actor.toHexString()) ?? 'Knight Agent', text });
    }
    for (const a of alerts)
      if (a.incidentId === incident.id)
        items.push({ type: 'fraud', key: `f${a.id}`, at: a.createdAt.toDate(), id: a.id, account: a.accountRef, cents: a.amountCents, reason: a.reason, status: a.status });
    const cur = cursors.find(c => c.incidentId === incident.id);
    if (cur) items.push({ type: 'nessie', key: 'nessie', at: cur.at.toDate() });
    items.push(...asks);
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, view, asks]);

  const sendTo = target ?? (view !== 'all' ? view : general?.id ?? null);
  const writer = can(me, WRITERS);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    // "@agent ..." asks the incident advisor; the answer appears in this thread (only on this screen).
    const q = t.match(/^@agent\b[,:]?\s*(.*)$/i);
    if (q) {
      const key = `ask${Date.now()}`;
      const question = q[1] || 'What should we do next?';
      setAsks(a => [...a, { type: 'ask', key, at: new Date(), question, answer: null }]);
      const answer = (s: string) => setAsks(a => a.map(x => (x.key === key ? { ...x, answer: s } : x)));
      askAdvisor({ incidentId: incident.id, question, history: '', notices: '[]' })
        .then(json => answer(String(JSON.parse(json).answer ?? '').replace(/\s*\[[A-Z]\d*\]/g, '')))
        .catch(e => answer(`I couldn't answer that: ${e instanceof Error ? e.message : e}`));
      setText('');
      return;
    }
    if (sendTo === null) return;
    if (sendTo === 'note') run(addTimelineEvent({ incidentId: incident.id, kind: 'note', text: t }), 'Logged to the timeline');
    else run(sendMessage({ channelId: sendTo, text: t }));
    setText('');
  };
  const decide = (id: bigint, account: string, status: 'frozen' | 'dismissed') =>
    window.confirm(`${status === 'frozen' ? 'Freeze account' : 'Mark as fine'}: ${account}?`) &&
    run(setFraudAlertStatus({ alertId: id, status }), status === 'frozen' ? `Froze ${account}` : `${account} marked as fine`);

  const stolen = scope.filter(s => s.incidentId === incident.id && s.status === 'exfiltrated').reduce((n, s) => n + s.recordsCount, 0n);

  return (
    <section className="glass flex h-[calc(100vh-19rem)] min-h-[32rem] flex-col overflow-hidden p-0" aria-label="Incident conversation">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-gradient-to-r from-sky-500/10 via-violet-500/10 to-fuchsia-500/10 px-4 py-3">
        <span className="relative mr-1 flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
        <h2 className="mr-2 font-heading text-sm font-bold tracking-[0.2em] text-white uppercase">Live room</h2>
        <nav className="flex flex-wrap gap-1" aria-label="Show">
          <Pill active={view === 'all'} onClick={() => setView('all')}>
            <Sparkles /> Everything
          </Pill>
          {mine.map(c => (
            <Pill key={`${c.id}`} active={view === c.id} onClick={() => setView(c.id)}>
              {c.privileged ? <Lock /> : <Hash />}
              {c.name}
            </Pill>
          ))}
        </nav>
        {can(me, SEE_RECORDS) && stolen > 0n && (
          <Badge variant="outline" className="ml-auto border-rose-400/50 bg-rose-500/10 text-rose-300">
            {stolen.toLocaleString()} records stolen
          </Badge>
        )}
      </header>

      <ol ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Messages">
        {items.length === 0 && (
          <li className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            The room is quiet. Detections, AI briefings and your team's messages will show up here as they happen.
          </li>
        )}
        {items.map(it => (
          <li key={it.key} className="flex flex-col">
            {it.type === 'chat' && <ChatBubble it={it} />}
            {it.type === 'agent' && <AgentCard it={it} />}
            {it.type === 'phase' && <PhaseDivider it={it} />}
            {it.type === 'event' && <EventLine it={it} />}
            {it.type === 'fraud' && <FraudCard it={it} canDecide={can(me, LEADS)} decide={decide} />}
            {it.type === 'nessie' && <NessieCard incidentId={incident.id} at={it.at} />}
            {it.type === 'ask' && <AskBubbles it={it} />}
          </li>
        ))}
        {view === 'all' && <AgentPrompts incident={incident} />}
      </ol>

      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-white/10 bg-background/60 p-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span className="mr-1">Send to</span>
          {mine.map(c => (
            <Pill key={`${c.id}`} small active={sendTo === c.id} onClick={() => setTarget(c.id)}>
              {c.privileged ? <Lock /> : <Hash />}
              {c.name}
            </Pill>
          ))}
          {writer && (
            <Pill small active={sendTo === 'note'} onClick={() => setTarget('note')}>
              <ChevronRight /> timeline note
            </Pill>
          )}
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="room-msg">Message</label>
          <Input
            id="room-msg"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={sendTo === 'note' ? 'What just happened? (goes in the incident record)' : `Message #${sendTo !== null ? chName.get(sendTo)?.name ?? '' : ''}, or ask "@agent which deadline is closest?"`}
            className="h-11 rounded-full border-white/10 bg-white/5 px-4"
          />
          <Button type="submit" disabled={!text.trim()} className="h-11 rounded-full bg-gradient-to-r from-sky-500 to-violet-600 px-5 text-white hover:opacity-90">
            <Send /> Send
          </Button>
        </div>
      </form>
    </section>
  );
}

function Pill({ active, small, onClick, children }: { active: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5',
        small ? 'h-7 text-xs' : 'h-8 text-sm',
        active ? 'border-transparent bg-gradient-to-r from-sky-500 to-violet-600 text-white shadow-lg shadow-violet-500/20' : 'border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function ChatBubble({ it }: { it: Extract<Item, { type: 'chat' }> }) {
  return (
    <div className={cn('flex max-w-[85%] items-end gap-2', it.mine && 'flex-row-reverse self-end')}>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-bold text-white', avatarOf(it.who))} aria-hidden="true">
        {initials(it.who)}
      </span>
      <div className={cn('flex flex-col gap-1', it.mine && 'items-end')}>
        <span className="text-xs text-muted-foreground">
          {it.mine ? 'You' : it.who} · #{it.channel} · {time(it.at)}
        </span>
        <p
          className={cn(
            'rounded-2xl px-4 py-2 text-sm break-words whitespace-pre-line',
            it.mine ? 'rounded-br-md bg-gradient-to-br from-sky-500 to-violet-600 text-white' : 'rounded-bl-md border border-white/10 bg-white/5 text-foreground',
            it.privileged && !it.mine && 'border-fuchsia-400/40 bg-fuchsia-500/10'
          )}
        >
          {it.text}
        </p>
      </div>
    </div>
  );
}

function AgentCard({ it }: { it: Extract<Item, { type: 'agent' }> }) {
  return (
    <div className="max-w-[90%] rounded-2xl bg-gradient-to-r from-violet-500/60 via-fuchsia-500/50 to-sky-500/60 p-px">
      <div className="rounded-2xl bg-background/95 px-4 py-3">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <Bot className="size-3.5" aria-hidden="true" />
          </span>
          <span className="font-semibold text-violet-200">{it.title}</span>
          <span className="text-muted-foreground">· #{it.channel} · {time(it.at)}</span>
        </div>
        <p className="text-sm whitespace-pre-line text-foreground/90">{it.body}</p>
      </div>
    </div>
  );
}

function PhaseDivider({ it }: { it: Extract<Item, { type: 'phase' }> }) {
  return (
    <div className="my-1 flex items-center gap-3 text-xs font-semibold tracking-widest text-sky-300 uppercase">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-sky-400/50" />
      Phase: {it.text}
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-sky-400/50" />
    </div>
  );
}

function EventLine({ it }: { it: Extract<Item, { type: 'event' }> }) {
  const alert = it.kind === 'ioc';
  const Icon = alert ? Radar : it.kind === 'auto' ? Zap : ShieldAlert;
  return (
    <div
      className={cn(
        'flex max-w-[90%] items-start gap-2 rounded-xl border px-3 py-2 text-sm',
        alert ? 'border-rose-400/40 bg-rose-500/10 text-rose-100' : it.kind === 'auto' ? 'border-emerald-400/25 bg-emerald-500/5' : 'border-white/10 bg-white/[0.03]'
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', alert ? 'text-rose-300' : it.kind === 'auto' ? 'text-emerald-300' : 'text-muted-foreground')} aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">
        {alert && <b className="mr-1 text-rose-300">Security alert:</b>}
        {it.text}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {it.kind === 'auto' ? 'Automatic' : it.who} · {time(it.at)}
      </span>
    </div>
  );
}

function FraudCard({ it, canDecide, decide }: { it: Extract<Item, { type: 'fraud' }>; canDecide: boolean; decide: (id: bigint, account: string, s: 'frozen' | 'dismissed') => void }) {
  const open = it.status === 'open';
  return (
    <div className={cn('flex max-w-[90%] flex-wrap items-center gap-3 rounded-2xl border px-4 py-3', open ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/[0.03] opacity-80')}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold tracking-wider text-amber-300 uppercase">Fraud alert · {time(it.at)}</div>
        <div className="text-sm">
          <b className="font-mono text-base text-white">{money(it.cents)}</b> from <code className="font-mono">{it.account}</code>
        </div>
        <div className="text-xs text-muted-foreground">{it.reason}</div>
      </div>
      {open && canDecide ? (
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={() => decide(it.id, it.account, 'frozen')}>
            <Snowflake /> Freeze
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide(it.id, it.account, 'dismissed')}>
            <ThumbsUp /> It's fine
          </Button>
        </div>
      ) : (
        <Badge variant="outline" className={cn(it.status === 'frozen' ? 'border-sky-400/50 text-sky-300' : 'text-muted-foreground')}>
          {it.status === 'frozen' ? '❄ Frozen' : it.status === 'dismissed' ? 'Marked fine' : 'Waiting for a lead'}
        </Badge>
      )}
    </div>
  );
}

/** Slim horizontal phase bar with the one "move on" button. */
function PhaseRail({ incident }: { incident: Incident }) {
  const me = useMe();
  const setPhase = useReducer(reducers.setPhase);
  const run = useRun();
  const idx = PHASES.indexOf(incident.phase as (typeof PHASES)[number]);
  const next = PHASES[idx + 1];
  const lead = can(me, LEADS);
  return (
    <section className="glass flex flex-col gap-2 px-4 py-2.5" aria-label="Phases">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {PHASES.map((p, i) => (
            <li key={p} className="flex items-center gap-1" aria-current={i === idx ? 'step' : undefined}>
              <span
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap',
                  i < idx && 'bg-emerald-500/15 text-emerald-300',
                  i === idx && 'bg-gradient-to-r from-sky-500 to-violet-600 font-bold text-white shadow-lg shadow-violet-500/30',
                  i > idx && 'text-muted-foreground'
                )}
              >
                {i < idx ? '✓' : i + 1} {PHASE_LABEL[p]}
                <span className="sr-only">{i < idx ? '(done)' : i === idx ? '(now)' : '(not started)'}</span>
              </span>
              {i < PHASES.length - 1 && <span className={cn('h-px w-3 sm:w-5', i < idx ? 'bg-emerald-400/50' : 'bg-white/15')} aria-hidden="true" />}
            </li>
          ))}
        </ol>
        {next && lead && (
          <Button
            size="sm"
            className="rounded-full bg-gradient-to-r from-sky-500 to-violet-600 px-4 font-bold text-white hover:opacity-90"
            onClick={() => run(setPhase({ incidentId: incident.id, phase: next }), `Phase: ${PHASE_LABEL[next]}`)}
          >
            Move to {PHASE_LABEL[next]} →
          </Button>
        )}
        {!lead && <span className="text-xs text-muted-foreground">Only the incident lead moves phases.</span>}
      </div>
      <AutoAdvanceBanner incidentId={incident.id} />
    </section>
  );
}

