/** Public Phase 6 entry point. */
function phase6Api_() { return new Phase6Api(); }
function sendReply(conversationId, text) { return phase6Api_().sendReply(conversationId, text); }
