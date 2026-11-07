// Lane B owner: incident channels and messages.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { NoIncident, PRIVILEGED, can, useCurrentIncident, useMe } from '../../components/shared';

export default function CommsPage() {
  const me = useMe();
  const incident = useCurrentIncident();
  const [allChannels] = useTable(tables.channels);
  const [allMessages] = useTable(tables.messages);
  const [users] = useTable(tables.members);
  const sendMessage = useReducer(reducers.sendMessage);
  const run = useRun();
  const [selected, setSelected] = useState<bigint | null>(null);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLLIElement>(null);

  const privileged = can(me, PRIVILEGED);
  const channels = incident ? allChannels.filter(c => c.incidentId === incident.id) : [];
  const allowed = (c: { privileged: boolean }) => !c.privileged || privileged;
  const channel = channels.find(c => c.id === selected && allowed(c)) ?? channels.find(allowed);
  const messages = channel
    ? allMessages.filter(m => m.channelId === channel.id).sort((a, b) => (a.id < b.id ? -1 : 1))
    : [];
  const countIn = (id: bigint) => allMessages.filter(m => m.channelId === id).length;

  // Keep the newest message in view when one arrives or the channel changes.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, channel?.id]);

  if (!incident) return <NoIncident />;
  const nameOf = (hex: string) => users.find(u => u.identity.toHexString() === hex)?.name ?? hex.slice(0, 8);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!channel) return;
    run(sendMessage({ channelId: channel.id, text }));
    setText('');
  };

  return (
    <section className="comms">
      <nav className="channel-list" aria-label="Channels">
        <h2>Channels</h2>
        {channels.map(c => (
          <button
            key={c.id.toString()}
            className={c.id === channel?.id ? 'nav-item active' : 'nav-item'}
            disabled={!allowed(c)}
            title={allowed(c) ? undefined : 'Lawyers and incident leads only'}
            onClick={() => setSelected(c.id)}
          >
            {allowed(c) ? '#' : '🔒'} {c.name}
            {c.privileged && <span className="privileged-tag">{allowed(c) ? 'Privileged' : 'Lawyers only'}</span>}
            {allowed(c) && countIn(c.id) > 0 && <span className="muted"> ({countIn(c.id)})</span>}
          </button>
        ))}
      </nav>
      <div className="channel-body">
        {!channel ? (
          <p className="empty">No channels for this incident.</p>
        ) : (
          <>
            <h1># {channel.name}</h1>
            {channel.privileged && (
              <div className="privileged-banner" role="note">
                🔒 Privileged & Confidential: attorney-client communication. Do not forward.
              </div>
            )}
            {messages.length === 0 && <p className="empty">No messages yet: say what you know.</p>}
            <ul className="messages" aria-live="polite">
              {messages.map(m => (
                <li key={m.id.toString()}>
                  <strong>{nameOf(m.sender.toHexString())}</strong>{' '}
                  <time className="muted">{m.sentAt.toDate().toLocaleTimeString()}</time>
                  <div>{m.text}</div>
                </li>
              ))}
              <li ref={bottom} aria-hidden="true" style={{ border: 0, padding: 0 }} />
            </ul>
            <form className="inline" onSubmit={submit}>
              <label className="sr-only" htmlFor="msg">Message</label>
              <input id="msg" required autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={`Message #${channel.name}`} />
              <button className="primary" type="submit">Send</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
