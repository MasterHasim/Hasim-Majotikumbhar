import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationListItem, Stage, WhatsAppNumber, Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { connectRealtimeMessages } from '../lib/realtime';
import { ConversationList } from './ConversationList';
import { ChatPane } from './ChatPane';
import { DetailPanel } from './DetailPanel';

/** Conversation-list refresh — realtime (lib/realtime.ts) only covers the currently
 * open conversation's own messages, same scope the Apps Script build's listener has;
 * other conversations' previews/badges still need a periodic refresh. Relaxed from
 * the old 4s blind-poll interval now that the open chat itself updates instantly. */
const LIST_POLL_MS = 8000;
/** Safety-net refetch of the open workspace, in case the EventSource silently drops
 * without firing onerror — cheap insurance, not the primary update path anymore. */
const WORKSPACE_SAFETY_POLL_MS = 20000;

export function Inbox({ number }: { number: WhatsAppNumber }) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const stopRealtimeRef = useRef<(() => void) | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await backendApi.listConversations(number.id));
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [number.id]);

  const loadWorkspace = useCallback(async (conversationId: string, includeRealtime = false) => {
    try {
      const ws = await backendApi.getWorkspace(conversationId, includeRealtime);
      setWorkspace(ws);
      return ws;
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setWorkspace(null);
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    void loadConversations();
    backendApi.listStages().then(setStages).catch(() => setStages([]));
  }, [number.id, loadConversations]);

  useEffect(() => {
    const interval = setInterval(() => void loadConversations(), LIST_POLL_MS);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (selectedIdRef.current) void loadWorkspace(selectedIdRef.current);
    }, WORKSPACE_SAFETY_POLL_MS);
    return () => clearInterval(interval);
  }, [loadWorkspace]);

  // Stop the realtime connection on unmount (switching conversations is handled in selectConversation itself).
  useEffect(() => () => stopRealtimeRef.current?.(), []);

  async function selectConversation(conversation: ConversationListItem) {
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    setSelectedId(conversation.id);
    const ws = await loadWorkspace(conversation.id, true);
    if (ws?.realtime && selectedIdRef.current === conversation.id) {
      stopRealtimeRef.current = connectRealtimeMessages(ws.realtime, conversation.id, () => {
        void loadWorkspace(conversation.id);
        void loadConversations();
      });
    }
  }

  async function handleResolve() {
    if (!selectedId) return;
    try {
      await backendApi.resolveConversation(selectedId);
      await Promise.all([loadWorkspace(selectedId), loadConversations()]);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  function handleChanged() {
    if (selectedId) void loadWorkspace(selectedId);
    void loadConversations();
  }

  return (
    <>
      <h1 className="page-title" style={{ margin: '0 0 12px' }}>Inbox</h1>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}
      <div className={`split${workspace ? '' : ' no-detail'}`}>
        <ConversationList conversations={conversations} selectedId={selectedId} search={search} onSearchChange={setSearch} onSelect={(c) => void selectConversation(c)} />
        {workspace ? (
          <>
            <ChatPane workspace={workspace} onAfterSend={handleChanged} onResolve={() => void handleResolve()} />
            <DetailPanel workspace={workspace} stages={stages} onChanged={handleChanged} />
          </>
        ) : (
          <div className="centered-message">Select a conversation to view it here.</div>
        )}
      </div>
    </>
  );
}
