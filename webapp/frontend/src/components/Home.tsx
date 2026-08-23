import { useEffect, useState } from 'react';
import type { HomeMetrics } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';
import { PieChart, BarChart } from './Charts';

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
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

/** The strategic, cross-location landing screen (default on sign-in) — a counterpart to
 * Dashboard's per-number operational reporting. Covers factors Dashboard doesn't: where leads
 * are coming from, whether placed calls actually connect, and how much is sitting in the sales
 * pipeline. See Phase22Api.getHomeMetrics for the exact scoping (reuses listLeads()'s existing
 * manager/agent + location authorization, so this never shows more than the signed-in user
 * could already see elsewhere). */
export function Home() {
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.getHomeMetrics().then(setMetrics).catch((err) => setError(errMsg(err)));
  }, []);

  const totalLeads = metrics ? metrics.leadsByLocation.reduce((sum, r) => sum + r.count, 0) : 0;
  const answered = metrics?.callOutcomes.find((c) => c.label === 'Answered')?.count ?? 0;
  const missed = metrics?.callOutcomes.find((c) => c.label === 'Missed')?.count ?? 0;
  const pipelineValue = metrics ? metrics.quotationPipeline.reduce((sum, p) => sum + p.totalValue, 0) : 0;

  return (
    <>
      <h1 className="page-title">Home</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -8 }}>
        A business-wide overview across every location you can access — see Dashboard for per-number conversation reporting.
      </p>
      {error && <div className="compose-error" style={{ padding: '0 0 10px' }}>{error}</div>}
      {!metrics ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</p>
      ) : (
        <>
          <div className="kpi-row">
            <Kpi icon="📍" label="Total leads" value={totalLeads} />
            <Kpi icon="✅" label="Calls answered" value={answered} />
            <Kpi icon="📵" label="Calls missed" value={missed} />
            <Kpi icon="💰" label="Pipeline value" value={currency(pipelineValue)} />
          </div>

          <div className="dashboard-grid">
            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Leads by location</h2>
              <BarChart rows={metrics.leadsByLocation.map((l) => ({ label: l.location, count: l.count }))} />
            </div>

            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Call outcomes</h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Calls placed directly from a Lead, matched to their real Exotel status where it's arrived yet.
              </p>
              <PieChart rows={metrics.callOutcomes.map((c) => ({ label: c.label, count: c.count }))} />
            </div>

            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Sales pipeline</h2>
              <table className="data-table">
                <thead><tr><th>Status</th><th>Quotations</th><th>Value</th></tr></thead>
                <tbody>
                  {metrics.quotationPipeline.map((p) => (
                    <tr key={p.status}><td>{p.status}</td><td>{p.count}</td><td>{currency(p.totalValue)}</td></tr>
                  ))}
                  {metrics.quotationPipeline.length === 0 && <tr><td colSpan={3} className="empty">No quotations yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
