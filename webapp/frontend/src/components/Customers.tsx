import { useEffect, useState } from 'react';
import type { Customer, WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

export function Customers({ number, onOpenConversation }: {
  number: WhatsAppNumber;
  onOpenConversation: (conversationId: string, numberId: string) => void;
}) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listCustomers(number.id).then(setCustomers).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, [number.id]);

  async function saveField(id: string, patch: Record<string, string>) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await backendApi.updateCustomer(id, patch);
      setCustomers((prev) => (prev ? prev.map((c) => (c.id === id ? updated : c)) : prev));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyId(null);
    }
  }

  async function viewConversation(customerId: string) {
    setError(null);
    try {
      const results = await backendApi.searchConversations({ customerId, numberId: number.id, status: 'ANY' });
      if (results.length === 0) {
        setError('No conversation found for this customer on this number.');
        return;
      }
      onOpenConversation(results[0]!.id, number.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const filtered = (customers ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.company.toLowerCase().includes(q);
  });

  return (
    <>
      <h1 className="page-title">Customers</h1>
      <div className="leads-toolbar">
        <input placeholder="⌕  Search name, phone, or company…" style={{ flex: 1, minWidth: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}

      {customers === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <table className="data-table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Company</th><th></th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    defaultValue={c.name}
                    disabled={busyId === c.id}
                    onBlur={(e) => { if (e.target.value !== c.name) void saveField(c.id, { name: e.target.value }); }}
                  />
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{c.phone}</td>
                <td>
                  <input
                    defaultValue={c.email}
                    disabled={busyId === c.id}
                    onBlur={(e) => { if (e.target.value !== c.email) void saveField(c.id, { email: e.target.value }); }}
                  />
                </td>
                <td>
                  <input
                    defaultValue={c.company}
                    disabled={busyId === c.id}
                    onBlur={(e) => { if (e.target.value !== c.company) void saveField(c.id, { company: e.target.value }); }}
                  />
                </td>
                <td>
                  <button className="btn" onClick={() => void viewConversation(c.id)}>View conversation</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="empty">{search ? 'No customers match this search.' : 'No customers on this number yet.'}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </>
  );
}
