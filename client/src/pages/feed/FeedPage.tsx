// Live Feed: notice priority chart, legal deadlines, and one merged stream of chat, timeline and audit.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { Lock, Send, Hash, CheckCircle2, AlertTriangle, Clock, Plus, ChevronDown } from 'lucide-react';
import { reducers, tables } from '@/module_bindings';
import { useRun } from '@/components/Toast';
import { NoIncident, PHASE_LABEL, PRIVILEGED, SCOPE_LABEL, WRITERS, can, useCurrentIncident, useMe } from '@/components/shared';
import NotifyPriorityChart from '@/components/NotifyPriorityChart';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// Presets: verify before demo. Hours are from the team brief, not legal advice.
const PRESETS = [
  { regime: 'sec_8k', label: 'SEC 8-K (96h)', hours: 96 },
  { regime: 'gdpr', label: 'GDPR (72h)', hours: 72 },
  { regime: 'tx_breach', label: 'Texas breach notice (60 days)', hours: 1440 },
];
const FILERS = ['admin', 'incident_lead', 'legal'];

const KIND_LABEL: Record<string, string> = {
  chat: 'Chat',
  note: 'Note',
  phase_change: 'Phase',
  scope_change: 'What was hit',
  action: 'Action',
  ioc: 'Clue',
  auto: 'Auto',
  security: 'Security',
};

type Filter = 'all' | 'chat' | 'auto' | 'security';
type Item = { key: string; at: Date; kind: string; text: string; who: string };

