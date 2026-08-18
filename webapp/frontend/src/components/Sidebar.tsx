import type { WhatsAppNumber, WhoAmI } from '../types';

export function Sidebar({
  number, whoAmI, onSwitchNumber, onSignOut,
}: {
  number: WhatsAppNumber;
  whoAmI: WhoAmI;
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
        <div className="nav-item active">
          <span className="nav-icon">💬</span>
          <span className="nav-label">Inbox</span>
        </div>
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
