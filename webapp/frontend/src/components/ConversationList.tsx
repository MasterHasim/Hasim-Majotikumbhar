import type { ConversationListItem } from '../types';

function timeLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

export function ConversationList({
  conversations, selectedId, search, onSearchChange, onSelect,
}: {
  conversations: ConversationListItem[];
  selectedId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (conversationId: string) => void;
}) {
  const filtered = search.trim()
    ? conversations.filter((c) => c.customerName.toLowerCase().includes(search.toLowerCase()) || c.customerPhone.includes(search))
    : conversations;

  return (
    <div id="convCol" className="col">
      <div className="col-header">Conversations</div>
      <div className="list-toolbar">
        <input type="text" placeholder="Search name or phone…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="empty">No conversations yet.</div>
      ) : (
        filtered.map((conversation) => (
          <button key={conversation.id} className={`conv-item${conversation.id === selectedId ? ' active' : ''}`} onClick={() => onSelect(conversation.id)}>
            <div className="conv-main">
              <div className="conv-title-row">
                <span className="conv-name">{conversation.customerName || conversation.customerPhone}</span>
                <span className="conv-time">{timeLabel(conversation.lastMessageAt)}</span>
              </div>
              <div className="conv-preview">{conversation.customerPhone}</div>
              {conversation.needsResponse && <span className="status-tag needs">Needs reply</span>}
              {!conversation.assignedUserId && <span className="status-tag unassigned">Unassigned</span>}
            </div>
          </button>
        ))
      )}
    </div>
  );
}
