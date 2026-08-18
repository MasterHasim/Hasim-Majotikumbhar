import { useEffect, useState } from 'react';
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { apiFetch, ApiClientError } from './lib/api';

interface WhoAmI {
  id: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}

async function signIn() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    // Popups are blocked by some browsers/extensions by default (and by
    // sandboxed automation contexts) — redirect-based sign-in works
    // everywhere popup-based sign-in does, so it's the safer default to fall
    // back to rather than leaving affected users stuck with no explanation.
    if (err instanceof Error && 'code' in err && err.code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, googleProvider);
    } else {
      throw err;
    }
  }
}

/**
 * Pipeline-validation screen for the new stack, mirroring how the Apps Script
 * migration proved the realtime channel worked (a visible round trip, not
 * just "should work in theory"). Once the real Inbox UI is built, this
 * becomes the auth gate in front of it instead of the whole screen.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [whoAmI, setWhoAmI] = useState<WhoAmI | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRedirectResult(auth).catch((err) => setError(String(err)));
  }, []);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }), []);

  function loadWhoAmI() {
    setError(null);
    setNeedsBootstrap(false);
    apiFetch<WhoAmI>('/api/whoami')
      .then(setWhoAmI)
      .catch((err) => {
        // Nobody has completed setup yet on a brand-new deployment — offer to
        // become the first ADMIN instead of just showing a raw error, same
        // one-time moment apps-script/src/Phase1Services.gs's bootstrap() covers.
        if (err instanceof ApiClientError && err.code === 'UNAUTHENTICATED') { setNeedsBootstrap(true); return; }
        setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
      });
  }

  useEffect(() => {
    if (!user) { setWhoAmI(null); return; }
    loadWhoAmI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function completeBootstrap() {
    if (!user?.email) return;
    setBootstrapping(true);
    setError(null);
    try {
      await apiFetch('/api/bootstrap', { method: 'POST', body: JSON.stringify({ email: user.email, displayName: user.displayName || user.email }) });
      loadWhoAmI();
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBootstrapping(false);
    }
  }

  if (authLoading) return <p>Loading…</p>;

  if (!user) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>WhatsApp Panel — New Stack</h1>
        <button onClick={() => void signIn()}>Sign in with Google</button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>
    );
  }

  if (needsBootstrap) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>WhatsApp Panel — New Stack</h1>
        <p>Signed in as {user.email}. No admin account exists yet on this new system.</p>
        <button onClick={() => void completeBootstrap()} disabled={bootstrapping}>
          {bootstrapping ? 'Setting up…' : 'Become the first admin'}
        </button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
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
