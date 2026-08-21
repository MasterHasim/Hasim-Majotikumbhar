import { useEffect, useState } from 'react';
import { LEAD_LOCATIONS, type Lead, type LocationAssignmentConfig, type Stage, type User, type WhoAmI } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { LeadDetailModal } from './LeadDetailModal';
import { AssignmentRulesModal } from './AssignmentRulesModal';
import { LeadsBoard } from './LeadsBoard';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

function modeSummary(config: LocationAssignmentConfig | null | undefined): { label: string; tone: 'ok' | 'warn' | 'info' } {
  if (!config || !config.active) return { label: 'Not configured — new leads will sit unassigned', tone: 'warn' };
  if (config.mode === 'manual') return { label: 'Manual — assign each lead yourself', tone: 'info' };
  if (config.mode === 'single') return { label: 'Single agent', tone: 'ok' };
  return { label: 'Round-robin', tone: 'ok' };
}

/** Assignment-rule status per location, so uploading into an unconfigured location isn't
 * a silent surprise — Phase22Api.uploadLeads already auto-assigns per this same config,
 * this just makes that connection visible before you upload instead of after. */
function LocationAssignmentStatus({ configs, onConfigure }: { configs: Record<string, LocationAssignmentConfig | null> | null; onConfigure: (location: string) => void }) {
  if (!configs) return <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Checking assignment rules…</p>;
  const toneColor = { ok: 'var(--accent)', warn: 'var(--danger)', info: 'var(--text-secondary)' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {LEAD_LOCATIONS.map((loc) => {
        const { label, tone } = modeSummary(configs[loc]);
        return (
          <div key={loc} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: toneColor[tone], flexShrink: 0 }} />
            <span style={{ minWidth: 90, fontWeight: 600 }}>{loc}</span>
            <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
            <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => onConfigure(loc)}>Configure</button>
          </div>
        );
      })}
    </div>
  );
}

function UploadLeadsForm({ onDone, onConfigureLocation }: { onDone: () => void; onConfigureLocation: (location: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, LocationAssignmentConfig | null> | null>(null);

  function reloadConfigs() {
    Promise.all(LEAD_LOCATIONS.map((loc) => backendApi.getLocationAssignmentConfig(loc).then((c) => [loc, c] as const)))
      .then((pairs) => setConfigs(Object.fromEntries(pairs)))
      .catch(() => setConfigs({}));
  }
  useEffect(reloadConfigs, []);

  async function submit() {
    const rows = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, phone, location] = line.split(',').map((s) => s.trim());
      return { name: name ?? '', phone: phone ?? '', location: location ?? '' };
    });
    if (!rows.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await backendApi.uploadLeads(rows);
      setResult(`Created ${res.created}, skipped ${res.skipped} duplicates, ${res.errors.length} row error(s).`);
      if (res.errors.length) setError(res.errors.map((e) => `Row ${e.index + 1}: ${e.message}`).join('; '));
      setText('');
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onDone}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Upload leads</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>One lead per line: <code>Name, Phone, Location</code>. Locations must be one of: {LEAD_LOCATIONS.join(', ')}.</p>

        <h2 className="section-title" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)' }}>Assignment rule per location</h2>
        <LocationAssignmentStatus configs={configs} onConfigure={onConfigureLocation} />

        <textarea rows={8} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12 }} placeholder={'Priya Sharma, +919876543210, Raipur\nRavi Kumar, +919876543211, Alibaug'} value={text} onChange={(e) => setText(e.target.value)} />
        {result && <p style={{ fontSize: 12 }}>{result}</p>}
        {error && <div className="form-error">{error}</div>}
        <div className="form-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onDone}>Close</button>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}

