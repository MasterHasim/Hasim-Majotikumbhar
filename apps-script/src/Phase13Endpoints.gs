/** Public Phase 13 entry points. */
function phase13Api_() { return new Phase13Api(); }
function searchConversations(filters) { return phase13Api_().searchConversations(filters); }
function getNeedsResponseCounts() { return phase13Api_().getNeedsResponseCounts(); }
