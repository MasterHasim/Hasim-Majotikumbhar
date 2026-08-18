/** Public Phase 22 entry points. */
function phase22Api_() { return new Phase22Api(); }
function listLeadLocations() { return phase22Api_().listLocations(); }
function uploadLeads(rows) { return phase22Api_().uploadLeads(rows); }
function listLeads(filters) { return phase22Api_().listLeads(filters); }
function reassignLead(leadId, userId) { return phase22Api_().reassignLead(leadId, userId); }
function getLocationAssignmentConfig(location) { return phase22Api_().getLocationConfig(location); }
function setLocationAssignmentConfig(location, patch) { return phase22Api_().setLocationConfig(location, patch); }
function listLocationAssignmentParticipants(location) { return phase22Api_().listLocationParticipants(location); }
function addLocationAssignmentParticipant(location, userId, sequenceOrder) { return phase22Api_().addLocationParticipant(location, userId, sequenceOrder); }
function updateLocationAssignmentParticipant(id, patch) { return phase22Api_().updateLocationParticipant(id, patch); }
function initiateLeadCall(leadId) { return phase22Api_().initiateCall(leadId); }
function listLeadCallLog(leadId) { return phase22Api_().listCallLog(leadId); }
function setLeadStage(leadId, stageId) { return phase22Api_().setLeadStage(leadId, stageId); }
function getLeadStage(leadId) { return phase22Api_().getLeadStage(leadId); }
function addLeadRemark(leadId, text) { return phase22Api_().addLeadRemark(leadId, text); }
function listLeadRemarks(leadId) { return phase22Api_().listLeadRemarks(leadId); }
function startWhatsAppFromLead(leadId) { return phase22Api_().startWhatsAppFromLead(leadId); }
function initiateConversationCall(conversationId) { return phase22Api_().initiateConversationCall(conversationId); }
