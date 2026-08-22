import { useEffect, useMemo, useState } from 'react';
import { LEAD_LOCATIONS, type CallLogWithContext, type User } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** YYYY-MM-DD in the caller's local time zone, to match what a <input type="date"> produces —
 * a plain .toISOString().slice(0,10) would drift a day for anyone east of UTC in the evening. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CallHistory({ isManager, onOpenConversation }: {
  isManager: boolean;
  onOpenConversation: (conversationId: string, numberId: string) => void;
}) {
  const [calls, setCalls] = useState<CallLogWithContext[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  function refreshStatus(callId: string) {
    setRefreshingId(callId);
    backendApi.refreshCallStatus(callId)
      .then((updated) => setCalls((prev) => prev && prev.map((c) => (c.id === callId ? { ...c, status: updated.status } : c))))
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)))
      .finally(() => setRefreshingId(null));
  }

  useEffect(() => {
    backendApi.listCallHistory()
      .then(setCalls)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
    if (isManager) backendApi.listUsers().then(setUsers).catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  const filtered = useMemo(() => {
    return (calls ?? []).filter((call) => {
      if (locationFilter && call.subjectLocation !== locationFilter) return false;
      if (agentFilter && call.agentUserId !== agentFilter) return false;
      const dateKey = localDateKey(call.initiatedAt);
      if (dateFrom && dateKey < dateFrom) return false;
      if (dateTo && dateKey > dateTo) return false;
      return true;
    });
  }, [calls, locationFilter, agentFilter, dateFrom, dateTo]);

  const hasFilter = locationFilter || agentFilter || dateFrom || dateTo;

  return (
    <>
      <h1 className="page-title">Call History</h1>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 14 }}>
        {isManager ? 'Every call placed across your team, newest first.' : 'Calls you’ve placed, newest first.'}
      </p>

      <div className="leads-toolbar">
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
          <option value="">All locations</option>
          {LEAD_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        {isManager && (
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
            <option value="">All agents</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {hasFilter && <button className="btn" onClick={() => { setLocationFilter(''); setAgentFilter(''); setDateFrom(''); setDateTo(''); }}>Clear filters</button>}
      </div>

      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}

      {calls === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                {isManager && <th>Agent</th>}
                <th>To</th>
                <th>Phone</th>
                <th>Via</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((call) => (
                <tr key={call.id}>
                  <td>{fmt(call.initiatedAt)}</td>
                  {isManager && <td>{call.agentName}</td>}
                  <td>{call.subjectName}{call.subjectLocation ? ` (${call.subjectLocation})` : ''}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{call.leadPhone}</td>
                  <td>{call.leadId ? 'Lead' : 'Chat'}</td>
                  <td>
                    <span className={`lead-status-tag ${call.status === 'INITIATED' ? 'CALLED' : call.status}`}>{call.status}</span>
                    <button
                      className="btn"
                      style={{ marginLeft: 6, padding: '1px 6px', fontSize: 10 }}
                      disabled={refreshingId === call.id}
                      title="Fetch the call's current status from Exotel"
                      onClick={() => refreshStatus(call.id)}
                    >
                      {refreshingId === call.id ? '…' : '↻'}
                    </button>
                  </td>
                  <td>
                    {call.conversationId && call.numberId && (
                      <button className="btn" onClick={() => onOpenConversation(call.conversationId!, call.numberId!)}>Open chat</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={isManager ? 7 : 6} className="empty">{calls.length === 0 ? 'No calls placed yet.' : 'No calls match this filter.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
