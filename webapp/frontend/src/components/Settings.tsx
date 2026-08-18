import { useEffect, useState } from 'react';
import type { QuickReply, Template } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

function QuickRepliesSection() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listQuickReplies().then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await backendApi.createQuickReply({ shortcut: shortcut.trim(), text: text.trim() });
      setShortcut('');
      setText('');
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Quick Replies</h2>
      <table className="data-table">
        <thead><tr><th>Shortcut</th><th>Text</th><th>Active</th></tr></thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.id}>
              <td>{q.shortcut}</td>
              <td>{q.text}</td>
              <td>
                <input
                  type="checkbox"
                  checked={q.active}
                  onChange={(e) => backendApi.updateQuickReply(q.id, { active: e.target.checked }).then(reload).catch((err) => setError(errMsg(err)))}
                />
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={3} className="empty">None yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Shortcut (e.g. /hi)" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
        <input placeholder="Reply text" style={{ flex: 1, minWidth: 200 }} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" disabled={busy || !shortcut.trim() || !text.trim()} onClick={() => void create()}>Add</button>
      </div>
    </div>
  );
}

function TemplatesSection() {
  const [items, setItems] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [category, setCategory] = useState('MARKETING');
  const [wabaId, setWabaId] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [syncWabaId, setSyncWabaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reload() {
    backendApi.listTemplates().then(setItems).catch(() => setItems([]));
  }
  useEffect(reload, []);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    return fn().then(() => reload()).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  async function createDraft() {
    await guard(async () => {
      await backendApi.createDraftTemplate({ name: name.trim(), language: language.trim(), category: category.trim(), wabaId: wabaId.trim(), components: bodyText.trim() ? [{ type: 'BODY', text: bodyText.trim() }] : [] });
      setName('');
      setBodyText('');
    });
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>WhatsApp Templates</h2>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.language}</td>
              <td>{t.category}</td>
              <td><span className="lead-status-tag ASSIGNED">{t.status}</span></td>
              <td>
                {t.status === 'LOCAL_DRAFT' && (
                  <button className="btn" disabled={busy || !t.wabaId} title={t.wabaId ? '' : 'Set a wabaId first'} onClick={() => void guard(() => backendApi.submitTemplateForReview(t.id))}>
                    Submit for review
                  </button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={5} className="empty">None yet.</td></tr>}
        </tbody>
      </table>

      {error && <div className="form-error">{error}</div>}
      {notice && <p style={{ fontSize: 12 }}>{notice}</p>}

      <h2 className="section-title">Create a draft</h2>
      <div className="form-row">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Language (e.g. en)" style={{ width: 90 }} value={language} onChange={(e) => setLanguage(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utility</option>
          <option value="AUTHENTICATION">Authentication</option>
        </select>
        <input placeholder="WABA ID (needed to submit)" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
      </div>
      <div className="form-row">
        <textarea rows={2} style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Body text — use {{1}}, {{2}} for variables" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
      </div>
      <div className="form-row">
        <button className="btn primary" disabled={busy || !name.trim() || !language.trim() || !category.trim()} onClick={() => void createDraft()}>Create draft</button>
      </div>

      <h2 className="section-title">Sync from Exotel</h2>
      <div className="form-row">
        <input placeholder="WABA ID" value={syncWabaId} onChange={(e) => setSyncWabaId(e.target.value)} />
        <button
          className="btn"
          disabled={busy || !syncWabaId.trim()}
          onClick={() => void guard(async () => { const synced = await backendApi.syncTemplatesFromProvider(syncWabaId.trim()); setNotice(`Synced ${synced.length} template(s).`); })}
        >
          Sync
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  return (
    <>
      <h1 className="page-title">Settings</h1>
      <QuickRepliesSection />
      <TemplatesSection />
    </>
  );
}
