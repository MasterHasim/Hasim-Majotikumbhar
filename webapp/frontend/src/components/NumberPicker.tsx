import { useState } from 'react';
import type { WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function AddNumberForm({ onCreated }: { onCreated: (number: WhatsAppNumber) => void }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!displayName.trim() || !phoneNumber.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await backendApi.createNumber({ displayName: displayName.trim(), phoneNumber: phoneNumber.trim(), provider: 'exotel' });
      setDisplayName('');
      setPhoneNumber('');
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button className="btn primary" style={{ marginTop: 16 }} onClick={() => setOpen(true)}>+ Add a WhatsApp number</button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Add a WhatsApp number</h2>
      <div className="form-row">
        <input placeholder="Display name (e.g. Entartica - Raipur)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input placeholder="Phone number (e.g. 079-485-02801)" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <button className="btn primary" disabled={saving || !displayName.trim() || !phoneNumber.trim()} onClick={() => void submit()}>
          {saving ? 'Adding…' : 'Add number'}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function NumberPicker({ numbers, isAdmin, onPick, onNumberCreated }: {
  numbers: WhatsAppNumber[];
  isAdmin: boolean;
  onPick: (number: WhatsAppNumber) => void;
  onNumberCreated: (number: WhatsAppNumber) => void;
}) {
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
        <p className="empty">
          {isAdmin ? 'No WhatsApp numbers are registered on this new backend yet — add your first one below.' : "You don't have access to any WhatsApp numbers yet — ask an admin to grant you access."}
        </p>
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
      {isAdmin && <AddNumberForm onCreated={onNumberCreated} />}
    </div>
  );
}
