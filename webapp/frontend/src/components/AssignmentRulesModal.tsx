import { useEffect, useState } from 'react';
import type { LocationAssignmentConfig, LocationAssignmentUser, User } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

export function AssignmentRulesModal({ location, users, onClose }: { location: string; users: User[]; onClose: () => void }) {
  const [config, setConfig] = useState<LocationAssignmentConfig | null>(null);
  const [participants, setParticipants] = useState<LocationAssignmentUser[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [phoneEdits, setPhoneEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.getLocationAssignmentConfig(location).then(setConfig).catch(() => setConfig(null));
    backendApi.listLocationAssignmentParticipants(location).then(setParticipants).catch(() => setParticipants([]));
  }

  useEffect(reload, [location]);

  function guard<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    return fn().then(() => reload()).catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err))).finally(() => setBusy(false));
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;
  const availableUsers = users.filter((u) => !participants.some((p) => p.userId === u.id));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Assignment rules — {location}</h2>

        <div className="form-row">
          <label className="inline">
            Mode:
            <select
              disabled={busy}
              value={config?.mode ?? 'manual'}
              onChange={(e) => void guard(() => backendApi.setLocationAssignmentConfig(location, { mode: e.target.value }))}
            >
              <option value="manual">Manual</option>
              <option value="single">Single agent</option>
              <option value="round_robin">Round robin</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={config?.active ?? true} disabled={busy} onChange={(e) => void guard(() => backendApi.setLocationAssignmentConfig(location, { active: e.target.checked }))} />
            Active
          </label>
        </div>

        {config?.mode === 'single' && (
          <div className="form-row">
            <label className="inline">
              Fixed agent:
              <select disabled={busy} value={config?.singleUserId ?? ''} onChange={(e) => void guard(() => backendApi.setLocationAssignmentConfig(location, { singleUserId: e.target.value }))}>
                <option value="">Choose…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="form-row">
          <label className="inline" style={{ flex: 1 }}>
            Caller ID (optional):
            <input
              placeholder="e.g. 079-485-02804"
              defaultValue={config?.callerId ?? ''}
              onBlur={(e) => { if (e.target.value !== (config?.callerId ?? '')) void guard(() => backendApi.setLocationAssignmentConfig(location, { callerId: e.target.value })); }}
            />
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <h2 className="section-title">Round-robin participants (in order)</h2>
        <table className="data-table">
          <thead><tr><th>Agent</th><th>Phone</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {participants.sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((p) => {
              const user = users.find((u) => u.id === p.userId);
              return (
                <tr key={p.id}>
                  <td>{userName(p.userId)}</td>
                  <td>
                    <div className="mini-add">
                      <input
                        placeholder="Phone (needed for calls)"
                        value={phoneEdits[p.userId] ?? user?.phone ?? ''}
                        onChange={(e) => setPhoneEdits((prev) => ({ ...prev, [p.userId]: e.target.value }))}
                      />
                      <button disabled={busy} onClick={() => void guard(() => backendApi.setUserPhone(p.userId, phoneEdits[p.userId] ?? ''))}>Save</button>
                    </div>
                  </td>
                  <td>
                    <input type="checkbox" checked={p.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateLocationAssignmentParticipant(p.id, { active: e.target.checked }))} />
                  </td>
                  <td>
                    <button className="btn" disabled={busy} onClick={() => void guard(() => backendApi.updateLocationAssignmentParticipant(p.id, { active: false }))}>Remove</button>
                  </td>
                </tr>
              );
            })}
            {participants.length === 0 && <tr><td colSpan={4} className="empty">No participants yet.</td></tr>}
          </tbody>
        </table>

        <div className="form-row">
          <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)}>
            <option value="">Add agent…</option>
            {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
          <button
            className="btn primary"
            disabled={busy || !newUserId}
            onClick={() => {
              const userId = newUserId;
              setNewUserId('');
              void guard(() => backendApi.addLocationAssignmentParticipant(location, userId, participants.length + 1));
            }}
          >
            Add
          </button>
        </div>

        <div className="form-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
