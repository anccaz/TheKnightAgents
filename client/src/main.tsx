import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import { ToastProvider } from './components/Toast';
import App from './App';
import './index.css';

const uri = import.meta.env.VITE_SPACETIME_URI ?? 'https://maincloud.spacetimedb.com';
const dbName = import.meta.env.VITE_SPACETIME_DB ?? 'breach-room';
// One identity per server: a token issued by one SpacetimeDB server is rejected by another.
// Storage keys keep the original "breach-room" prefix so existing identities (and their roles) survive.
const TOKEN_KEY = `breach-room:auth-token:${uri}/${dbName}`;
const LEGACY_TOKEN_KEY = 'breach-room:auth-token'; // pre-fix shared key: may hold a token for this server or another
const SKIP_LEGACY_KEY = `${TOKEN_KEY}:skip-legacy`; // set once the legacy token proved wrong for this server
const RETRY_KEY = `${TOKEN_KEY}:retried`; // sessionStorage guard: recover at most once per tab session

function loadToken(): { token?: string; source: 'own' | 'legacy' | 'none' } {
  try {
    const own = localStorage.getItem(TOKEN_KEY);
    if (own) return { token: own, source: 'own' };
    const legacy = localStorage.getItem(SKIP_LEGACY_KEY) ? null : localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) return { token: legacy, source: 'legacy' };
  } catch {
    // storage blocked (private mode): connect anonymously
  }
  return { source: 'none' };
}

function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked (private mode): identity just won't survive a reload
  }
}

const saved = loadToken();
let connected = false;

/** The server rejected our saved login: forget it for this server only, then reconnect once with a fresh identity. */
function recoverFromBadToken() {
  if (connected || saved.source === 'none') return;
  try {
    if (sessionStorage.getItem(RETRY_KEY)) return;
    sessionStorage.setItem(RETRY_KEY, '1');
    if (saved.source === 'own') localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(SKIP_LEGACY_KEY, '1');
  } catch {
    return;
  }
  location.reload();
}

// Built once at module level: SpacetimeDBProvider re-connects if the builder identity changes.
const connectionBuilder = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(dbName)
  .withToken(saved.token)
  .onConnect((conn, _identity, token) => {
    connected = true;
    saveToken(token);
    try {
      sessionStorage.removeItem(RETRY_KEY);
    } catch {
      // ignore
    }
    // subscribe() with an explicit list, not subscribeToAllTables(): the SDK says the two
    // must not be mixed, and useTable() calls subscribe() on this same connection.
    conn
      .subscriptionBuilder()
      .subscribe([
        tables.members,
        tables.incidents,
        tables.timelineEvents,
        tables.scopeItems,
        tables.tasks,
        tables.channels,
        tables.messages,
        tables.legalClocks,
        tables.fraudAlerts,
        tables.auditEntries,
      ]);
  })
  .onConnectError((_ctx, err) => {
    console.error('SpacetimeDB connect error', err);
    recoverFromBadToken();
  })
  .onDisconnect(() => {
    console.warn('SpacetimeDB disconnected');
    recoverFromBadToken(); // no-op once we have connected
  });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SpacetimeDBProvider>
  </React.StrictMode>
);
