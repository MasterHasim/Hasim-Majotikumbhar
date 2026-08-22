import { useEffect, useState } from 'react';
import type { AuditEntryWithActor, Lead, Stage, User } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { ActivityFeed } from './ActivityFeed';
import { CustomFieldsSection } from './CustomFieldsSection';
import { QuotationBuilder } from './QuotationBuilder';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function LeadDetailModal({
  lead, stages, isManager, currentUserId, managers, allTags, onClose, onChanged, onOpenConversation,
}: {
  lead: Lead;
  stages: Stage[];
  isManager: boolean;
  currentUserId: string;
  managers: User[];
  /** Tags already in use across other leads, offered as <datalist> suggestions so wording stays consistent (e.g. everyone writes "Hot", not a mix of "hot"/"Hot lead"). */
  allTags: string[];
  onClose: () => void;
  onChanged: () => void;
  onOpenConversation: (conversationId: string, numberId: string) => void;
}) {
  const [stageId, setStageId] = useState('');
  const [remarks, setRemarks] = useState<{ id: string; text: string; createdAt: string }[]>([]);
  const [remarkText, setRemarkText] = useState('');
  const [tags, setTags] = useState<string[]>(lead.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [activity, setActivity] = useState<AuditEntryWithActor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canTouch = isManager || lead.assignedUserId === currentUserId;

  useEffect(() => {
    backendApi.getLeadStage(lead.id).then((s) => setStageId(s?.stageId ?? '')).catch(() => setStageId(''));
    backendApi.listLeadRemarks(lead.id).then(setRemarks).catch(() => setRemarks([]));
    setActivity(null);
    backendApi.listLeadActivity(lead.id).then(setActivity).catch(() => setActivity([]));
    setTags(lead.tags ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  function saveTags(next: string[]) {
    setTags(next);
    void guard(async () => { await backendApi.updateLeadTags(lead.id, next); onChanged(); });
  }

  function addTag() {
    const value = tagInput.trim();
    setTagInput('');
    if (!value || tags.some((t) => t.toLowerCase() === value.toLowerCase())) return;
    saveTags([...tags, value]);
  }

  function removeTag(tag: string) {
    saveTags(tags.filter((t) => t !== tag));
  }

  function guard<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    return fn().catch((err) => { setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)); return undefined; }).finally(() => setBusy(false));
  }

  async function handleCall() {
    await guard(async () => {
      await backendApi.initiateLeadCall(lead.id);
      onChanged();
    });
  }

  async function handleWhatsApp() {
    await guard(async () => {
      const result = await backendApi.startWhatsAppFromLead(lead.id);
      onOpenConversation(result.conversationId, result.numberId);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {canTouch ? (
          <input
            className="section-title"
            style={{ marginTop: 0, marginBottom: 4, width: '100%', border: 'none', background: 'transparent', padding: 0 }}
            defaultValue={lead.name}
            disabled={busy}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lead.name) void guard(async () => { await backendApi.updateLeadDetails(lead.id, { name: v }); onChanged(); }); else e.target.value = lead.name; }}
          />
        ) : (
          <h2 className="section-title" style={{ marginTop: 0 }}>{lead.name}</h2>
        )}
        <div className="cust-fields" style={{ padding: 0, border: 'none', marginBottom: 10 }}>
          <div className="field-row">
            <span className="field-label">Phone</span>
            {canTouch ? (
              <input
                className="field-value"
                defaultValue={lead.phone}
                disabled={busy}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== lead.phone) void guard(async () => { await backendApi.updateLeadDetails(lead.id, { phone: v }); onChanged(); }); else e.target.value = lead.phone; }}
              />
            ) : (
              <span className="field-value">{lead.phone}</span>
            )}
          </div>
          <div className="field-row"><span className="field-label">Location</span><span className="field-value">{lead.location}</span></div>
          <div className="field-row"><span className="field-label">Status</span><span className={`lead-status-tag ${lead.status}`}>{lead.status}</span></div>
          {isManager && (
            <div className="field-row">
              <span className="field-label">Assigned</span>
              <select
                className="field-value"
                disabled={busy}
                value={lead.assignedUserId || ''}
                onChange={(e) => { if (e.target.value) void guard(async () => { await backendApi.reassignLead(lead.id, e.target.value); onChanged(); }); }}
              >
                <option value="">Unassigned</option>
                {managers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Tags</span>
          <div className="tag-row">
            {tags.length === 0 && <span className="tag-chip-more">No tags yet.</span>}
            {tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
                {canTouch && <button className="tag-chip-remove" disabled={busy} aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)}>✕</button>}
              </span>
            ))}
          </div>
          {canTouch && (
            <div className="tag-add-row">
              <input
                list="lead-tag-suggestions"
                placeholder="Add a tag (e.g. Hot, Budget constrained)…"
                disabled={busy}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              />
              <datalist id="lead-tag-suggestions">
                {allTags.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}
              </datalist>
              <button className="btn" disabled={busy || !tagInput.trim()} onClick={addTag}>Add</button>
            </div>
          )}
        </div>

        {canTouch && (
          <div className="form-row">
            <select value={stageId} disabled={busy} onChange={(e) => { setStageId(e.target.value); if (e.target.value) void guard(async () => { await backendApi.setLeadStage(lead.id, e.target.value); onChanged(); }); }}>
              <option value="">Stage…</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <CustomFieldsSection
          entityType="lead"
          entityId={lead.id}
          values={lead.customFields}
          editable={canTouch}
          busy={busy}
          onSave={(key, value) => void guard(async () => { await backendApi.updateLeadCustomFields(lead.id, { [key]: value }); onChanged(); })}
        />

        {canTouch && (
          <div className="form-row">
            <button className="btn primary" disabled={busy} onClick={() => void handleCall()}>📞 Call</button>
            <button className="btn primary" disabled={busy} onClick={() => void handleWhatsApp()}>💬 Send WhatsApp</button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {canTouch && (
          <>
            <h2 className="section-title">Comments</h2>
            {remarks.length === 0 ? <div className="empty">No comments yet.</div> : remarks.map((r) => (
              <div key={r.id} className="lead-remark-item">
                <div>{r.text}</div>
                <div className="lead-remark-meta">{fmt(r.createdAt)}</div>
              </div>
            ))}
            <div className="form-row">
              <textarea rows={2} style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Add a comment…" value={remarkText} onChange={(e) => setRemarkText(e.target.value)} />
            </div>
            <div className="form-row" style={{ justifyContent: 'space-between' }}>
              <button
                className="btn primary"
                disabled={busy || !remarkText.trim()}
                onClick={() => {
                  const text = remarkText.trim();
                  setRemarkText('');
                  void guard(async () => { const r = await backendApi.addLeadRemark(lead.id, text); setRemarks((prev) => [...prev, r]); });
                }}
              >
                Add comment
              </button>
              <button className="btn" onClick={onClose}>Close</button>
            </div>

            <details className="detail-section">
              <summary>Quotations</summary>
              <div className="detail-section-body">
                <QuotationBuilder lead={lead} onOpenConversation={onOpenConversation} />
              </div>
            </details>

            <details className="detail-section">
              <summary>Activity ({activity?.length ?? 0})</summary>
              <div className="detail-section-body">
                <ActivityFeed entries={activity} />
              </div>
            </details>
          </>
        )}
        {!canTouch && (
          <div className="form-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
