import { useEffect, useState } from 'react';
import type { Lead, Product, Quotation, QuotationLineItem } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

/** Mirrors Phase22Api's computeQuotationTotals — kept as a small local copy rather than a shared
 * import, same "frontend/backend kept independent" convention as this codebase's other types. */
function totals(lineItems: QuotationLineItem[], overallDiscountPercent: number) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity * (1 - item.discountPercent / 100), 0);
  const overallDiscountAmount = subtotal * (overallDiscountPercent / 100);
  return { subtotal, overallDiscountAmount, total: subtotal - overallDiscountAmount };
}

interface DraftLine { productId: string; quantity: number; discountPercent: number }

function draftFromQuotation(q: Quotation): DraftLine[] {
  return q.lineItems.map((li) => ({ productId: li.productId, quantity: li.quantity, discountPercent: li.discountPercent }));
}

export function QuotationBuilder({ lead, onOpenConversation }: {
  lead: Lead;
  onOpenConversation: (conversationId: string, numberId: string) => void;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [overallDiscountPercent, setOverallDiscountPercent] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    backendApi.listProductsForLead(lead.id).then(setProducts).catch(() => setProducts([]));
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  function reload() {
    backendApi.listQuotations(lead.id).then(setQuotations).catch(() => setQuotations([]));
  }

  function errMsg(err: unknown): string {
    return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
  }

  function startNew() {
    setEditingId('new');
    setDraftLines(products && products[0] ? [{ productId: products[0].id, quantity: 1, discountPercent: 0 }] : []);
    setOverallDiscountPercent(0);
    setNotes('');
    setError(null);
  }

  function startEdit(q: Quotation) {
    setEditingId(q.id);
    setDraftLines(draftFromQuotation(q));
    setOverallDiscountPercent(q.overallDiscountPercent);
    setNotes(q.notes);
    setError(null);
  }

  function addLine() {
    if (!products || products.length === 0) return;
    setDraftLines((prev) => [...prev, { productId: products[0]!.id, quantity: 1, discountPercent: 0 }]);
  }

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setDraftLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (draftLines.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input = { lineItems: draftLines, overallDiscountPercent, notes };
      if (editingId === 'new') await backendApi.createQuotation(lead.id, input);
      else await backendApi.updateQuotation(editingId!, input);
      setEditingId(null);
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function share(q: Quotation) {
    setBusy(true);
    setError(null);
    setShareNote(null);
    try {
      const link = `${window.location.origin}/quote/${q.id}`;
      const message = `Here's your quotation: ${link}`;
      await navigator.clipboard.writeText(message).catch(() => undefined);
      if (q.status !== 'SENT') await backendApi.updateQuotation(q.id, { status: 'SENT' });
      const result = await backendApi.startWhatsAppFromLead(lead.id);
      setShareNote('Link copied — paste it into the chat to send.');
      reload();
      onOpenConversation(result.conversationId, result.numberId);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const preview = totals(
    draftLines.map((line) => {
      const product = products?.find((p) => p.id === line.productId);
      return { productId: line.productId, productName: product?.name || '', unitPrice: product?.unitPrice || 0, quantity: line.quantity, discountPercent: line.discountPercent };
    }),
    overallDiscountPercent
  );

  return (
    <div>
      {shareNote && <div className="form-error" style={{ color: 'var(--accent)' }}>{shareNote}</div>}
      {editingId === null && (
        <>
          {quotations === null && <div className="empty">Loading…</div>}
          {quotations?.length === 0 && <div className="empty">No quotations yet.</div>}
          {quotations?.map((q) => (
            <div key={q.id} className="lead-remark-item">
              <div>
                {q.lineItems.map((li) => `${li.quantity}× ${li.productName}`).join(', ')}
                {' — '}
                <strong>{currency(totals(q.lineItems, q.overallDiscountPercent).total)}</strong>
                {' '}<span className={`lead-status-tag ${q.status}`}>{q.status}</span>
              </div>
              <div className="lead-remark-meta form-row" style={{ marginTop: 4 }}>
                <button className="btn" onClick={() => window.open(`/quote/${q.id}`, '_blank')}>View</button>
                <button className="btn" onClick={() => startEdit(q)}>Edit</button>
                <button className="btn primary" disabled={busy} onClick={() => void share(q)}>Share via WhatsApp</button>
              </div>
            </div>
          ))}
          {(products?.length ?? 0) > 0 ? (
            <button className="btn" style={{ marginTop: 8 }} onClick={startNew}>+ New quotation</button>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No products in the catalog for this lead's number yet — add some under Admin → Products.</p>
          )}
        </>
      )}

      {editingId !== null && (
        <div>
          {draftLines.map((line, idx) => {
            const product = products?.find((p) => p.id === line.productId);
            return (
              <div className="form-row" key={idx}>
                <select style={{ flex: 1 }} value={line.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })}>
                  {products?.map((p) => <option key={p.id} value={p.id}>{p.name} ({currency(p.unitPrice)})</option>)}
                </select>
                <input type="number" min="1" style={{ width: 60 }} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })} />
                <input type="number" min="0" max="100" placeholder="Disc %" style={{ width: 70 }} value={line.discountPercent} onChange={(e) => updateLine(idx, { discountPercent: Number(e.target.value) })} />
                <span style={{ fontSize: 12, minWidth: 70, textAlign: 'right' }}>{product ? currency(product.unitPrice * line.quantity * (1 - line.discountPercent / 100)) : ''}</span>
                <button className="btn" onClick={() => removeLine(idx)}>✕</button>
              </div>
            );
          })}
          <button className="btn" onClick={addLine}>+ Add line</button>

          <div className="form-row" style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>Overall discount %</label>
            <input type="number" min="0" max="100" style={{ width: 70 }} value={overallDiscountPercent} onChange={(e) => setOverallDiscountPercent(Number(e.target.value))} />
          </div>
          <div className="form-row">
            <textarea rows={2} placeholder="Notes (optional)" style={{ width: '100%', boxSizing: 'border-box' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div style={{ fontSize: 13, margin: '6px 0' }}>
            Subtotal: {currency(preview.subtotal)} · Discount: -{currency(preview.overallDiscountAmount)} · <strong>Total: {currency(preview.total)}</strong>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="form-row">
            <button className="btn primary" disabled={busy || draftLines.length === 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save quotation'}</button>
            <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
