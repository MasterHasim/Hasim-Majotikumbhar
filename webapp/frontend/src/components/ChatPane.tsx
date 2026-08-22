import { useEffect, useRef, useState } from 'react';
import type { QuickReply, Template, Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Mirrors Phase6Api.isWithinCustomerServiceWindow (same no-fallback reasoning — see its comment)
 * — client-side only for UI (disabling free-form compose, showing the banner); the backend is
 * still the source of truth and rejects the send either way if this and the server disagree. */
function windowState(conversation: Workspace['conversation']): { inWindow: boolean; expiresAt: Date | null } {
  const anchorMs = conversation.lastCustomerMessageAt ? new Date(conversation.lastCustomerMessageAt).getTime() : NaN;
  if (Number.isNaN(anchorMs)) return { inWindow: false, expiresAt: null };
  const expiresAt = new Date(anchorMs + CUSTOMER_SERVICE_WINDOW_MS);
  return { inWindow: Date.now() < expiresAt.getTime(), expiresAt };
}

/** {{1}}, {{2}}, ... placeholders in a template's BODY component, in the same positional convention Phase6Api's substituteTemplateVariables expects. */
function templateVariableSlots(template: Template): string[] {
  const body = (template.components ?? []).find((c) => c.type === 'BODY');
  const matches = [...(body?.text ?? '').matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]!))].sort((a, b) => Number(a) - Number(b));
}

