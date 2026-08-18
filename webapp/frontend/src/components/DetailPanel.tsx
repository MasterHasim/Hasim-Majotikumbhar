import { useState } from 'react';
import type { Stage, Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function fmtDue(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function DetailPanel({ workspace, stages, onChanged }: { workspace: Workspace; stages: Stage[]; onChanged: () => void }) {
  const [remarkText, setRemarkText] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [reminderDue, setReminderDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function guard<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    return fn()
      .then((v) => { onChanged(); return v; })
      .catch((err) => { setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)); return undefined; })
      .finally(() => setBusy(false));
  }

  const customer = workspace.customer;

  return (
    <div id="detailCol" className="col">
      <div className="cust-header">
        <div className="cust-avatar">{(customer?.name || customer?.phone || '?').charAt(0).toUpperCase()}</div>
        <div className="cust-name">{customer?.name || 'Unknown'}</div>
      </div>

      <div className="cust-fields">
        <div className="field-row"><span className="field-label">Phone</span><span className="field-value">{customer?.phone}</span></div>
        {customer?.email && <div className="field-row"><span className="field-label">Email</span><span className="field-value">{customer.email}</span></div>}
        {customer?.company && <div className="field-row"><span className="field-label">Company</span><span className="field-value">{customer.company}</span></div>}
        <div className="field-row">
          <span className="field-label">Assigned</span>
          <select
            className="field-value"
            disabled={busy}
            value={workspace.conversation.assignedUserId || ''}
            onChange={(e) => { if (e.target.value) void guard(() => backendApi.reassignConversation(workspace.conversation.id, e.target.value)); }}
          >
            <option value="">Unassigned</option>
            {workspace.assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <span className="field-label">Stage</span>
          <select
            className="field-value"
            disabled={busy || !customer}
            value={workspace.stage?.stageId || ''}
            onChange={(e) => { if (e.target.value && customer) void guard(() => backendApi.setCustomerStage(customer.id, e.target.value)); }}
          >
            <option value="">No stage</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <span className="field-label">Snooze</span>
          {workspace.snoozeStatus?.snoozed ? (
            <button className="btn" disabled={busy} onClick={() => void guard(() => backendApi.unsnoozeConversation(workspace.conversation.id))}>
              Snoozed — unsnooze
            </button>
          ) : (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
                void guard(() => backendApi.snoozeConversation(workspace.conversation.id, until));
              }}
            >
              Snooze 24h
            </button>
          )}
        </div>
      </div>

      {error && <div className="compose-error">{error}</div>}

      <details className="detail-section" open>
        <summary>Remarks ({workspace.remarks?.length ?? 0})</summary>
        <div className="detail-section-body">
          {(workspace.remarks ?? []).map((remark) => (
            <div key={remark.id} className="note-item">
              <div>{remark.text}</div>
              <div className="note-meta">{fmtDue(remark.createdAt)}</div>
            </div>
          ))}
          <div className="mini-add">
            <input placeholder="Add a remark…" value={remarkText} onChange={(e) => setRemarkText(e.target.value)} />
            <button
              disabled={busy || !remarkText.trim()}
              onClick={() => {
                const text = remarkText.trim();
                setRemarkText('');
                void guard(() => backendApi.addRemark(workspace.conversation.id, text));
              }}
            >
              Add
            </button>
          </div>
        </div>
      </details>

      <details className="detail-section">
        <summary>Reminders ({(workspace.reminders ?? []).filter((r) => r.status === 'PENDING').length})</summary>
        <div className="detail-section-body">
          {(workspace.reminders ?? []).map((reminder) => (
            <div key={reminder.id} className="reminder-item">
              <div>{reminder.text}</div>
              <div className="reminder-meta">Due {fmtDue(reminder.dueAt)} · {reminder.status}</div>
              {reminder.status === 'PENDING' && (
                <button className="btn" style={{ marginTop: 4 }} disabled={busy} onClick={() => void guard(() => backendApi.updateReminderStatus(reminder.id, 'COMPLETED'))}>
                  Mark done
                </button>
              )}
            </div>
          ))}
          <div className="mini-add" style={{ flexDirection: 'column', gap: 6 }}>
            <input placeholder="Reminder text…" value={reminderText} onChange={(e) => setReminderText(e.target.value)} />
            <input type="datetime-local" value={reminderDue} onChange={(e) => setReminderDue(e.target.value)} />
            <button
              disabled={busy || !reminderText.trim() || !reminderDue}
              onClick={() => {
                const text = reminderText.trim();
                const dueAt = new Date(reminderDue).toISOString();
                setReminderText('');
                setReminderDue('');
                void guard(() => backendApi.addReminder(workspace.conversation.id, text, dueAt));
              }}
            >
              Add reminder
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
