import { useEffect, useState } from 'react';
import type { AvailabilityStatus } from '../types';
import { backendApi } from '../lib/backendApi';

const OPTIONS: { value: AvailabilityStatus; label: string }[] = [
  { value: 'available', label: '🟢 Available' },
  { value: 'busy', label: '🟡 Busy' },
  { value: 'offline', label: '⚪ Offline' },
  { value: 'on_leave', label: '🌴 On leave' },
];

/** Self-service availability — feeds Phase7Api's round-robin (an unavailable agent is
 * skipped when a new conversation auto-assigns). Backend (setAvailability/getAvailability)
 * has existed since Phase 1; this was the only piece of UI never built for it. */
export function AvailabilityToggle({ userId }: { userId: string }) {
  const [status, setStatus] = useState<AvailabilityStatus>('available');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backendApi.getAvailability(userId).then((record) => { if (record) setStatus(record.status); }).catch(() => {});
  }, [userId]);

  async function change(next: AvailabilityStatus) {
    setStatus(next);
    setBusy(true);
    try {
      await backendApi.setAvailability(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select id="availabilitySelect" disabled={busy} value={status} onChange={(e) => void change(e.target.value as AvailabilityStatus)}>
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
