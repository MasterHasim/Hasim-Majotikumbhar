import { useEffect, useState } from 'react';
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { apiFetch, ApiClientError } from './lib/api';
import { backendApi } from './lib/backendApi';
import type { WhatsAppNumber, WhoAmI } from './types';
import { NumberPicker } from './components/NumberPicker';
import { Sidebar, type Page } from './components/Sidebar';
import { Inbox } from './components/Inbox';
import { Leads } from './components/Leads';
import { Admin } from './components/Admin';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [whoAmI, setWhoAmI] = useState<WhoAmI | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [numbers, setNumbers] = useState<WhatsAppNumber[] | null>(null);
  const [activeNumber, setActiveNumber] = useState<WhatsAppNumber | null>(null);
  const [page, setPage] = useState<Page>('inbox');
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [needsResponseCounts, setNeedsResponseCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  /** Leads.tsx's "Send WhatsApp" bridges into the Inbox on whichever number the lead's location resolves to — which may not be the number currently open. */
  function openConversationFromLead(conversationId: string, numberId: string) {
    const target = (numbers ?? []).find((n) => n.id === numberId);
    if (target && target.id !== activeNumber?.id) setActiveNumber(target);
    setPendingConversationId(conversationId);
    setPage('inbox');
  }

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

  useEffect(() => {
    if (!whoAmI) { setNumbers(null); return; }
    backendApi.listMyNumbers()
      .then(setNumbers)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }, [whoAmI]);

  useEffect(() => {
    if (!whoAmI) { setNeedsResponseCounts({}); return; }
    function load() {
      backendApi.getNeedsResponseCounts().then(setNeedsResponseCounts).catch(() => {});
    }
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [whoAmI]);

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

  if (authLoading) return <div className="centered-message">Loading…</div>;

  if (!user) {
    return (
      <div className="landing-screen">
        <div className="landing-header">
          <span className="logo">💬</span>
          <div>
            <h1>WhatsApp Panel</h1>
            <div className="subtitle">Sign in with your Google Workspace account to continue.</div>
          </div>
        </div>
        <button className="btn primary" onClick={() => void signIn()}>Sign in with Google</button>
        {error && <p className="fatal-error">{error}</p>}
      </div>
    );
  }

  if (needsBootstrap) {
    return (
      <div className="landing-screen">
        <div className="landing-header">
          <span className="logo">💬</span>
          <div>
            <h1>Welcome</h1>
            <div className="subtitle">Signed in as {user.email}. No admin account exists yet on this new system.</div>
          </div>
        </div>
        <button className="btn primary" disabled={bootstrapping} onClick={() => void completeBootstrap()}>
          {bootstrapping ? 'Setting up…' : 'Become the first admin'}
        </button>
        {error && <p className="fatal-error">{error}</p>}
      </div>
    );
  }

  if (!whoAmI || numbers === null) return <div className="centered-message">Loading…</div>;

  if (!activeNumber) {
    return (
      <>
        <NumberPicker
          numbers={numbers}
          isAdmin={whoAmI.roleKeys.includes('ADMIN')}
          needsResponseCounts={needsResponseCounts}
          onPick={setActiveNumber}
          onNumberCreated={(created) => setNumbers((prev) => [...(prev ?? []), created])}
        />
        {error && <p className="fatal-error">{error}</p>}
      </>
    );
  }

  return (
    <div id="app">
      <Sidebar number={activeNumber} whoAmI={whoAmI} page={page} needsResponseCount={needsResponseCounts[activeNumber.id] ?? 0} onNavigate={setPage} onSwitchNumber={() => setActiveNumber(null)} onSignOut={() => void signOut(auth)} />
      <div id="mainArea">
        <div id="pageContent">
          {page === 'inbox' && (
            <Inbox number={activeNumber} initialConversationId={pendingConversationId} onInitialConversationConsumed={() => setPendingConversationId(null)} />
          )}
          {page === 'leads' && <Leads whoAmI={whoAmI} onOpenConversation={openConversationFromLead} />}
          {page === 'admin' && whoAmI.roleKeys.includes('ADMIN') && <Admin />}
        </div>
      </div>
    </div>
  );
}
