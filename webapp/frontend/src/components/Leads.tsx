import { useEffect, useState } from 'react';
import { LEAD_LOCATIONS, type Lead, type Stage, type User, type WhoAmI } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { LeadDetailModal } from './LeadDetailModal';
import { AssignmentRulesModal } from './AssignmentRulesModal';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function UploadLeadsForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onDone}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Upload leads</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>One lead per line: <code>Name, Phone, Location</code>. Locations must be one of: {LEAD_LOCATIONS.join(', ')}.</p>
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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [rulesLocation, setRulesLocation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadLeads() {
    backendApi.listLeads({ location: locationFilter || undefined, status: statusFilter || undefined })
      .then(setLeads)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }

  useEffect(loadLeads, [locationFilter, statusFilter]);
  useEffect(() => {
    backendApi.listStages().then(setStages).catch(() => setStages([]));
    if (isManager) backendApi.listUsers().then(setUsers).catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

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
      </div>

      <table className="data-table">
        <thead><tr><th>Name</th><th>Phone</th><th>Location</th><th>Status</th><th>Assigned</th><th>Created</th></tr></thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="clickable" onClick={() => setSelectedLead(lead)}>
              <td>{lead.name}</td>
              <td>{lead.phone}</td>
              <td>{lead.location}</td>
              <td><span className={`lead-status-tag ${lead.status}`}>{lead.status}</span></td>
              <td>{lead.assignedUserId ? (users.find((u) => u.id === lead.assignedUserId)?.displayName ?? (lead.assignedUserId === whoAmI.id ? whoAmI.displayName : lead.assignedUserId)) : '—'}</td>
              <td>{fmt(lead.createdAt)}</td>
            </tr>
          ))}
          {leads.length === 0 && <tr><td colSpan={6} className="empty">No leads {locationFilter || statusFilter ? 'match this filter' : 'yet'}.</td></tr>}
        </tbody>
      </table>

      {showUpload && <UploadLeadsForm onDone={() => { setShowUpload(false); loadLeads(); }} />}
      {rulesLocation && <AssignmentRulesModal location={rulesLocation} users={users} onClose={() => setRulesLocation(null)} />}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          stages={stages}
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
