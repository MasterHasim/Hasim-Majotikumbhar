import { useState } from 'react';
import type { Lead, Stage, User } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

/** Column accent by stage key — falls back to the neutral "call" blue for any
 * custom stage a team adds beyond the seeded six, so this never looks broken. */
function accentForStage(key: string): string {
  if (key === 'lead_won' || key === 'won') return 'var(--accent)';
  if (key === 'lead_lost' || key === 'lost') return 'var(--danger)';
  if (key === 'not_interested') return 'var(--warning)';
  return 'var(--call)';
}

function LeadCard({ lead, users, currentUserId, isManager, busy, dragging, onOpen, onDragStart, onDragEnd, onCall, onWhatsApp }: {
  lead: Lead;
  users: User[];
  currentUserId: string;
  isManager: boolean;
  busy: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onCall: () => void;
  onWhatsApp: () => void;
}) {
  const assigneeName = lead.assignedUserId
    ? (users.find((u) => u.id === lead.assignedUserId)?.displayName ?? (lead.assignedUserId === currentUserId ? 'You' : lead.assignedUserId))
    : null;
  const canTouch = isManager || lead.assignedUserId === currentUserId;
  return (
    <div
      className="kanban-card"
      draggable
      style={{ opacity: dragging ? 0.4 : 1 }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="kanban-card-name">{lead.name}</div>
      <div className="kanban-card-phone">{lead.phone}</div>
      <div className="kanban-card-meta">
        <span>📍 {lead.location}</span>
        <span>{assigneeName ? `👤 ${assigneeName}` : 'Unassigned'}</span>
      </div>
      {lead.tags && lead.tags.length > 0 && (
        <div className="tag-row" style={{ marginTop: 6 }}>
          {lead.tags.slice(0, 3).map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
          {lead.tags.length > 3 && <span className="tag-chip-more">+{lead.tags.length - 3}</span>}
        </div>
      )}
      {canTouch && (
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <button className="btn call" style={{ padding: '3px 8px' }} disabled={busy} title="Call" onClick={(e) => { e.stopPropagation(); onCall(); }}>📞</button>
          <button className="btn" style={{ padding: '3px 8px' }} disabled={busy} title="Send WhatsApp" onClick={(e) => { e.stopPropagation(); onWhatsApp(); }}>💬</button>
        </div>
      )}
    </div>
  );
}

export function LeadsBoard({ leads, stages, users, currentUserId, isManager, actionBusyId, onOpenLead, onChanged, onCall, onWhatsApp }: {
  leads: Lead[];
  /** null = stages haven't loaded yet — kept distinct from [] so the board doesn't
   * flash "no stages configured" while the (separate, parallel) stages fetch is still in flight. */
  stages: Stage[] | null;
  users: User[];
  currentUserId: string;
  isManager: boolean;
  actionBusyId: string | null;
  onOpenLead: (lead: Lead) => void;
  onChanged: () => void;
  onCall: (lead: Lead) => void;
  onWhatsApp: (lead: Lead) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (stages === null) return <div className="empty">Loading…</div>;

  const activeStages = [...stages].filter((s) => s.active).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const unstaged = leads.filter((l) => !l.stageId || !activeStages.some((s) => s.id === l.stageId));

  async function moveTo(leadId: string, stageId: string) {
    setError(null);
    try {
      await backendApi.setLeadStage(leadId, stageId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <div>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}
      <div className="kanban-board">
        {unstaged.length > 0 && (
          <div className="kanban-column">
            <div className="kanban-column-header" style={{ borderTopColor: 'var(--text-muted)' }}>
              <span>No stage</span>
              <span className="kanban-count">{unstaged.length}</span>
            </div>
            <div className="kanban-column-body">
              {unstaged.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  users={users}
                  currentUserId={currentUserId}
                  isManager={isManager}
                  busy={actionBusyId === lead.id}
                  dragging={draggingId === lead.id}
                  onOpen={() => onOpenLead(lead)}
                  onDragStart={() => setDraggingId(lead.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onCall={() => onCall(lead)}
                  onWhatsApp={() => onWhatsApp(lead)}
                />
              ))}
            </div>
          </div>
        )}

        {activeStages.map((stage) => {
          const columnLeads = leads.filter((l) => l.stageId === stage.id);
          return (
            <div
              key={stage.id}
              className={`kanban-column${dragOverStageId === stage.id ? ' drag-over' : ''}`}
              onDragOver={(e) => { if (draggingId) { e.preventDefault(); setDragOverStageId(stage.id); } }}
              onDragLeave={() => setDragOverStageId((v) => (v === stage.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStageId(null);
                const leadId = draggingId;
                setDraggingId(null);
                if (leadId) void moveTo(leadId, stage.id);
              }}
            >
              <div className="kanban-column-header" style={{ borderTopColor: accentForStage(stage.key) }}>
                <span>{stage.name}</span>
                <span className="kanban-count">{columnLeads.length}</span>
              </div>
              <div className="kanban-column-body">
                {columnLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    users={users}
                    currentUserId={currentUserId}
                    isManager={isManager}
                    busy={actionBusyId === lead.id}
                    dragging={draggingId === lead.id}
                    onOpen={() => onOpenLead(lead)}
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onCall={() => onCall(lead)}
                    onWhatsApp={() => onWhatsApp(lead)}
                  />
                ))}
                {columnLeads.length === 0 && <div className="kanban-empty">Drop a lead here</div>}
              </div>
            </div>
          );
        })}

        {activeStages.length === 0 && (
          <div className="empty">No lead stages are configured yet — an ADMIN can add them under Admin → Lead Stages.</div>
        )}
      </div>
    </div>
  );
}
