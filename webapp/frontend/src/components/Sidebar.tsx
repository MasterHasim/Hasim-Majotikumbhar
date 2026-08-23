import { useState } from 'react';
import type { WhatsAppNumber, WhoAmI } from '../types';
import { AvailabilityToggle } from './AvailabilityToggle';

export type Page = 'home' | 'inbox' | 'leads' | 'reminders' | 'callHistory' | 'customers' | 'dashboard' | 'admin';

const REPORTS_ROLES = ['ADMIN', 'SUPERVISOR', 'SITE_MANAGER', 'VIEWER'];
const ADMIN_PAGE_ROLES = ['ADMIN', 'SUPERVISOR', 'SITE_MANAGER'];

export function Sidebar({
  number, whoAmI, page, needsResponseCount, leadsToCallCount, onNavigate, onSwitchNumber, onSignOut,
}: {
  number: WhatsAppNumber;
  whoAmI: WhoAmI;
  page: Page;
  needsResponseCount: number;
  /** Leads assigned to me, not yet called — the "prompt, don't auto-ring" side of Auto
   * Dialer (see PROGRESS.md): surfaces the need to call regardless of which page an agent
   * is on, without actually placing a call for them. */
  leadsToCallCount: number;
  onNavigate: (page: Page) => void;
  onSwitchNumber: () => void;
  onSignOut: () => void;
}) {
  const initial = (whoAmI.displayName || whoAmI.email || '?').charAt(0).toUpperCase();
  /** Only meaningful below the 900px breakpoint — the sidebar is always visible above it,
   * this state just doesn't get read by any visible CSS at wider widths. */
  const [open, setOpen] = useState(false);

  function navigate(p: Page) {
    onNavigate(p);
    setOpen(false);
  }

  return (
    <>
      <button className="sidebar-toggle" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
      <div className={`sidebar-backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <div id="sidebar" className={open ? 'open' : ''}>
        <div className="brand">
          <span className="logo">💬</span>
          <span>ECHT Connect</span>
        </div>
        <button className="current-number-pill" onClick={() => { onSwitchNumber(); setOpen(false); }}>
          <div className="cn-name">{number.displayName}</div>
          <div className="cn-phone">{number.phoneNumber}</div>
          {needsResponseCount > 0 && <div className="cn-badge">{needsResponseCount} need{needsResponseCount === 1 ? 's' : ''} reply</div>}
          <div className="cn-switch">Switch number ▾</div>
        </button>
        <div id="navList">
          {whoAmI.roleKeys.some((r) => REPORTS_ROLES.includes(r)) && (
            <button className={`nav-item${page === 'home' ? ' active' : ''}`} onClick={() => navigate('home')}>
              <span className="nav-icon">🏠</span>
              <span className="nav-label">Home</span>
            </button>
          )}
          <button className={`nav-item${page === 'inbox' ? ' active' : ''}`} onClick={() => navigate('inbox')}>
            <span className="nav-icon">💬</span>
            <span className="nav-label">Inbox</span>
          </button>
          <button className={`nav-item${page === 'leads' ? ' active' : ''}`} onClick={() => navigate('leads')}>
            <span className="nav-icon">📍</span>
            <span className="nav-label">Leads</span>
            {leadsToCallCount > 0 && <span className="nav-badge" title="Assigned to you, not yet called">📞 {leadsToCallCount}</span>}
          </button>
          <button className={`nav-item${page === 'reminders' ? ' active' : ''}`} onClick={() => navigate('reminders')}>
            <span className="nav-icon">⏰</span>
            <span className="nav-label">Reminders</span>
          </button>
          <button className={`nav-item${page === 'callHistory' ? ' active' : ''}`} onClick={() => navigate('callHistory')}>
            <span className="nav-icon">📞</span>
            <span className="nav-label">Call History</span>
          </button>
          <button className={`nav-item${page === 'customers' ? ' active' : ''}`} onClick={() => navigate('customers')}>
            <span className="nav-icon">👥</span>
            <span className="nav-label">Customers</span>
          </button>
          {whoAmI.roleKeys.some((r) => REPORTS_ROLES.includes(r)) && (
            <button className={`nav-item${page === 'dashboard' ? ' active' : ''}`} onClick={() => navigate('dashboard')}>
              <span className="nav-icon">📊</span>
              <span className="nav-label">Dashboard</span>
            </button>
          )}
          {whoAmI.roleKeys.some((r) => ADMIN_PAGE_ROLES.includes(r)) && (
            <button className={`nav-item${page === 'admin' ? ' active' : ''}`} onClick={() => navigate('admin')}>
              <span className="nav-icon">⚙️</span>
              <span className="nav-label">Admin</span>
            </button>
          )}
        </div>
        <div className="sidebar-availability">
          <AvailabilityToggle userId={whoAmI.id} />
        </div>
        <div className="sidebar-footer">
          <div className="avatar-circle">{initial}</div>
          <div>
            <div style={{ fontWeight: 700 }}>{whoAmI.displayName}</div>
            <div style={{ opacity: 0.75, fontSize: 11 }}>{whoAmI.roleKeys.join(', ')}</div>
          </div>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </>
  );
}
