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
const TOKEN_KEY = `breach-room:auth-token:${uri}/${dbName}`;
const LEGACY_TOKEN_KEY = 'breach-room:auth-token'; // pre-fix key; only ever held local-server identities

function loadToken(): string | undefined {
  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(uri);
    return localStorage.getItem(TOKEN_KEY) ?? (isLocal ? localStorage.getItem(LEGACY_TOKEN_KEY) : null) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked (private mode): identity just won't survive a reload
  }
}

// Built once at module level: SpacetimeDBProvider re-connects if the builder identity changes.
const connectionBuilder = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(dbName)
  .withToken(loadToken())
  .onConnect((conn, _identity, token) => {
    saveToken(token);
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
  .onConnectError((_ctx, err) => console.error('SpacetimeDB connect error', err))
  .onDisconnect(() => console.warn('SpacetimeDB disconnected'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </SpacetimeDBProvider>
  </React.StrictMode>
);
