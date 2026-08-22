import { useEffect, useState } from 'react';
import { LEAD_LOCATIONS, type DashboardMetrics, type LeadFunnel, type WhatsAppNumber } from '../types';
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

/** A classic sales-funnel bar: each stage's width is relative to how many leads reached the
 * *first* stage (not the grand total) — the usual funnel reading of "what fraction of the top of
 * the funnel made it this far," rather than "what fraction of everything is at this stage." */
function FunnelChart({ funnel }: { funnel: LeadFunnel }) {
  if (funnel.stages.length === 0) return <div className="empty">No lead stages configured yet.</div>;
  return (
    <div className="bar-list">
      {funnel.stages.map((s) => (
        <div key={s.stageId} className="bar-row">
          <span>{s.name}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${s.pctOfFirstStage ?? 0}%` }} /></div>
          <span className="bar-count">{s.count}{s.pctOfTotal !== null ? ` (${s.pctOfTotal}%)` : ''}</span>
        </div>
      ))}
      {funnel.noStage > 0 && (
        <div className="bar-row">
          <span>No stage set</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: 0, background: 'var(--text-muted)' }} /></div>
          <span className="bar-count">{funnel.noStage}</span>
        </div>
      )}
    </div>
  );
}

export function Dashboard({ number }: { number: WhatsAppNumber | null }) {
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<LeadFunnel | null>(null);
  const [funnelLocation, setFunnelLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.getDashboardMetrics(scope === 'current' ? number?.id : undefined)
      .then(setMetrics)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }, [scope, number]);

  useEffect(() => {
    backendApi.getLeadFunnel(funnelLocation || undefined)
      .then(setFunnel)
      .catch((err) => setError(err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err)));
  }, [funnelLocation]);

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>Lead funnel</h2>
              <select value={funnelLocation} onChange={(e) => setFunnelLocation(e.target.value)}>
                <option value="">All locations</option>
                {LEAD_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              The Leads Kanban board's own stage progression — each bar shows what share of leads that reached the first stage also reached this one.
            </p>
            {!funnel ? <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p> : <FunnelChart funnel={funnel} />}
          </div>

          <div className="card" style={{ maxWidth: 'none' }}>
            <h2 className="section-title" style={{ marginTop: 0 }}>Customer stage distribution</h2>
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
