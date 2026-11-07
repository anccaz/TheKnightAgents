import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import { ToastProvider } from './components/Toast';
import App from './App';
import './styles.css';

const TOKEN_KEY = 'breach-room:auth-token';
const uri = import.meta.env.VITE_SPACETIME_URI ?? 'ws://localhost:3000';
const dbName = import.meta.env.VITE_SPACETIME_DB ?? 'breach-room';

function loadToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
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
        tables.user,
        tables.invite,
        tables.incident,
        tables.timelineEvent,
        tables.scopeItem,
        tables.task,
        tables.channel,
        tables.message,
        tables.legalClock,
        tables.fraudAlert,
        tables.auditLog,
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
