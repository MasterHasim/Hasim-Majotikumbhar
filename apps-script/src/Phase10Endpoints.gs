/** Public Phase 10 entry points. */
function phase10Api_() { return new Phase10Api(); }
function createDraftTemplate(input) { return phase10Api_().createDraftTemplate(input); }
function updateDraftTemplate(id, patch) { return phase10Api_().updateDraftTemplate(id, patch); }
function listTemplates() { return phase10Api_().listTemplates(); }
function getTemplate(id) { return phase10Api_().getTemplate(id); }
function submitTemplateForReview(id) { return phase10Api_().submitTemplateForReview(id); }
function syncTemplatesFromProvider(wabaId) { return phase10Api_().syncTemplatesFromProvider(wabaId); }
