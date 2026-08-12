import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { apiFetch, ApiClientError } from './lib/api';

interface WhoAmI {
  uid: string;
  email: string | null;
  claims: Record<string, unknown>;
}

/**
 * Pipeline-validation screen for the new stack, mirroring how the Apps Script
 * migration proved the realtime channel worked (a visible round trip, not
 * just "should work in theory"). Once Phase 1 (auth/roles) is ported, this
 * becomes the real landing screen instead of a smoke test.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [whoAmI, setWhoAmI] = useState<WhoAmI | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }), []);

  useEffect(() => {
    if (!user) { setWhoAmI(null); return; }
    setError(null);
    apiFetch<WhoAmI>('/api/whoami')
      .then(setWhoAmI)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }, [user]);

  if (authLoading) return <p>Loading…</p>;

  if (!user) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>WhatsApp Panel — New Stack</h1>
        <button onClick={() => signInWithPopup(auth, googleProvider)}>Sign in with Google</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>WhatsApp Panel — New Stack</h1>
      <p>Signed in as {user.email}</p>
      <button onClick={() => signOut(auth)}>Sign out</button>
      <h2>Backend pipeline check</h2>
      {error && <p style={{ color: 'crimson' }}>Backend call failed: {error}</p>}
      {whoAmI && <pre>{JSON.stringify(whoAmI, null, 2)}</pre>}
    </div>
  );
}
