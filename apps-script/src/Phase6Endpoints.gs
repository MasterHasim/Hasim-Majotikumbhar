/** Public Phase 6 entry points. */
function phase6Api_() { return new Phase6Api(); }
function sendReply(conversationId, text) { return phase6Api_().sendReply(conversationId, text); }
function sendTemplateReply(conversationId, templateId, variables) { return phase6Api_().sendTemplateReply(conversationId, templateId, variables); }
function sendMediaReply(conversationId, mediaType, mediaUrl, caption) { return phase6Api_().sendMediaReply(conversationId, mediaType, mediaUrl, caption); }
function uploadConversationMedia(conversationId, base64Data, filename, mimeType) { return phase6Api_().uploadConversationMedia(conversationId, base64Data, filename, mimeType); }
function resolveConversation(conversationId) { return phase6Api_().resolveConversation(conversationId); }
