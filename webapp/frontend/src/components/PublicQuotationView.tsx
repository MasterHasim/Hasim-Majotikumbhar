import { useEffect, useState } from 'react';
import type { PublicQuotationView as PublicQuotationViewData } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * The customer-facing quotation link shared over WhatsApp — a plain, unauthenticated, printable
 * page (no sidebar, no app shell). "Default for now" per an explicit product decision: a
 * custom-branded template is a later, separate piece of work, not this one.
 */
export function PublicQuotationView({ quotationId }: { quotationId: string }) {
  const [data, setData] = useState<PublicQuotationViewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.getPublicQuotation(quotationId)
      .then(setData)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : String(err)));
  }, [quotationId]);

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, fontFamily: 'var(--font-body, sans-serif)', textAlign: 'center' }}>
        <p>This quotation link is no longer valid.</p>
      </div>
    );
  }
  if (!data) {
    return <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, textAlign: 'center' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '24px 28px', fontFamily: 'var(--font-body, sans-serif)', color: '#1a1a1a', background: '#fff' }}>
      <style>{'@media print { .no-print { display: none; } body { background: #fff; } }'}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #1a1a1a', paddingBottom: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Quotation</div>
          <div style={{ fontSize: 13, color: '#555' }}>{data.numberDisplayName}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, color: '#555' }}>
          <div>For: {data.leadName}</div>
          <div>{fmtDate(data.createdAt)}</div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '6px 4px' }}>Item</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Price</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Disc.</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lineItems.map((item, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '6px 4px' }}>{item.productName}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{currency(item.unitPrice)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{item.discountPercent ? `${item.discountPercent}%` : '—'}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{currency(item.unitPrice * item.quantity * (1 - item.discountPercent / 100))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, marginLeft: 'auto', width: 240, fontSize: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Subtotal</span><span>{currency(data.totals.subtotal)}</span></div>
        {data.overallDiscountPercent > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Discount ({data.overallDiscountPercent}%)</span><span>-{currency(data.totals.overallDiscountAmount)}</span></div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '2px solid #1a1a1a', marginTop: 4, fontWeight: 700, fontSize: 16 }}>
          <span>Total</span><span>{currency(data.totals.total)}</span>
        </div>
      </div>

      {data.notes && (
        <div style={{ marginTop: 20, fontSize: 13, color: '#555', whiteSpace: 'pre-wrap' }}>{data.notes}</div>
      )}

      <button className="no-print" style={{ marginTop: 28, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }} onClick={() => window.print()}>Print / Save as PDF</button>
    </div>
  );
}
