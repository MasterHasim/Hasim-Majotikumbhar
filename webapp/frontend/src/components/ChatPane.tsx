import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPane({ workspace, onAfterSend, onResolve }: { workspace: Workspace; onAfterSend: () => void; onResolve: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [workspace.messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await backendApi.sendReply(workspace.conversation.id, trimmed);
      setText('');
      onAfterSend();
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setSending(false);
    }
  }

  const customerName = workspace.customer?.name || workspace.customer?.phone || 'Unknown';

  return (
    <div id="chatCol" className="col">
      <div className="chat-header">
        <div className="chat-title-row">
          <h2>{customerName}</h2>
          <span className={`pill status-${workspace.conversation.status}`}>{workspace.conversation.status}</span>
        </div>
        <div className="meta">
          {workspace.customer?.phone} · Assigned to {workspace.assignedUserName || 'nobody'}
        </div>
        <div className="chat-actions">
          {workspace.conversation.status === 'OPEN' && (
            <button className="btn" onClick={onResolve}>Resolve</button>
          )}
        </div>
      </div>

      <div className="messages" ref={messagesRef}>
        {workspace.messages.length === 0 && <div className="empty">No messages yet.</div>}
        {workspace.messages.map((message) => (
          <div key={message.id} className={`message-row ${message.direction}`}>
            {message.direction === 'INBOUND' && <div className="msg-avatar">{customerName.charAt(0).toUpperCase()}</div>}
            <div className={`message ${message.direction}${message.status === 'FAILED' ? ' FAILED' : ''}`}>
              {message.senderName && message.direction === 'OUTBOUND' && <div className="sender">{message.senderName}</div>}
              <div className="text">{message.messageText}</div>
              <div className="time">{timeLabel(message.timestamp)}{message.status === 'FAILED' ? ' · Failed to send' : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="compose-error">{error}</div>}
      <div className="compose-body">
        <div className="compose-row">
          <textarea
            rows={2}
            placeholder="Type a reply…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          />
          <button className="send" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