function remaining(ms: number) {
  if (ms <= 0) return 'OVERDUE';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m ${s % 60}s left`;
}

// Phase changes are stored as "detect -> analyze"; scope changes end in ": status". Show plain labels.
const show = (kind: string, t: string) =>
  kind === 'phase_change'
    ? t.split(' -> ').map(p => PHASE_LABEL[p] ?? p).join(' → ')
    : kind === 'scope_change'
      ? t.replace(/: (\w+)$/, (_, st) => `: ${SCOPE_LABEL[st] ?? st}`)
      : t;

export default function FeedPage() {
  const me = useMe();
  const incident = useCurrentIncident();
  const [allChannels] = useTable(tables.channels);
  const [allMessages] = useTable(tables.messages);
  const [allEvents] = useTable(tables.timelineEvents);
  const [allClocks] = useTable(tables.legalClocks);
  const [audit] = useTable(tables.auditEntries);
  const [users] = useTable(tables.members);
  const sendMessage = useReducer(reducers.sendMessage);
  const addTimelineEvent = useReducer(reducers.addTimelineEvent);
  const startLegalClock = useReducer(reducers.startLegalClock);
  const completeLegalClock = useReducer(reducers.completeLegalClock);
  const run = useRun();

  const [selected, setSelected] = useState<bigint | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const [asNote, setAsNote] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ regime: 'custom', label: '', hours: '72' });
  const [now, setNow] = useState(Date.now());
  const bottom = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const privileged = can(me, PRIVILEGED);
  const isAdmin = me?.role === 'admin';
  const writer = can(me, WRITERS);
  const channels = incident ? allChannels.filter(c => c.incidentId === incident.id) : [];
  const allowed = (c: { privileged: boolean }) => !c.privileged || privileged;
  const channel =
    channels.find(c => c.id === selected && allowed(c)) ??
    channels.find(c => c.name === 'general') ??
    channels.find(allowed);
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? 'Knight Agent';

  const items: Item[] = [];
  if (incident) {
    if (filter === 'all' || filter === 'chat')
      for (const m of allMessages)
        if (m.channelId === channel?.id)
          items.push({ key: `m${m.id}`, at: m.sentAt.toDate(), kind: 'chat', text: m.text, who: nameOf(m.sender.toHexString()) });
    if (filter === 'all' || filter === 'auto')
      for (const e of allEvents)
        if (e.incidentId === incident.id && (filter === 'all' || e.kind === 'auto'))
          items.push({ key: `t${e.id}`, at: e.at.toDate(), kind: e.kind, text: show(e.kind, e.text), who: nameOf(e.actor.toHexString()) });
    // auditEntries is admin-only server side; not incident-scoped, so show all of it.
    if (filter === 'security' && isAdmin)
      for (const a of audit)
        items.push({ key: `a${a.id}`, at: a.at.toDate(), kind: 'security', text: `${a.action}: ${a.detail}`, who: nameOf(a.actor.toHexString()) });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Keep the newest item in view when one arrives or the view changes. Block body: an effect must not return a value.
  useEffect(() => {
    const list = bottom.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [items.length, channel?.id, filter]);

  if (!incident) return <NoIncident />;

  const clocks = allClocks
    .filter(c => c.incidentId === incident.id)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.deadlineAt.toDate().getTime() - b.deadlineAt.toDate().getTime());

  const noteMode = asNote && writer;
  const canPost = noteMode || (!!channel && allowed(channel));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (noteMode) run(addTimelineEvent({ incidentId: incident.id, kind: 'note', text: t }), 'Note logged');
    else if (channel) run(sendMessage({ channelId: channel.id, text: t }));
    setText('');
  };

  const startClock = (e: FormEvent) => {
    e.preventDefault();
    const hours = Number(form.hours);
    if (!Number.isInteger(hours) || hours <= 0 || !form.label.trim()) return;
    run(startLegalClock({ incidentId: incident.id, regime: form.regime, label: form.label, hours }), `Deadline added: ${form.label}`);
    setShowForm(false);
  };

  return (
    <section className="flex flex-col gap-4">
      <NotifyPriorityChart incidentId={incident.id} />

      {/* Deadlines */}
      <div className="glass p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className=" font-heading text-sm font-bold tracking-widest text-white uppercase">Deadlines</h2>
          <span className="text-xs text-muted-foreground" title="Bank regulator 36h (OCC/Fed/FDIC rule), SEC 8-K 4 business days if material (public companies), Texas AG 30 days at 250+ Texans, Texas customers 60 days. Clocks start when data is first marked stolen, our stand-in for when the bank determines the incident.">
            Federal + Texas rules, simplified. Not legal advice: Legal confirms each one.
          </span>
          <Button size="xs" variant="outline" className="ml-auto" aria-expanded={showForm} onClick={() => setShowForm(s => !s)}>
            {showForm ? <ChevronDown /> : <Plus />} Add a deadline
          </Button>
        </div>
        {clocks.length === 0 && <p className="text-sm text-muted-foreground italic">No deadlines yet: add one with "Add a deadline".</p>}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {clocks.map(c => {
            const left = c.deadlineAt.toDate().getTime() - now;
            const state = c.done ? 'done' : left <= 0 ? 'overdue' : left < 24 * 3600_000 ? 'soon' : 'ok';
            const tone = {
              done: 'border-ok/60 text-ok',
              overdue: 'border-sev-critical text-sev-critical',
              soon: 'border-sev-high text-sev-high',
              ok: 'border-neon/50 text-neon',
            }[state];
            const Icon = state === 'done' ? CheckCircle2 : state === 'ok' ? Clock : AlertTriangle;
            return (
              <li key={c.id.toString()} className={cn('flex items-center gap-2 rounded-lg border bg-background/40 px-3 py-2', tone)}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{c.label}</div>
                  <div className="font-mono text-sm font-bold">{c.done ? '✓ Filed' : remaining(left)}</div>
                  <div className="text-xs text-muted-foreground">Due {c.deadlineAt.toDate().toLocaleString()}</div>
                </div>
                {!c.done && can(me, FILERS) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.confirm(`Mark "${c.label}" as filed?`) && run(completeLegalClock({ clockId: c.id }), 'Marked as filed')}
                  >
                    Mark as filed
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {showForm && (
          <form className="mt-3 flex flex-col gap-2 border-t border-border pt-3" onSubmit={startClock}>
            <p className="text-xs text-sev-medium">Presets: verify before demo.</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <Button key={p.regime} type="button" size="xs" variant="secondary" onClick={() => setForm({ regime: p.regime, label: p.label, hours: String(p.hours) })}>
                  {p.label} · verify before demo
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
                Name
                <Input required value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs">
                Hours until due
                <Input type="number" min={1} step={1} required value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} />
              </label>
              <Button type="submit">Start clock</Button>
            </div>
          </form>
        )}
      </div>

      {/* Feed */}
      <div className="glass flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1" aria-label="Channels">
            {channels.map(c => (
              <Button
                key={c.id.toString()}
                size="sm"
                variant={c.id === channel?.id ? 'default' : 'ghost'}
                disabled={!allowed(c)}
                title={allowed(c) ? undefined : 'Lawyers and incident leads only'}
                aria-pressed={c.id === channel?.id}
                onClick={() => setSelected(c.id)}
              >
                {c.privileged ? <Lock /> : <Hash />}
                {c.name}
                {c.privileged && !allowed(c) && <span className="text-xs">(lawyers only)</span>}
              </Button>
            ))}
          </nav>
          <Tabs value={filter} onValueChange={v => setFilter(v as Filter)} className="ml-auto">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="auto">Auto</TabsTrigger>
              {isAdmin && <TabsTrigger value="security">Security</TabsTrigger>}
            </TabsList>
          </Tabs>
        </div>

        {channel?.privileged && (
          <div role="note" className=" flex items-center gap-2 rounded-lg border border-magenta/60 bg-magenta/10 px-3 py-2 text-sm font-semibold text-magenta">
            <Lock className="size-4" aria-hidden /> Privileged & Confidential — attorney-client. Do not forward.
          </div>
        )}

        <ul className="flex h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1" aria-live="polite" aria-label="Live feed">
          {items.length === 0 && <li className="text-sm text-muted-foreground italic">Nothing here yet: say what you know below.</li>}
          {items.map(it => (
            <li
              key={it.key}
              className={cn(
                'rounded-md border-l-2 border-border bg-background/30 px-3 py-1.5 text-sm',
                it.kind === 'auto' && 'border-neon',
                it.kind === 'security' && 'border-magenta'
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <time className="font-mono">{it.at.toLocaleTimeString()}</time>
                <Badge
                  variant="outline"
                  className={cn(it.kind === 'auto' && 'border-neon text-neon', it.kind === 'security' && 'border-magenta text-magenta')}
                >
                  {KIND_LABEL[it.kind] ?? it.kind}
                </Badge>
                <span>by {it.who}</span>
              </div>
              <div className="mt-0.5 break-words">{it.text}</div>
            </li>
          ))}
          <li ref={bottom} aria-hidden="true" />
        </ul>

        <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
          <label className="sr-only" htmlFor="feed-msg">Message</label>
          <Input
            id="feed-msg"
            className="min-w-48 flex-1"
            value={text}
            disabled={!canPost}
            onChange={e => setText(e.target.value)}
            placeholder={noteMode ? 'What just happened? (incident note)' : channel ? `Message #${channel.name}` : 'No channel'}
          />
          <Button type="submit" disabled={!canPost || !text.trim()}>
            <Send /> {noteMode ? 'Log note' : 'Send'}
          </Button>
          {writer && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={asNote} onCheckedChange={v => setAsNote(v)} />
              Log as incident note
            </label>
          )}
        </form>
      </div>
    </section>
  );
}
