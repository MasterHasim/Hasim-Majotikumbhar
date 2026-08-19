import type { ConversationListItem } from '../types';

export interface ListFilters {
  status: '' | 'OPEN' | 'CLOSED' | 'ANY';
  needsResponse: boolean;
  unassigned: boolean;
}

export const DEFAULT_FILTERS: ListFilters = { status: '', needsResponse: false, unassigned: false };

function timeLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

export function ConversationList({
  conversations, selectedId, search, filters, onSearchChange, onFiltersChange, onSelect,
}: {
  conversations: ConversationListItem[];
  selectedId: string | null;
  search: string;
  filters: ListFilters;
  onSearchChange: (value: string) => void;
  onFiltersChange: (filters: ListFilters) => void;
  onSelect: (conversationId: string) => void;
}) {
  return (
    <div id="convCol" className="col">
      <div className="col-header">Conversations</div>
      <div className="list-toolbar">
        <input type="text" placeholder="Search name, phone, or message…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as ListFilters['status'] })} style={{ flex: '1 1 auto' }}>
            <option value="">Open (default)</option>
            <option value="CLOSED">Resolved</option>
            <option value="ANY">Any status</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 12 }}>
          <label className="inline"><input type="checkbox" checked={filters.needsResponse} onChange={(e) => onFiltersChange({ ...filters, needsResponse: e.target.checked })} /> Needs reply</label>
          <label className="inline"><input type="checkbox" checked={filters.unassigned} onChange={(e) => onFiltersChange({ ...filters, unassigned: e.target.checked })} /> Unassigned</label>
        </div>
      </div>
      {conversations.length === 0 ? (
        <div className="empty">No conversations {search || filters.status || filters.needsResponse || filters.unassigned ? 'match this filter' : 'yet'}.</div>
      ) : (
        conversations.map((conversation) => (
          <button key={conversation.id} className={`conv-item${conversation.id === selectedId ? ' active' : ''}`} onClick={() => onSelect(conversation.id)}>
            <div className="conv-main">
              <div className="conv-title-row">
                <span className="conv-name">{conversation.customerName || conversation.customerPhone}</span>
                <span className="conv-time">{timeLabel(conversation.lastMessageAt)}</span>
              </div>
              <div className="conv-preview">{conversation.customerPhone}</div>
              {conversation.needsResponse && <span className="status-tag needs">Needs reply</span>}
              {!conversation.assignedUserId && <span className="status-tag unassigned">Unassigned</span>}
              {conversation.status === 'CLOSED' && <span className="status-tag closed">Resolved</span>}
            </div>
          </button>
        ))
      )}
    </div>
  );
}
