/** Public Phase 5 entry points, plus doGet — the project's first HTML UI. */
function phase5Api_() { return new Phase5Api(); }
function listMyNumbers() { return phase5Api_().listMyNumbers(); }
function listConversations(numberId) { return phase5Api_().listConversations(numberId); }
function getConversationDetail(conversationId) { return phase5Api_().getConversationDetail(conversationId); }

// 2026-08-10: unified into a single app (frontend/Index.html) — no more ?page=admin
// split. Every section (including what used to be the separate Admin Panel) is now a
// client-side view within the one shell, so there is only ever one thing to serve.
function doGet(e) {
  return HtmlService.createTemplateFromFile('frontend/Index').evaluate()
    .setTitle('WhatsApp Panel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
