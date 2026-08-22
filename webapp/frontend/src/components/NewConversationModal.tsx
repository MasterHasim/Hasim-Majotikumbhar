import { useState } from 'react';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

/** "Message or call a number that isn't a Lead or Customer yet" — creates the Customer +
 * Conversation via Phase6Api.startNewConversation, then hands off to the normal Inbox/ChatPane
 * (24h-window-aware compose, existing Call button) rather than building a parallel send flow. */
export function NewConversationModal({ numberId, onClose, onCreated }: {
  numberId: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!phone.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await backendApi.startNewConversation(numberId, phone.trim(), name.trim());
      onCreated(result.conversationId);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title" style={{ marginTop: 0 }}>New conversation</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Message or call a phone number that isn't a Lead or Customer yet. Since WhatsApp has
          never heard from this number before, the first message must be an approved template —
          you'll be prompted for one once the chat opens.
        </p>
        <div className="form-row">
          <input
            placeholder="Phone number (e.g. +919876543210)"
            style={{ flex: 1 }}
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }}
          />
        </div>
        <div className="form-row">
          <input
            placeholder="Name (optional)"
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !phone.trim()} onClick={() => void create()}>{busy ? 'Starting…' : 'Start chat'}</button>
        </div>
      </div>
    </div>
  );
}