export function Leads({ whoAmI, onOpenConversation }: { whoAmI: WhoAmI; onOpenConversation: (conversationId: string, numberId: string) => void }) {
  const isManager = whoAmI.roleKeys.includes('ADMIN') || whoAmI.roleKeys.includes('SITE_MANAGER');
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [rulesLocation, setRulesLocation] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'board'>('board');
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReassignTo, setBulkReassignTo] = useState('');
  const [bulkStageId, setBulkStageId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  function loadLeads() {
    backendApi.listLeads({ location: locationFilter || undefined, status: statusFilter || undefined })
      .then(setLeads)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }

  useEffect(loadLeads, [locationFilter, statusFilter]);
  useEffect(() => setSelectedIds(new Set()), [locationFilter, statusFilter, view]);
  useEffect(() => {
    backendApi.listStages().then(setStages).catch(() => setStages([]));
    if (isManager) backendApi.listUsers().then(setUsers).catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  /** Fires reassignLead/setLeadStage once per selected lead in parallel — bounded by how many
   * a person can realistically select in one go, not a page-load-scale N+1 concern. Reports
   * partial failures (e.g. a lead someone else already reassigned) instead of hiding them. */
  async function applyBulk(action: (leadId: string) => Promise<unknown>, label: string) {
    setBulkBusy(true);
    setError(null);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => action(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkBusy(false);
    setSelectedIds(new Set());
    setBulkReassignTo('');
    setBulkStageId('');
    loadLeads();
    if (failed > 0) setError(`${label}: ${ids.length - failed} of ${ids.length} succeeded, ${failed} failed.`);
  }

  return (
    <>
      <h1 className="page-title">Leads</h1>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}

      <div className="leads-toolbar">
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
          <option value="">All locations</option>
          {LEAD_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="UNASSIGNED">Unassigned</option>
          <option value="CALLED">Called</option>
        </select>
        {isManager && <button className="btn primary" onClick={() => setShowUpload(true)}>+ Upload leads</button>}
        {isManager && locationFilter && <button className="btn" onClick={() => setRulesLocation(locationFilter)}>Assignment rules for {locationFilter}</button>}
        <div className="view-toggle">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Board</button>
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
        </div>
      </div>

      {leads === null ? (
        <div className="empty">Loading…</div>
      ) : view === 'board' ? (
        leads.length === 0 ? (
          <div className="empty">No leads {locationFilter || statusFilter ? 'match this filter' : 'yet'}.</div>
        ) : (
          <LeadsBoard leads={leads} stages={stages} users={users} currentUserId={whoAmI.id} onOpenLead={setSelectedLead} onChanged={loadLeads} />
        )
      ) : (
        <>
          {isManager && selectedIds.size > 0 && (
            <div className="leads-toolbar" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>{selectedIds.size} selected</strong>
              <select value={bulkReassignTo} onChange={(e) => setBulkReassignTo(e.target.value)}>
                <option value="">Reassign to…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
              <button
                className="btn"
                disabled={bulkBusy || !bulkReassignTo}
                onClick={() => void applyBulk((id) => backendApi.reassignLead(id, bulkReassignTo), 'Reassign')}
              >
                Apply
              </button>
              <select value={bulkStageId} onChange={(e) => setBulkStageId(e.target.value)}>
                <option value="">Set stage…</option>
                {(stages ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                className="btn"
                disabled={bulkBusy || !bulkStageId}
                onClick={() => void applyBulk((id) => backendApi.setLeadStage(id, bulkStageId), 'Set stage')}
              >
                Apply
              </button>
              <button className="btn" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>Clear selection</button>
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                {isManager && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={leads.length > 0 && selectedIds.size === leads.length} onChange={() => toggleSelectAll(leads.map((l) => l.id))} />
                  </th>
                )}
                <th>Name</th><th>Phone</th><th>Location</th><th>Status</th><th>Assigned</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="clickable" onClick={() => setSelectedLead(lead)}>
                  {isManager && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} />
                    </td>
                  )}
                  <td>{lead.name}</td>
                  <td>{lead.phone}</td>
                  <td>{lead.location}</td>
                  <td><span className={`lead-status-tag ${lead.status}`}>{lead.status}</span></td>
                  <td>{lead.assignedUserId ? (users.find((u) => u.id === lead.assignedUserId)?.displayName ?? (lead.assignedUserId === whoAmI.id ? whoAmI.displayName : lead.assignedUserId)) : '—'}</td>
                  <td>{fmt(lead.createdAt)}</td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={isManager ? 7 : 6} className="empty">No leads {locationFilter || statusFilter ? 'match this filter' : 'yet'}.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {showUpload && <UploadLeadsForm onDone={() => { setShowUpload(false); loadLeads(); }} onConfigureLocation={(loc) => { setShowUpload(false); setRulesLocation(loc); }} />}
      {rulesLocation && <AssignmentRulesModal location={rulesLocation} users={users} onClose={() => setRulesLocation(null)} />}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          stages={stages ?? []}
          isManager={isManager}
          currentUserId={whoAmI.id}
          managers={users}
          onClose={() => setSelectedLead(null)}
          onChanged={loadLeads}
          onOpenConversation={onOpenConversation}
        />
      )}
    </>
  );
}
