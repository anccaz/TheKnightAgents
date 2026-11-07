// Shared hooks, labels and small UI bits used by every lane.
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';

// Mirrors the enum constants in spacetimedb/src/index.ts (the data contract).
export const PHASES = ['detect', 'analyze', 'contain', 'eradicate', 'recover', 'post_incident'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const ROLES = ['admin', 'incident_lead', 'responder', 'legal', 'exec_viewer'] as const;
export const SCOPE_STATUSES = ['encrypted', 'exfiltrated', 'accessed', 'unknown', 'clear'] as const;

// Plain-word labels (skill rule: no jargon in labels).
export const PHASE_LABEL: Record<string, string> = {
  detect: 'Detect',
  analyze: 'Analyze',
  contain: 'Contain',
  eradicate: 'Remove threat',
  recover: 'Recover',
  post_incident: 'Lessons learned',
};
export const SCOPE_LABEL: Record<string, string> = {
  encrypted: 'Locked by ransomware',
  exfiltrated: 'Stolen',
  accessed: 'Seen by attacker',
  unknown: 'Not checked yet',
  clear: 'Safe',
};
export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  incident_lead: 'Incident lead',
  responder: 'Responder',
  legal: 'Legal',
  exec_viewer: 'Executive (view only)',
};

/** The signed-in member row, or undefined if this identity has not joined yet. */
export function useMe() {
  const { identity } = useSpacetimeDB();
  const [users] = useTable(tables.members);
  return identity ? users.find(u => u.identity.isEqual(identity)) : undefined;
}

// shortcut: "current incident" = newest incident; add an incident picker if two run at once.
export function useCurrentIncident() {
  const [incidents] = useTable(tables.incidents);
  return incidents.reduce<(typeof incidents)[number] | undefined>(
    (best, i) => (!best || i.id > best.id ? i : best),
    undefined
  );
}

/** Text + color, so status is readable without color. */
export function Chip({ kind, value, label }: { kind: string; value: string; label?: string }) {
  return <span className={`chip ${kind}-${value}`}>{label ?? value}</span>;
}

export function SeverityChip({ severity }: { severity: string }) {
  const icon = severity === 'critical' ? '!!' : severity === 'high' ? '!' : '';
  return <Chip kind="sev" value={severity} label={`${icon} ${severity.toUpperCase()}`.trim()} />;
}

export function NoIncident() {
  return <p className="empty">No incident yet: go to Incident and press "Declare incident".</p>;
}
