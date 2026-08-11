/**
 * One-time migration (2026-08-11): copy existing Messages/Conversations from Sheets
 * into Firebase Realtime Database. Run this BEFORE MessageRepository/
 * ConversationRepository are switched to extend FirebaseRealtimeDbRepository — at
 * the time this runs, `new MessageRepository()`/`new ConversationRepository()` are
 * still Sheets-backed, so this reads the real current data and writes it into
 * Firebase under the same ids. Existing Sheets data is left untouched (not deleted)
 * as a rollback safety net.
 *
 * Run from the Apps Script editor: select migrateToFirebaseOnce in the function
 * dropdown, click Run, check the logged counts, then verify a few records directly
 * in the Firebase console before the code is switched over. Delete this file and
 * push again once migration + cutover are both confirmed working.
 */
function migrateToFirebaseOnce() {
  var messages = new MessageRepository().list();
  var conversations = new ConversationRepository().list();

  var messagesTarget = new FirebaseRealtimeDbRepository('messages');
  var conversationsTarget = new FirebaseRealtimeDbRepository('conversations');

  var messagesCopied = 0, conversationsCopied = 0;
  messages.forEach(function (m) { messagesTarget.replace(m.id, m); messagesCopied++; });
  conversations.forEach(function (c) { conversationsTarget.replace(c.id, c); conversationsCopied++; });

  console.log('Copied ' + messagesCopied + ' messages and ' + conversationsCopied + ' conversations to Firebase.');
}
