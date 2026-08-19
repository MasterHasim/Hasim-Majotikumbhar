import { useEffect, useState } from 'react';
import type { DashboardMetrics, WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function Kpi({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon">{icon}</div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
      </div>
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <div className="empty">No data yet.</div>;
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span>{r.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <span className="bar-count">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ number }: { number: WhatsAppNumber | null }) {
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.getDashboardMetrics(scope === 'current' ? number?.id : undefined)
      .then(setMetrics)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }, [scope, number]);

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      {number && (
        <div className="leads-toolbar">
          <select value={scope} onChange={(e) => setScope(e.target.value as 'current' | 'all')}>
            <option value="current">This number ({number.displayName})</option>
            <option value="all">All numbers I can access</option>
          </select>
        </div>
      )}
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}
      {!metrics ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>
      ) : (
        <>
          <div className="kpi-row">
            <Kpi icon="💬" label="Total conversations" value={metrics.conversations.total} />
            <Kpi icon="🟢" label="Open" value={metrics.conversations.open} />
            <Kpi icon="🕓" label="Needs reply" value={metrics.conversations.needsResponse} />
            <Kpi icon="⚪" label="Unassigned" value={metrics.conversations.unassigned} />
            <Kpi icon="✅" label="Resolved" value={metrics.conversations.resolved} />
            <Kpi icon="👤" label="Assigned to me" value={metrics.assignedToMe} />
            <Kpi icon="👥" label="Total customers" value={metrics.totalCustomers} />
            <Kpi icon="⏱️" label="Avg. first response" value={metrics.responseTime.averageFirstResponseMinutes === null ? '—' : `${metrics.responseTime.averageFirstResponseMinutes}m`} />
          </div>

          <div className="card" style={{ maxWidth: 'none' }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>By number</h2>
            <table className="data-table">
              <thead><tr><th>Number</th><th>Total</th><th>Open</th><th>Unassigned</th><th>Needs reply</th><th>Resolved</th></tr></thead>
              <tbody>
                {metrics.byNumber.map((n) => (
                  <tr key={n.numberId}><td>{n.displayName}</td><td>{n.total}</td><td>{n.open}</td><td>{n.unassigned}</td><td>{n.needsResponse}</td><td>{n.resolved}</td></tr>
                ))}
                {metrics.byNumber.length === 0 && <tr><td colSpan={6} className="empty">No data yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 'none' }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>By agent (open conversations)</h2>
            <table className="data-table">
              <thead><tr><th>Agent</th><th>Open</th><th>Needs reply</th></tr></thead>
              <tbody>
                {metrics.byAgent.map((a) => (
                  <tr key={a.userId}><td>{a.displayName}</td><td>{a.open}</td><td>{a.needsResponse}</td></tr>
                ))}
                {metrics.byAgent.length === 0 && <tr><td colSpan={3} className="empty">No assignments yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 'none' }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>Lead stage distribution</h2>
            <BarList rows={metrics.stageDistribution.map((s) => ({ label: s.name, count: s.count }))} />
          </div>

          <div className="card" style={{ maxWidth: 'none' }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>Template usage</h2>
            <BarList rows={metrics.templateUsage.map((t) => ({ label: t.name, count: t.count }))} />
          </div>

          <div className="card">
            <h2 className="section-title" style={{ marginTop: 0 }}>Lead conversion</h2>
            <div className="cust-fields" style={{ padding: 0, border: 'none' }}>
              <div className="field-row"><span className="field-label">Customers with a stage</span><span className="field-value">{metrics.leadConversion.totalCustomersWithStage}</span></div>
              <div className="field-row"><span className="field-label">Won</span><span className="field-value">{metrics.leadConversion.wonCount}</span></div>
              <div className="field-row"><span className="field-label">Conversion rate</span><span className="field-value">{metrics.leadConversion.conversionRate === null ? '—' : `${metrics.leadConversion.conversionRate}%`}</span></div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
