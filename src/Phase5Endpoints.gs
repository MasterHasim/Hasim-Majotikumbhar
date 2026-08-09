/** Public Phase 5 entry points, plus doGet — the project's first HTML UI. */
function phase5Api_() { return new Phase5Api(); }
function listMyNumbers() { return phase5Api_().listMyNumbers(); }
function listConversations(numberId) { return phase5Api_().listConversations(numberId); }
function getConversationDetail(conversationId) { return phase5Api_().getConversationDetail(conversationId); }

function doGet(e) {
  return HtmlService.createTemplateFromFile('frontend/Index').evaluate()
    .setTitle('WhatsApp Panel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
