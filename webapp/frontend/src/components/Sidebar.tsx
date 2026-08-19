import type { WhatsAppNumber, WhoAmI } from '../types';

export type Page = 'inbox' | 'leads' | 'admin';

export function Sidebar({
  number, whoAmI, page, onNavigate, onSwitchNumber, onSignOut,
}: {
  number: WhatsAppNumber;
  whoAmI: WhoAmI;
  page: Page;
  onNavigate: (page: Page) => void;
  onSwitchNumber: () => void;
  onSignOut: () => void;
}) {
  const initial = (whoAmI.displayName || whoAmI.email || '?').charAt(0).toUpperCase();
  return (
    <div id="sidebar">
      <div className="brand">
        <span className="logo">💬</span>
        <span>WhatsApp Panel</span>
      </div>
      <button className="current-number-pill" onClick={onSwitchNumber}>
        <div className="cn-name">{number.displayName}</div>
        <div className="cn-phone">{number.phoneNumber}</div>
        <div className="cn-switch">Switch number ▾</div>
      </button>
      <div id="navList">
        <button className={`nav-item${page === 'inbox' ? ' active' : ''}`} onClick={() => onNavigate('inbox')}>
          <span className="nav-icon">💬</span>
          <span className="nav-label">Inbox</span>
        </button>
        <button className={`nav-item${page === 'leads' ? ' active' : ''}`} onClick={() => onNavigate('leads')}>
          <span className="nav-icon">📍</span>
          <span className="nav-label">Leads</span>
        </button>
        {whoAmI.roleKeys.includes('ADMIN') && (
          <button className={`nav-item${page === 'admin' ? ' active' : ''}`} onClick={() => onNavigate('admin')}>
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">Admin</span>
          </button>
        )}
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
  );
}
