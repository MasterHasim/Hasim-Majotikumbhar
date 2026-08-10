/** Public entry point for WorkspaceApi (performance aggregator, see src/WorkspaceServices.gs). */
function getConversationWorkspace(conversationId) { return new WorkspaceApi().getConversationWorkspace(conversationId); }
