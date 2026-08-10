/** Public Phase 12 entry points. */
function phase12Api_() { return new Phase12Api(); }
function getNumberAssignmentConfig(numberId) { return phase12Api_().getNumberAssignmentConfig(numberId); }
function setNumberAssignmentConfig(numberId, patch) { return phase12Api_().setNumberAssignmentConfig(numberId, patch); }
function listAssignmentParticipants(numberId) { return phase12Api_().listAssignmentParticipants(numberId); }
function addAssignmentParticipant(numberId, userId, sequenceOrder) { return phase12Api_().addAssignmentParticipant(numberId, userId, sequenceOrder); }
function updateAssignmentParticipant(id, patch) { return phase12Api_().updateAssignmentParticipant(id, patch); }
function getDashboardSummary() { return phase12Api_().getDashboardSummary(); }

function doGetAdmin() {
  return HtmlService.createTemplateFromFile('frontend/Admin').evaluate()
    .setTitle('WhatsApp Panel — Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
