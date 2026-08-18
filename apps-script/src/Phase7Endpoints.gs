/** Public Phase 7 entry points. */
function phase7Api_() { return new Phase7Api(); }
function reassignConversation(conversationId, newUserId) { return phase7Api_().reassignConversation(conversationId, newUserId); }
function listAssignmentHistory(conversationId) { return phase7Api_().listAssignmentHistory(conversationId); }
function listAssignableUsers(numberId) { return phase7Api_().listAssignableUsers(numberId); }
