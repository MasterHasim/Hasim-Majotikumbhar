import { Fragment, useEffect, useState } from 'react';
import type { AuditEntry, NumberAccess, NumberAssignmentConfig, NumberAssignmentUser, QuickReply, Role, Team, TeamMember, Template, User, WhatsAppNumber } from '../types';
import { backendApi } from '../lib/backendApi';
import { ApiClientError } from '../lib/api';

function errMsg(err: unknown): string {
  return err instanceof ApiClientError ? `${err.code}: ${err.message}` : String(err);
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------

function UsersTab({ roles }: { roles: Role[] }) {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listUsers().then(setUsers).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().then(() => reload()).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  function toggleRole(userId: string, roleId: string, current: string[]) {
    const next = current.includes(roleId) ? current.filter((r) => r !== roleId) : [...current, roleId];
    void guard(() => backendApi.updateUser(userId, { roleIds: next }));
  }

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Users</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Roles</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.email}</td>
                <td>
                  <input
                    defaultValue={u.phone}
                    style={{ width: 130 }}
                    onBlur={(e) => { if (e.target.value !== u.phone) void guard(() => backendApi.updateUser(u.id, { phone: e.target.value })); }}
                  />
                </td>
                <td>
                  <select value={u.status} onChange={(e) => void guard(() => backendApi.updateUser(u.id, { status: e.target.value }))}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                    <option value="suspended">suspended</option>
                  </select>
                </td>
                <td>
                  {roles.map((r) => (
                    <label key={r.id} className="inline" style={{ marginRight: 8 }}>
                      <input type="checkbox" checked={u.roleIds.includes(r.id)} disabled={busy} onChange={() => toggleRole(u.id, r.id, u.roleIds)} />
                      {r.key}
                    </label>
                  ))}
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="empty">No users yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {roles.map((r) => (
          <label key={r.id} className="inline">
            <input
              type="checkbox"
              checked={newRoleIds.includes(r.id)}
              onChange={(e) => setNewRoleIds((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)))}
            />
            {r.key}
          </label>
        ))}
        <button
          className="btn primary"
          disabled={busy || !email.trim() || !displayName.trim()}
          onClick={() => {
            const input = { email: email.trim(), displayName: displayName.trim(), roleIds: newRoleIds };
            setEmail('');
            setDisplayName('');
            setNewRoleIds([]);
            void guard(() => backendApi.createUser(input));
          }}
        >
          Add user
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamsTab({ users, roles }: { users: User[]; roles: Role[] }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Record<string, TeamMember[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [newMemberUserId, setNewMemberUserId] = useState('');
  const [newMemberNumberIds, setNewMemberNumberIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteManagerRoleId = roles.find((r) => r.key === 'SITE_MANAGER')?.id;
  const siteManagers = siteManagerRoleId ? users.filter((u) => u.roleIds.includes(siteManagerRoleId)) : [];

  function reload() {
    backendApi.listTeams().then(setTeams).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  function loadMembers(teamId: string) {
    backendApi.listTeamMembers(teamId).then((m) => setMembers((prev) => ({ ...prev, [teamId]: m }))).catch((err) => setError(errMsg(err)));
  }

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().finally(() => setBusy(false));
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Teams</h2>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Owner</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {teams.map((t) => (
            <Fragment key={t.id}>
              <tr className="clickable" onClick={() => { setExpanded(expanded === t.id ? null : t.id); if (!members[t.id]) loadMembers(t.id); }}>
                <td>{t.name}</td>
                <td>{userName(t.ownerUserId)}</td>
                <td>{t.status}</td>
                <td>{expanded === t.id ? '▾' : '▸'}</td>
              </tr>
              {expanded === t.id && (
                <tr>
                  <td colSpan={4} style={{ background: 'var(--bg)' }}>
                    <div style={{ padding: 8 }}>
                      <strong style={{ fontSize: 12 }}>Members</strong>
                      <table className="data-table" style={{ marginTop: 6 }}>
                        <thead><tr><th>User</th><th>Numbers scope</th><th>Active</th></tr></thead>
                        <tbody>
                          {(members[t.id] ?? []).map((m) => (
                            <tr key={m.id}>
                              <td>{userName(m.userId)}</td>
                              <td>{m.numberIds.length ? m.numberIds.join(', ') : 'all granted numbers'}</td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={m.status === 'active'}
                                  disabled={busy}
                                  onChange={(e) => void guard(() => backendApi.updateTeamMember(m.id, { status: e.target.checked ? 'active' : 'inactive' })).then(() => loadMembers(t.id))}
                                />
                              </td>
                            </tr>
                          ))}
                          {(members[t.id] ?? []).length === 0 && <tr><td colSpan={3} className="empty">No members yet.</td></tr>}
                        </tbody>
                      </table>
                      <div className="form-row" style={{ marginTop: 6 }}>
                        <select value={newMemberUserId} onChange={(e) => setNewMemberUserId(e.target.value)}>
                          <option value="">Add member…</option>
                          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                        </select>
                        <input placeholder="numberIds (comma-separated, blank = all)" style={{ minWidth: 220 }} value={newMemberNumberIds} onChange={(e) => setNewMemberNumberIds(e.target.value)} />
                        <button
                          className="btn"
                          disabled={busy || !newMemberUserId}
                          onClick={() => {
                            const userId = newMemberUserId;
                            const numberIds = newMemberNumberIds.split(',').map((s) => s.trim()).filter(Boolean);
                            setNewMemberUserId('');
                            setNewMemberNumberIds('');
                            void guard(() => backendApi.addTeamMember({ teamId: t.id, userId, numberIds })).then(() => loadMembers(t.id));
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {teams.length === 0 && <tr><td colSpan={4} className="empty">No teams yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
          <option value="">Owner (must be a SITE_MANAGER)…</option>
          {siteManagers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
        <button
          className="btn primary"
          disabled={busy || !name.trim() || !ownerUserId}
          onClick={() => {
            const input = { name: name.trim(), ownerUserId };
            setName('');
            setOwnerUserId('');
            void guard(() => backendApi.createTeam(input)).then(reload);
          }}
        >
          Create team
        </button>
      </div>
      {siteManagers.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No user has the SITE_MANAGER role yet — grant it in the Users tab first.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NumbersTab() {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listNumbers().then(setNumbers).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().then(reload).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>WhatsApp Numbers</h2>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Phone</th><th>Active</th></tr></thead>
        <tbody>
          {numbers.map((n) => (
            <tr key={n.id}>
              <td>
                <input defaultValue={n.displayName} onBlur={(e) => { if (e.target.value !== n.displayName) void guard(() => backendApi.updateNumber(n.id, { displayName: e.target.value })); }} />
              </td>
              <td>{n.phoneNumber}</td>
              <td><input type="checkbox" checked={n.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateNumber(n.id, { active: e.target.checked }))} /></td>
            </tr>
          ))}
          {numbers.length === 0 && <tr><td colSpan={3} className="empty">None yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input placeholder="Phone number" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
        <button
          className="btn primary"
          disabled={busy || !displayName.trim() || !phoneNumber.trim()}
          onClick={() => {
            const input = { displayName: displayName.trim(), phoneNumber: phoneNumber.trim(), provider: 'exotel' };
            setDisplayName('');
            setPhoneNumber('');
            void guard(() => backendApi.createNumber(input));
          }}
        >
          Add number
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NumberAccessTab({ users, numbers }: { users: User[]; numbers: WhatsAppNumber[] }) {
  const [grants, setGrants] = useState<NumberAccess[]>([]);
  const [userId, setUserId] = useState('');
  const [numberId, setNumberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listNumberAccess().then(setGrants).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().then(reload).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;
  const numberName = (id: string) => numbers.find((n) => n.id === id)?.displayName ?? id;

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Number Access</h2>
      <table className="data-table">
        <thead><tr><th>User</th><th>Number</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {grants.map((g) => (
            <tr key={g.id}>
              <td>{userName(g.userId)}</td>
              <td>{numberName(g.numberId)}</td>
              <td>{g.status === 'active' && g.granted ? 'granted' : 'revoked'}</td>
              <td>
                {g.status === 'active' ? (
                  <button className="btn" disabled={busy} onClick={() => void guard(() => backendApi.revokeNumberAccess(g.id))}>Revoke</button>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => void guard(() => backendApi.reactivateNumberAccess(g.id))}>Reactivate</button>
                )}
              </td>
            </tr>
          ))}
          {grants.length === 0 && <tr><td colSpan={4} className="empty">None yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">User…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </select>
        <select value={numberId} onChange={(e) => setNumberId(e.target.value)}>
          <option value="">Number…</option>
          {numbers.map((n) => <option key={n.id} value={n.id}>{n.displayName}</option>)}
        </select>
        <button
          className="btn primary"
          disabled={busy || !userId || !numberId}
          onClick={() => {
            const u = userId, n = numberId;
            setUserId('');
            setNumberId('');
            void guard(() => backendApi.grantNumberAccess(u, n));
          }}
        >
          Grant
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AssignmentRulesTab({ users, numbers }: { users: User[]; numbers: WhatsAppNumber[] }) {
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? '');
  const [config, setConfig] = useState<NumberAssignmentConfig | null>(null);
  const [participants, setParticipants] = useState<NumberAssignmentUser[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    if (!numberId) return;
    backendApi.getNumberAssignmentConfig(numberId).then(setConfig).catch(() => setConfig(null));
    backendApi.listNumberAssignmentParticipants(numberId).then(setParticipants).catch(() => setParticipants([]));
  }
  useEffect(reload, [numberId]);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().then(reload).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;
  const available = users.filter((u) => !participants.some((p) => p.userId === u.id));

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Assignment Rules (round-robin)</h2>
      <div className="form-row">
        <select value={numberId} onChange={(e) => setNumberId(e.target.value)}>
          {numbers.map((n) => <option key={n.id} value={n.id}>{n.displayName}</option>)}
        </select>
      </div>

      {numberId && (
        <>
          <div className="form-row">
            <label className="inline">
              <input type="checkbox" checked={config?.roundRobinEnabled ?? false} disabled={busy} onChange={(e) => void guard(() => backendApi.setNumberAssignmentConfig(numberId, { roundRobinEnabled: e.target.checked }))} />
              Round-robin enabled
            </label>
            <label className="inline">
              Fallback agent:
              <select value={config?.fallbackUserId ?? ''} disabled={busy} onChange={(e) => void guard(() => backendApi.setNumberAssignmentConfig(numberId, { fallbackUserId: e.target.value }))}>
                <option value="">None (leave unassigned)</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="inline">
              Working hours:
              <input type="time" defaultValue={config?.workingHoursStart ?? ''} onBlur={(e) => void guard(() => backendApi.setNumberAssignmentConfig(numberId, { workingHoursStart: e.target.value }))} />
              to
              <input type="time" defaultValue={config?.workingHoursEnd ?? ''} onBlur={(e) => void guard(() => backendApi.setNumberAssignmentConfig(numberId, { workingHoursEnd: e.target.value }))} />
              (blank = no restriction)
            </label>
          </div>

          {error && <div className="form-error">{error}</div>}

          <h2 className="section-title">Participants (rotation order)</h2>
          <table className="data-table">
            <thead><tr><th>Agent</th><th>Active</th></tr></thead>
            <tbody>
              {participants.sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((p) => (
                <tr key={p.id}>
                  <td>{userName(p.userId)}</td>
                  <td><input type="checkbox" checked={p.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateNumberAssignmentParticipant(p.id, { active: e.target.checked }))} /></td>
                </tr>
              ))}
              {participants.length === 0 && <tr><td colSpan={2} className="empty">None yet.</td></tr>}
            </tbody>
          </table>
          <div className="form-row">
            <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)}>
              <option value="">Add agent…</option>
              {available.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
            <button
              className="btn primary"
              disabled={busy || !newUserId}
              onClick={() => {
                const u = newUserId;
                setNewUserId('');
                void guard(() => backendApi.addNumberAssignmentParticipant(numberId, u, participants.length + 1));
              }}
            >
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuditLogTab({ users }: { users: User[] }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.listAuditLog().then(setEntries).catch((err) => setError(errMsg(err)));
  }, []);

  const userName = (id: string | null) => (id ? users.find((u) => u.id === id)?.displayName ?? id : 'system');

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Audit Log</h2>
      {error && <div className="form-error">{error}</div>}
      <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
          <tbody>
            {entries.slice(0, 300).map((e) => (
              <tr key={e.id}>
                <td>{fmt(e.occurredAt)}</td>
                <td>{userName(e.actorUserId)}</td>
                <td>{e.action}</td>
                <td>{e.targetType} / {e.targetId}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={4} className="empty">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {entries.length > 300 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Showing the 300 most recent of {entries.length} entries.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

type AdminTab = 'users' | 'teams' | 'numbers' | 'access' | 'assignment' | 'quickReplies' | 'templates' | 'audit';

export function Admin() {
  const [tab, setTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);

  useEffect(() => {
    backendApi.listUsers().then(setUsers).catch(() => setUsers([]));
    backendApi.listRoles().then(setRoles).catch(() => setRoles([]));
    backendApi.listNumbers().then(setNumbers).catch(() => setNumbers([]));
  }, [tab]);

  return (
    <>
      <h1 className="page-title">Admin</h1>
      <div className="settings-tabs">
        {([
          ['users', 'Users'], ['teams', 'Teams'], ['numbers', 'Numbers'], ['access', 'Number Access'],
          ['assignment', 'Assignment Rules'], ['quickReplies', 'Quick Replies'], ['templates', 'Templates'], ['audit', 'Audit Log'],
        ] as [AdminTab, string][]).map(([key, label]) => (
          <button key={key} className={`settings-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'users' && <UsersTab roles={roles} />}
      {tab === 'teams' && <TeamsTab users={users} roles={roles} />}
      {tab === 'numbers' && <NumbersTab />}
      {tab === 'access' && <NumberAccessTab users={users} numbers={numbers} />}
      {tab === 'assignment' && <AssignmentRulesTab users={users} numbers={numbers} />}
      {tab === 'quickReplies' && <QuickRepliesSection />}
      {tab === 'templates' && <TemplatesSection />}
      {tab === 'audit' && <AuditLogTab users={users} />}
    </>
  );
}
