import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationListItem, QuickReply, Stage, Template, WhatsAppNumber, Workspace } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { connectRealtimeMessages } from '../lib/realtime';
import { ConversationList, DEFAULT_FILTERS, type ListFilters } from './ConversationList';
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

export function Inbox({ number, initialConversationId, onInitialConversationConsumed }: {
  number: WhatsAppNumber;
  /** Set by App.tsx when Leads.tsx's "Send WhatsApp" bridges here — auto-opens that conversation once. */
  initialConversationId?: string | null;
  onInitialConversationConsumed?: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [error, setError] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const stopRealtimeRef = useRef<(() => void) | null>(null);

  const isFiltering = !!search.trim() || !!filters.status || filters.needsResponse || filters.unassigned;

  const loadConversations = useCallback(async () => {
    try {
      if (isFiltering) {
        setConversations(await backendApi.searchConversations({
          numberId: number.id, query: search.trim() || undefined, status: filters.status || undefined,
          needsResponse: filters.needsResponse || undefined, unassigned: filters.unassigned || undefined,
        }));
      } else {
        setConversations(await backendApi.listConversations(number.id));
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [number.id, isFiltering, search, filters]);

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

  // Number switch: reset selection/filters and reload everything number-scoped.
  useEffect(() => {
    setSelectedId(null);
    setWorkspace(null);
    setSearch('');
    setFilters(DEFAULT_FILTERS);
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    backendApi.listStages().then(setStages).catch(() => setStages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number.id]);

  // Search/filter change (or number switch, or the poll interval): refresh the list without touching the open conversation.
  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Quick replies and templates aren't number-scoped — fetch once, not on every number switch.
  useEffect(() => {
    backendApi.listQuickReplies().then(setQuickReplies).catch(() => setQuickReplies([]));
    backendApi.listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

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

  const selectConversation = useCallback(async (conversationId: string) => {
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    setSelectedId(conversationId);
    const ws = await loadWorkspace(conversationId, true);
    if (ws?.realtime && selectedIdRef.current === conversationId) {
      stopRealtimeRef.current = connectRealtimeMessages(ws.realtime, conversationId, () => {
        void loadWorkspace(conversationId);
        void loadConversations();
      });
    }
  }, [loadWorkspace, loadConversations]);

  useEffect(() => {
    if (!initialConversationId) return;
    void selectConversation(initialConversationId);
    onInitialConversationConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, number.id]);

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
        <ConversationList conversations={conversations} selectedId={selectedId} search={search} filters={filters} onSearchChange={setSearch} onFiltersChange={setFilters} onSelect={(id) => void selectConversation(id)} />
        {workspace ? (
          <>
            <ChatPane workspace={workspace} quickReplies={quickReplies} templates={templates} onAfterSend={handleChanged} onResolve={() => void handleResolve()} />
            <DetailPanel workspace={workspace} stages={stages} onChanged={handleChanged} />
          </>
        ) : (
          <div className="centered-message">Select a conversation to view it here.</div>
        )}
      </div>
    </>
  );
}
