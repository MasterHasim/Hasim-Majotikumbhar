/** Public Phase 11 entry points. */
function phase11Api_() { return new Phase11Api(); }
function createQuickReply(input) { return phase11Api_().createQuickReply(input); }
function updateQuickReply(id, patch) { return phase11Api_().updateQuickReply(id, patch); }
function listQuickReplies() { return phase11Api_().listQuickReplies(); }
