import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationListItem, Stage, WhatsAppNumber, Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { ConversationList } from './ConversationList';
import { ChatPane } from './ChatPane';
import { DetailPanel } from './DetailPanel';

/** Polling interval for the conversation list and open workspace — a pragmatic stand-in
 * for the real Firebase realtime listener (RealtimeListenApi already exists on the
 * backend); wiring an actual live subscription is a deliberate fast-follow once this
 * page's core flow is confirmed working, not skipped by accident. */
const POLL_MS = 4000;

export function Inbox({ number }: { number: WhatsAppNumber }) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await backendApi.listConversations(number.id));
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [number.id]);

  const loadWorkspace = useCallback(async (conversationId: string) => {
    try {
      setWorkspace(await backendApi.getWorkspace(conversationId));
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setWorkspace(null);
    void loadConversations();
    backendApi.listStages().then(setStages).catch(() => setStages([]));
  }, [number.id, loadConversations]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadConversations();
      if (selectedIdRef.current) void loadWorkspace(selectedIdRef.current);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [loadConversations, loadWorkspace]);

  function selectConversation(conversation: ConversationListItem) {
    setSelectedId(conversation.id);
    void loadWorkspace(conversation.id);
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
        <ConversationList conversations={conversations} selectedId={selectedId} search={search} onSearchChange={setSearch} onSelect={selectConversation} />
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
