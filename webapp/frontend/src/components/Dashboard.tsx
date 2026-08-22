import { useEffect, useState } from 'react';
import { LEAD_LOCATIONS, type AdAccount, type AdInsights, type DashboardMetrics, type LeadFunnel, type WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

/** YYYY-MM-DD, local time — matches what <input type="date"> reads/writes. */
function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ad Name | Portal | Spent Amount | Message Initiated | Reach — Meta today, room for another
 * platform's rows to land in the same table later without changing this component's shape. */
function AdPerformanceCard() {
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(() => dateStamp(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => dateStamp(new Date()));
  const [insights, setInsights] = useState<AdInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.listAdAccounts().then((list) => {
      setAccounts(list);
      const active = list.find((a) => a.active);
      if (active) setAccountId((cur) => cur || active.id);
    }).catch((err) => setError(errMsg(err)));
  }, []);

  useEffect(() => {
    if (!accountId) { setInsights(null); return; }
    setInsights(null);
    backendApi.getAdInsights(accountId, from, to).then(setInsights).catch((err) => setError(errMsg(err)));
  }, [accountId, from, to]);

  if (accounts !== null && accounts.length === 0) return null; // nothing configured yet — no empty card to confuse a viewer

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>Ad performance</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts === null && <option>Loading…</option>}
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <table className="data-table">
        <thead><tr><th>Ad name</th><th>Portal</th><th>Spent</th><th>Messages initiated</th><th>Reach</th></tr></thead>
        <tbody>
          {insights === null && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
          {insights?.rows.map((row) => (
            <tr key={row.campaignName} style={row.isTotal ? { fontWeight: 700, borderTop: '2px solid var(--border)' } : undefined}>
              <td>{row.campaignName}</td>
              <td>{row.isTotal ? '' : insights.platform}</td>
              <td>{currency(row.spend)}</td>
              <td>{row.messagesInitiated}</td>
              <td>{row.reach}</td>
            </tr>
          ))}
          {insights?.rows.length === 0 && <tr><td colSpan={5} className="empty">No ad activity in this date range.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

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

const CHART_COLORS = ['var(--accent)', 'var(--call)', 'var(--warning)', 'var(--danger)', 'var(--cyan)', 'var(--violet)'];

/** Donut chart — plain SVG (no charting library), colored from the fixed CHART_COLORS palette so
 * every pie on the Dashboard reads consistently. Renders a legend with counts/percentages
 * alongside rather than relying on hover tooltips, since this is meant to be scannable at a
 * glance for a manager, not explored slice by slice. */
function PieChart({ rows, size = 140 }: { rows: { label: string; count: number }[]; size?: number }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (total === 0) return <div className="empty">No data yet.</div>;
  const radius = size / 2;
  const innerRadius = radius * 0.55;
  let cumulative = 0;
  const point = (angle: number, r: number) => [radius + r * Math.sin(angle), radius - r * Math.cos(angle)];
  const slices = rows.filter((r) => r.count > 0).map((r, i) => {
    const startAngle = (cumulative / total) * 2 * Math.PI;
    cumulative += r.count;
    const endAngle = (cumulative / total) * 2 * Math.PI;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = point(startAngle, radius);
    const [x2, y2] = point(endAngle, radius);
    const [ix1, iy1] = point(endAngle, innerRadius);
    const [ix2, iy2] = point(startAngle, innerRadius);
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    return { ...r, path, color: CHART_COLORS[i % CHART_COLORS.length]! };
  });
  return (
    <div className="pie-chart-row">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        {slices.map((s) => <path key={s.label} d={s.path} fill={s.color} />)}
      </svg>
      <div className="pie-chart-legend">
        {slices.map((s) => (
          <div key={s.label} className="pie-chart-legend-row">
            <span className="pie-chart-swatch" style={{ background: s.color }} />
            <span className="pie-chart-legend-label">{s.label}</span>
            <span className="pie-chart-legend-value">{s.count} ({Math.round((s.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Vertical bar chart for a handful of categories (e.g. template usage) — visually distinct from
 * BarList's horizontal rows, closer to a classic "chart" a manager would expect in a report tab. */
function BarChart({ rows, height = 140 }: { rows: { label: string; count: number }[]; height?: number }) {
  if (rows.length === 0) return <div className="empty">No data yet.</div>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bar-chart-row" style={{ height }}>
      {rows.map((r, i) => (
        <div key={r.label} className="bar-chart-col">
          <span className="bar-chart-value">{r.count}</span>
          <div className="bar-chart-fill" style={{ height: `${(r.count / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
          <span className="bar-chart-label" title={r.label}>{r.label}</span>
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

          <AdPerformanceCard />

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

          <div className="dashboard-grid">
            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Conversation status</h2>
              <PieChart rows={[
                { label: 'Open', count: metrics.conversations.open },
                { label: 'Needs reply', count: metrics.conversations.needsResponse },
                { label: 'Unassigned', count: metrics.conversations.unassigned },
                { label: 'Resolved', count: metrics.conversations.resolved },
              ]} />
            </div>

            <div className="card">
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

            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Customer stage distribution</h2>
              <PieChart rows={metrics.stageDistribution.map((s) => ({ label: s.name, count: s.count }))} />
            </div>

            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Template usage</h2>
              <BarChart rows={metrics.templateUsage.map((t) => ({ label: t.name, count: t.count }))} />
            </div>

            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Lead conversion</h2>
              <div className="cust-fields" style={{ padding: 0, border: 'none' }}>
                <div className="field-row"><span className="field-label">Customers with a stage</span><span className="field-value">{metrics.leadConversion.totalCustomersWithStage}</span></div>
                <div className="field-row"><span className="field-label">Won</span><span className="field-value">{metrics.leadConversion.wonCount}</span></div>
                <div className="field-row"><span className="field-label">Conversion rate</span><span className="field-value">{metrics.leadConversion.conversionRate === null ? '—' : `${metrics.leadConversion.conversionRate}%`}</span></div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
