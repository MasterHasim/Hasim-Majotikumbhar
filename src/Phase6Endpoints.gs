/** Public Phase 6 entry points. */
function phase6Api_() { return new Phase6Api(); }
function sendReply(conversationId, text) { return phase6Api_().sendReply(conversationId, text); }
function sendTemplateReply(conversationId, templateId, variables) { return phase6Api_().sendTemplateReply(conversationId, templateId, variables); }
