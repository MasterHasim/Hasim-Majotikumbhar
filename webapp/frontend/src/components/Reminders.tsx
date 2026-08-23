import { useEffect, useState } from 'react';
import type { ReminderWithContext, WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function fmtDue(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function Reminders({ number, onOpenConversation, onOpenLead }: {
  number: WhatsAppNumber;
  onOpenConversation: (conversationId: string, numberId: string) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const [reminders, setReminders] = useState<ReminderWithContext[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listMyReminders(number.id)
      .then(setReminders)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }
  useEffect(reload, [number.id]);

  async function markDone(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await backendApi.updateReminderStatus(id, 'COMPLETED');
      reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const now = Date.now();

  return (
    <>
      <h1 className="page-title">My Reminders</h1>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}

      {reminders === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>For</th><th>Phone</th><th>Reminder</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {reminders.map((r) => {
                const overdue = new Date(r.dueAt).getTime() < now;
                const isLead = !!r.leadId;
                return (
                  <tr key={r.id}>
                    <td>{isLead ? `📍 ${r.leadName}` : r.customerName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{isLead ? r.leadPhone : r.customerPhone}</td>
                    <td>{r.text}</td>
                    <td style={{ color: overdue ? 'var(--danger)' : undefined, fontWeight: overdue ? 700 : undefined }}>
                      {overdue ? 'Overdue · ' : ''}{fmtDue(r.dueAt)}
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {isLead
                        ? <button className="btn" onClick={() => onOpenLead(r.leadId!)}>Open lead</button>
                        : <button className="btn" onClick={() => onOpenConversation(r.conversationId!, r.numberId!)}>Open chat</button>}
                      <button className="btn primary" disabled={busyId === r.id} onClick={() => void markDone(r.id)}>
                        {busyId === r.id ? '…' : 'Mark done'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {reminders.length === 0 && <tr><td colSpan={5} className="empty">No pending reminders — you're all caught up.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
