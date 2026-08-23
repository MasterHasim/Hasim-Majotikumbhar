import { lazy, Suspense, useEffect, useState } from 'react';
import { getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { apiFetch, ApiClientError } from './lib/api';
import { backendApi } from './lib/backendApi';
import type { WhatsAppNumber, WhoAmI } from './types';
import { NumberPicker } from './components/NumberPicker';
import { Sidebar, type Page } from './components/Sidebar';
import { Inbox } from './components/Inbox';
import { Leads } from './components/Leads';
import { Reminders } from './components/Reminders';
import { CallHistory } from './components/CallHistory';
import { Customers } from './components/Customers';
import { PublicQuotationView } from './components/PublicQuotationView';

// Code-split the three heaviest, least-immediately-needed surfaces (Admin alone is ~1300 lines,
// over a third of all component code) out of the initial bundle — audit 2026-08-24 flagged the
// single ~609kB chunk. Each is only rendered behind its own REPORTS_VIEW/ADMIN role gate anyway,
// so a signed-in AGENT (the common case) never even requests these chunks.
const Admin = lazy(() => import('./components/Admin').then((m) => ({ default: m.Admin })));
const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const Home = lazy(() => import('./components/Home').then((m) => ({ default: m.Home })));

/** Mirrors Sidebar's REPORTS_ROLES — the roles that can see Home/Dashboard. Used to pick a
 * default landing page that a given signed-in user can actually see, instead of always
 * defaulting to a page an AGENT (no REPORTS_VIEW) would immediately get a 403 on. */
const REPORTS_ROLES = ['ADMIN', 'SUPERVISOR', 'SITE_MANAGER', 'VIEWER'];

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
  const [page, setPage] = useState<Page>('home');
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [needsResponseCounts, setNeedsResponseCounts] = useState<Record<string, number>>({});
  const [leadsToCallCount, setLeadsToCallCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /** Bridges into the Inbox on whichever number a conversation actually belongs to — which may not
   * be the number currently open. Used by Leads' "Send WhatsApp", Reminders' "Open chat", and
   * Customers' "View conversation". */
  function openConversation(conversationId: string, numberId: string) {
    const target = (numbers ?? []).find((n) => n.id === numberId);
    if (target && target.id !== activeNumber?.id) setActiveNumber(target);
    setPendingConversationId(conversationId);
    setPage('inbox');
  }

  /** Same bridging idea as openConversation, for Reminders' "Open lead" — Leads isn't
   * number-scoped, so this is simpler: just switch page and let Leads.tsx pick up the id. */
  function openLead(leadId: string) {
    setPendingLeadId(leadId);
    setPage('leads');
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

  // Home is the default landing page, but it (like Dashboard) requires REPORTS_VIEW — an AGENT
  // doesn't have it, so redirect straight to Inbox (which every role can see) instead of landing
  // on a page that immediately 403s. Runs once whoAmI resolves; never overrides a later manual
  // navigation since it's only keyed on whoAmI.
  useEffect(() => {
    if (!whoAmI) return;
    if (!whoAmI.roleKeys.some((r) => REPORTS_ROLES.includes(r))) setPage('inbox');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // "Prompt, don't auto-ring" side of Auto Dialer (see PROGRESS.md) — leads assigned to me
  // that haven't been called yet, surfaced as a sidebar badge regardless of which page is
  // open, without ever placing a call automatically. Admin-toggleable (Admin → Auto Dialer);
  // checked once per sign-in rather than every poll tick, since it rarely changes.
  const [callPromptEnabled, setCallPromptEnabled] = useState(true);
  useEffect(() => {
    if (!whoAmI) return;
    backendApi.getAutoDialerSettings().then((s) => setCallPromptEnabled(s.callPromptEnabled)).catch(() => {});
  }, [whoAmI]);
  useEffect(() => {
    if (!whoAmI || !callPromptEnabled) { setLeadsToCallCount(0); return; }
    // Real bug, confirmed live 2026-08-24: callPromptEnabled defaults to true before the
    // settings fetch above resolves, so this effect's first run (still on the stale default)
    // fires a leads request immediately. If the real setting turns out to be false, THIS effect
    // re-runs and correctly zeroes the count — but the earlier request was already in flight,
    // and its response arrived afterward and overwrote the zero back to a stale non-zero
    // count. `cancelled` discards that stale response instead of applying it.
    let cancelled = false;
    function load() {
      backendApi.listLeads({ assignedUserId: whoAmI!.id, status: 'ASSIGNED' })
        .then((leads) => { if (!cancelled) setLeadsToCallCount(leads.length); })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [whoAmI, callPromptEnabled]);

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

  const publicQuoteMatch = window.location.pathname.match(/^\/quote\/([^/]+)/);
  if (publicQuoteMatch) return <PublicQuotationView quotationId={publicQuoteMatch[1]!} />;

  if (authLoading) return <div className="centered-message">Loading…</div>;

  if (!user) {
    return (
      <div className="landing-screen">
        <div className="landing-header">
          <span className="logo">💬</span>
          <div>
            <h1>ECHT Connect</h1>
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
      <Sidebar number={activeNumber} whoAmI={whoAmI} page={page} needsResponseCount={needsResponseCounts[activeNumber.id] ?? 0} leadsToCallCount={leadsToCallCount} onNavigate={setPage} onSwitchNumber={() => setActiveNumber(null)} onSignOut={() => void signOut(auth)} />
      <div id="mainArea">
        <div id="pageContent">
          {page === 'home' && (
            <Suspense fallback={<p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>}>
              <Home />
            </Suspense>
          )}
          {page === 'inbox' && (
            <Inbox number={activeNumber} initialConversationId={pendingConversationId} onInitialConversationConsumed={() => setPendingConversationId(null)} />
          )}
          {page === 'leads' && (
            <Leads whoAmI={whoAmI} onOpenConversation={openConversation} initialLeadId={pendingLeadId} onInitialLeadConsumed={() => setPendingLeadId(null)} callPromptEnabled={callPromptEnabled} />
          )}
          {page === 'reminders' && <Reminders number={activeNumber} onOpenConversation={openConversation} onOpenLead={openLead} />}
          {page === 'callHistory' && <CallHistory isManager={whoAmI.roleKeys.includes('ADMIN') || whoAmI.roleKeys.includes('SITE_MANAGER')} onOpenConversation={openConversation} />}
          {page === 'customers' && <Customers number={activeNumber} onOpenConversation={openConversation} />}
          {page === 'dashboard' && (
            <Suspense fallback={<p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>}>
              <Dashboard number={activeNumber} />
            </Suspense>
          )}
          {page === 'admin' && (whoAmI.roleKeys.includes('ADMIN') || whoAmI.roleKeys.includes('SUPERVISOR') || whoAmI.roleKeys.includes('SITE_MANAGER')) && (
            <Suspense fallback={<p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>}>
              <Admin whoAmI={whoAmI} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
