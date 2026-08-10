/** Public Phase 8 entry points. */
function phase8Api_() { return new Phase8Api(); }
function seedDefaultLeadStages() { return phase8Api_().seedDefaultLeadStages(); }
function createStage(input) { return phase8Api_().createStage(input); }
function updateStage(id, patch) { return phase8Api_().updateStage(id, patch); }
function listStages() { return phase8Api_().listStages(); }
function setCustomerStage(customerId, stageId) { return phase8Api_().setCustomerStage(customerId, stageId); }
function getCustomerStage(customerId) { return phase8Api_().getCustomerStage(customerId); }
function addRemark(conversationId, text) { return phase8Api_().addRemark(conversationId, text); }
function listRemarks(conversationId) { return phase8Api_().listRemarks(conversationId); }
function listCustomers() { return phase8Api_().listCustomers(); }
function updateCustomer(customerId, patch) { return phase8Api_().updateCustomer(customerId, patch); }
