/**
 * Direct port of apps-script/frontend/Index.html's RealtimeListener — the browser
 * connects to Firebase Realtime Database directly (not through the Workers backend)
 * so a new inbound/outbound message appears the instant it's written, instead of
 * waiting for the next poll. All writes still go through the backend exactly as
 * before; this is a read-only add-on, scoped server-side to exactly the numbers the
 * signed-in user can see (RealtimeListenApi mints the token), enforced by the same
 * Firebase security rules the Apps Script build already depends on (same project,
 * same rules — see PROGRESS.md).
 *
 * Deliberately REST + EventSource rather than the Firebase JS SDK's onValue: the
 * primary Firebase app instance already holds the Google Auth session used for the
 * backend's Bearer token, and a second sign-in on the same instance would replace
 * it. REST sidesteps that entirely — exchange the custom token for an ID token via
 * Identity Toolkit, then stream the Realtime Database's REST endpoint as
 * Server-Sent Events. The exact same approach already confirmed live in the Apps
 * Script build (PROGRESS.md, "Real-time message delivery is live and confirmed
 * working end-to-end").
 */
import type { RealtimeListenToken } from '../types';

export function connectRealtimeMessages(tokenResult: RealtimeListenToken, conversationId: string, onEvent: () => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  let stopped = false;
  let es: EventSource | null = null;

  fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(tokenResult.webApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokenResult.token, returnSecureToken: true }),
  })
    .then((res) => res.json())
    .then((auth: { idToken?: string }) => {
      if (stopped) return;
      if (!auth.idToken) { console.error('RealtimeListener: signInWithCustomToken failed', auth); return; }
      const url = `${tokenResult.databaseUrl}/messages.json?auth=${encodeURIComponent(auth.idToken)}` +
        `&orderBy=${encodeURIComponent('"conversationId"')}&equalTo=${encodeURIComponent(`"${conversationId}"`)}`;
      es = new EventSource(url);
      es.addEventListener('put', onEvent);
      es.addEventListener('patch', onEvent);
      es.onerror = (e) => console.error('RealtimeListener: EventSource error', e);
    })
    .catch((err) => console.error('RealtimeListener: connect failed', err));

  return () => {
    stopped = true;
    es?.close();
  };
}
