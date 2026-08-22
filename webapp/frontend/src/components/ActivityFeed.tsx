import type { AuditEntryWithActor } from '../types';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Turns a raw audit action + metadata into a plain-English line — the entries themselves are
 * written for machine filtering (dotted action names, entity-scoped metadata), not for reading. */
function describe(entry: AuditEntryWithActor): string {
  const m = entry.metadata ?? {};
  switch (entry.action) {
    case 'lead.reassigned': return 'Reassigned';
    case 'lead.stageChanged': return 'Stage changed';
    case 'lead.tagsUpdated': {
      const tags = Array.isArray(m.tags) ? (m.tags as string[]) : [];
      return tags.length ? `Tags set to: ${tags.join(', ')}` : 'Tags cleared';
    }
    case 'lead.called': return 'Called';
    case 'leadRemark.added': return 'Comment added';
    case 'remark.added': return 'Remark added';
    case 'reminder.created': return 'Reminder created';
    case 'reminder.statusChanged': return `Reminder marked ${String(m.status ?? '').toLowerCase()}`;
    case 'conversation.called': return 'Called';
    case 'conversation.assigned': return 'Reassigned';
    case 'conversation.snoozed': return 'Snoozed';
    case 'conversation.unsnoozed': return 'Unsnoozed';
    case 'customer.stageChanged': return 'Stage changed';
    case 'customer.updated': {
      const patch = (m.patch ?? {}) as Record<string, unknown>;
      const fields = Object.keys(patch).filter((k) => k !== 'tags');
      const parts: string[] = [];
      if (fields.length) parts.push(`Updated: ${fields.join(', ')}`);
      if (Array.isArray(patch.tags)) parts.push(`Tags set to: ${(patch.tags as string[]).join(', ') || 'none'}`);
      return parts.length ? parts.join(' · ') : 'Updated';
    }
    default: return entry.action.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}

export function ActivityFeed({ entries }: { entries: AuditEntryWithActor[] | null }) {
  if (entries === null) return <div className="empty">Loading…</div>;
  if (entries.length === 0) return <div className="note-item" style={{ color: 'var(--text-secondary)' }}>No activity recorded yet.</div>;
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.id} className="note-item">
          <div>{describe(entry)}</div>
          <div className="note-meta">{entry.actorName} · {fmt(entry.occurredAt)}</div>
        </div>
      ))}
    </>
  );
}