function mediaTypeForMime(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

/** FileReader's result for readAsDataURL is "data:<mime>;base64,<data>" — Phase6Api.uploadConversationMedia wants just the base64 payload. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function MediaAttachment({ media }: { media: NonNullable<Workspace['messages'][number]['media']> }) {
  if (media.mediaType === 'image') {
    return <img src={media.mediaUrl} alt={media.caption || 'attachment'} className="media-image" onClick={() => window.open(media.mediaUrl, '_blank')} />;
  }
  return (
    <a href={media.mediaUrl} target="_blank" rel="noreferrer" className="media-link">📎 {media.caption || media.mediaType}</a>
  );
}

export function ChatPane({ workspace, quickReplies, templates, onAfterSend, onResolve, onBack, onToggleDetail }: {
  workspace: Workspace;
  quickReplies: QuickReply[];
  templates: Template[];
  onAfterSend: () => void;
  onResolve: () => void;
  /** Mobile-only affordances (buttons stay hidden above the 900px breakpoint via CSS) —
   * back to the conversation list, and toggle the customer detail panel as an overlay. */
  onBack?: () => void;
  onToggleDetail?: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [mediaType, setMediaType] = useState('image');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [templateId, setTemplateId] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [workspace.messages.length]);

  function guard(fn: () => Promise<unknown>) {
    setSending(true);
    setError(null);
    return fn()
      .then(() => onAfterSend())
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)))
      .finally(() => setSending(false));
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    await guard(() => backendApi.sendReply(workspace.conversation.id, trimmed));
  }

  async function call() {
    if (calling) return;
    setCalling(true);
    setError(null);
    try {
      await backendApi.initiateConversationCall(workspace.conversation.id);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setCalling(false);
    }
  }

  async function handleFileChosen(file: File) {
    setUploading(true);
    setError(null);
    try {
      const base64Data = await readFileAsBase64(file);
      const { url } = await backendApi.uploadConversationMedia(workspace.conversation.id, base64Data, file.name, file.type || 'application/octet-stream');
      setMediaUrl(url);
      setMediaType(mediaTypeForMime(file.type || ''));
      setUploadedFileName(file.name);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const approvedTemplates = templates.filter((t) => t.status === 'APPROVED');
  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId);
  const customerName = workspace.customer?.name || workspace.customer?.phone || 'Unknown';
  const { inWindow, expiresAt } = windowState(workspace.conversation);

  return (
    <div id="chatCol" className="col">
      <div className="chat-header">
        <div className="chat-title-row">
          {onBack && <button className="chat-back-btn" aria-label="Back to conversations" onClick={onBack}>←</button>}
          <h2>{customerName}</h2>
          <span className={`pill status-${workspace.conversation.status}`}>{workspace.conversation.status}</span>
        </div>
        <div className="meta">
          {workspace.customer?.phone} · Assigned to {workspace.assignedUserName || 'nobody'}
        </div>
        <div className="chat-actions">
          {workspace.customer?.phone && (
            <button className="btn call" disabled={calling} onClick={() => void call()}>
              {calling ? 'Calling…' : '📞 Call'}
            </button>
          )}
          {workspace.conversation.status === 'OPEN' && (
            <button className="btn" onClick={onResolve}>Resolve</button>
          )}
          {onToggleDetail && <button className="chat-info-btn" aria-label="Customer details" onClick={onToggleDetail}>ℹ</button>}
        </div>
      </div>

      <div className="messages" ref={messagesRef}>
        {workspace.messages.length === 0 && <div className="empty">No messages yet.</div>}
        {workspace.messages.map((message) => (
          <div key={message.id} className={`message-row ${message.direction}`}>
            {message.direction === 'INBOUND' && <div className="msg-avatar">{customerName.charAt(0).toUpperCase()}</div>}
            <div className={`message ${message.direction}${message.status === 'FAILED' ? ' FAILED' : ''}`}>
              {message.senderName && message.direction === 'OUTBOUND' && <div className="sender">{message.senderName}</div>}
              {message.media && <MediaAttachment media={message.media} />}
              {message.messageText && <div className="text">{message.messageText}</div>}
              <div className="time">{timeLabel(message.timestamp)}{message.status === 'FAILED' ? ' · Failed to send' : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="compose-error">{error}</div>}
      {!inWindow && (
        <div className="compose-window-banner">
          It's been more than 24 hours since {customerName}'s last message{expiresAt ? ` (window closed ${expiresAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })})` : ''} — WhatsApp only allows an approved template to reopen the conversation. Free-text and media replies are disabled until they message again.
        </div>
      )}
      <div className="compose-body">
        <div className="compose-toolbar">
          <select
            value=""
            onChange={(e) => {
              const qr = quickReplies.find((q) => q.id === e.target.value);
              if (qr) setText((prev) => (prev ? `${prev} ${qr.text}` : qr.text));
            }}
          >
            <option value="">Quick reply…</option>
            {quickReplies.map((q) => <option key={q.id} value={q.id}>{q.shortcut}</option>)}
          </select>

          <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setTemplateVars({}); }}>
            <option value="">Template…</option>
            {approvedTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {selectedTemplate && templateVariableSlots(selectedTemplate).map((slot) => {
            const label = (selectedTemplate.variables ?? [])[Number(slot) - 1];
            return (
              <input
                key={slot}
                placeholder={label || `{{${slot}}}`}
                title={label ? `{{${slot}}} — ${label}` : `{{${slot}}} — no label set (Admin → Templates)`}
                style={{ width: label ? 130 : 90 }}
                value={templateVars[slot] ?? ''}
                onChange={(e) => setTemplateVars((prev) => ({ ...prev, [slot]: e.target.value }))}
              />
            );
          })}
          {selectedTemplate && (
            <button
              disabled={sending}
              onClick={() => {
                const id = templateId;
                const vars = templateVars;
                setTemplateId('');
                setTemplateVars({});
                void guard(() => backendApi.sendTemplateReply(workspace.conversation.id, id, vars));
              }}
            >
              Send template
            </button>
          )}

          <button disabled={!inWindow} title={inWindow ? undefined : "Outside the 24-hour window — send a template instead"} onClick={() => setShowMedia((v) => !v)}>📎 Media</button>
        </div>

        {showMedia && inWindow && (
          <div className="compose-toolbar">
            <select value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
              <option value="image">Image</option>
              <option value="document">Document</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
            <input
              placeholder="Media URL, or choose a file →"
              style={{ flex: 1, minWidth: 180 }}
              value={mediaUrl}
              onChange={(e) => { setMediaUrl(e.target.value); setUploadedFileName(''); }}
            />
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleFileChosen(file); }}
            />
            <button disabled={uploading || sending} onClick={() => fileInputRef.current?.click()}>
              {uploading ? 'Uploading…' : uploadedFileName ? `📁 ${uploadedFileName}` : '📁 Choose file'}
            </button>
            <input placeholder="Caption (optional)" style={{ maxWidth: 160 }} value={mediaCaption} onChange={(e) => setMediaCaption(e.target.value)} />
            <button
              disabled={sending || uploading || !mediaUrl.trim()}
              onClick={() => {
                const url = mediaUrl.trim();
                const caption = mediaCaption.trim();
                setMediaUrl('');
                setMediaCaption('');
                setUploadedFileName('');
                setShowMedia(false);
                void guard(() => backendApi.sendMediaReply(workspace.conversation.id, mediaType, url, caption));
              }}
            >
              Send media
            </button>
          </div>
        )}

        <div className="compose-row">
          <textarea
            rows={2}
            placeholder={inWindow ? 'Type a reply…' : 'Send a template to reopen this conversation'}
            disabled={!inWindow}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          />
          <button className="send" disabled={!inWindow || sending || !text.trim()} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
