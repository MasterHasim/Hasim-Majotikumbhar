import type { WhatsAppNumber } from '../types';

export function NumberPicker({ numbers, onPick }: { numbers: WhatsAppNumber[]; onPick: (number: WhatsAppNumber) => void }) {
  return (
    <div className="landing-screen">
      <div className="landing-header">
        <span className="logo">💬</span>
        <div>
          <h1>WhatsApp Panel</h1>
          <div className="subtitle">Pick a number to open its inbox.</div>
        </div>
      </div>
      {numbers.length === 0 ? (
        <p className="empty">You don't have access to any WhatsApp numbers yet — ask an admin to grant you access.</p>
      ) : (
        <div className="number-cards">
          {numbers.map((number) => (
            <div key={number.id} className="number-card" role="button" tabIndex={0} onClick={() => onPick(number)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(number); }}>
              <div className="name">{number.displayName}</div>
              <div className="phone">{number.phoneNumber}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
