// Lane B owner: incident channels and messages.
import { useState, type FormEvent } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../../module_bindings';
import { useRun } from '../../components/Toast';
import { NoIncident, useCurrentIncident } from '../../components/shared';

export default function CommsPage() {
  const incident = useCurrentIncident();
  const [allChannels] = useTable(tables.channel);
  const [allMessages] = useTable(tables.message);
  const [users] = useTable(tables.user);
  const sendMessage = useReducer(reducers.sendMessage);
  const run = useRun();
  const [selected, setSelected] = useState<bigint | null>(null);
  const [text, setText] = useState('');

  if (!incident) return <NoIncident />;
  const channels = allChannels.filter(c => c.incidentId === incident.id);
  const channel = channels.find(c => c.id === selected) ?? channels[0];
  const messages = channel
    ? allMessages.filter(m => m.channelId === channel.id).sort((a, b) => (a.id < b.id ? -1 : 1))
    : [];
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
            onClick={() => setSelected(c.id)}
          >
            # {c.name}
            {c.privileged && <span className="privileged-tag">Privileged</span>}
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
            <ul className="messages">
              {messages.map(m => (
                <li key={m.id.toString()}>
                  <strong>{nameOf(m.sender.toHexString())}</strong>{' '}
                  <time className="muted">{m.sentAt.toDate().toLocaleTimeString()}</time>
                  <div>{m.text}</div>
                </li>
              ))}
            </ul>
            <form className="inline" onSubmit={submit}>
              <label className="sr-only" htmlFor="msg">Message</label>
              <input id="msg" required value={text} onChange={e => setText(e.target.value)} placeholder={`Message #${channel.name}`} />
              <button className="primary" type="submit">Send</button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
