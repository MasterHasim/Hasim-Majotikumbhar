/** Public entry point for WorkspaceApi (performance aggregator, see src/WorkspaceServices.gs). */
function getConversationWorkspace(conversationId, includeRealtime) { return new WorkspaceApi().getConversationWorkspace(conversationId, includeRealtime); }
