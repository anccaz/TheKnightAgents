import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string };
type Run = (call: Promise<unknown>, okText?: string) => void;

const ToastContext = createContext<Run>(() => {});

/** Wrap every reducer call: `run(createIncident({...}))`. Errors (SenderError text) show as a toast. */
export function useRun(): Run {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(Toast & { ok: boolean })[]>([]);

  const push = useCallback((text: string, ok: boolean) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { id, text, ok }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), ok ? 3000 : 8000);
  }, []);

  const run = useCallback<Run>(
    (call, okText) => {
      call.then(
        () => okText && push(okText, true),
        (err: unknown) => push(err instanceof Error ? err.message : String(err), false)
      );
    },
    [push]
  );

  return (
    <ToastContext.Provider value={run}>
      {children}
      <div className="fixed top-20 right-4 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="assertive">
        {toasts.map(t => (
          <div key={t.id} className={`glass flex items-start gap-2 px-3 py-2 text-sm ${t.ok ? 'border-ok/60' : 'border-sev-critical/70'}`}>
            <strong className={t.ok ? 'text-ok' : 'text-sev-critical'}>{t.ok ? 'Done' : 'Failed'}</strong>
            {t.text}
            <button
              className="ml-auto text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
              onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
