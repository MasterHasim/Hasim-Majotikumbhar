/** Plain-SVG chart primitives shared by Dashboard and Home — no charting library, colored from
 * one fixed palette so every pie/bar across the app reads consistently. Extracted 2026-08-24
 * when Home needed the same PieChart/BarChart Dashboard already had. */
export const CHART_COLORS = ['var(--accent)', 'var(--call)', 'var(--warning)', 'var(--danger)', 'var(--cyan)', 'var(--violet)'];

/** Donut chart — renders a legend with counts/percentages alongside rather than relying on
 * hover tooltips, since this is meant to be scannable at a glance for a manager, not explored
 * slice by slice. */
export function PieChart({ rows, size = 140 }: { rows: { label: string; count: number }[]; size?: number }) {
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

/** Vertical bar chart for a handful of categories — visually distinct from BarList's horizontal
 * rows, closer to a classic "chart" a manager would expect in a report tab. */
export function BarChart({ rows, height = 140 }: { rows: { label: string; count: number }[]; height?: number }) {
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
