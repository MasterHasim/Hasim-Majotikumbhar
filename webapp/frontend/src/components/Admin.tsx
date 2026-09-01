import { Fragment, useEffect, useState } from 'react';
import type { AdAccount, AssignmentEligibilityStatus, AuditEntry, AutoDialerSettings, ChatbotConnectionStatus, CustomFieldDefinition, CustomFieldEntityType, CustomFieldType, NumberAccess, NumberAssignmentConfig, NumberAssignmentUser, Product, QuickReply, Role, Stage, Team, TeamMember, Template, User, WhatsAppNumber, WhoAmI } from '../types';
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

function UsersTab({ roles, numbers }: { roles: Role[]; numbers: WhatsAppNumber[] }) {
  /** null = not loaded yet, [] = loaded and genuinely empty — without this distinction the
   * table shows "No users yet." during the fetch too, which reads as data loss on a slow load. */
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<Record<string, string>>({});
  const [welcomeNumberId, setWelcomeNumberId] = useState('');
  const [welcomeNumberBusy, setWelcomeNumberBusy] = useState(false);
  const [welcomeNumberSaved, setWelcomeNumberSaved] = useState(false);

  useEffect(() => {
    backendApi.getNotificationSettings().then((s) => setWelcomeNumberId(s.welcomeWhatsAppNumberId ?? '')).catch(() => {});
  }, []);

  function saveWelcomeNumber(numberId: string) {
    setWelcomeNumberId(numberId);
    setWelcomeNumberSaved(false);
    setWelcomeNumberBusy(true);
    backendApi.updateNotificationSettings({ welcomeWhatsAppNumberId: numberId })
      .then(() => setWelcomeNumberSaved(true))
      .catch((err) => setError(errMsg(err)))
      .finally(() => setWelcomeNumberBusy(false));
  }

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

  function sendWelcomeEmail(userId: string) {
    setEmailStatus((prev) => ({ ...prev, [userId]: '…' }));
    backendApi.sendWelcomeEmail(userId)
      .then(() => setEmailStatus((prev) => ({ ...prev, [userId]: 'Sent!' })))
      .catch((err) => setEmailStatus((prev) => ({ ...prev, [userId]: errMsg(err) })));
  }

  return (
    <div className="card" style={{ maxWidth: 'none' }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Users</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Roles</th><th></th></tr></thead>
          <tbody>
            {users === null && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
            {users?.map((u) => (
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
                <td>
                  <button className="btn" style={{ fontSize: 11 }} disabled={emailStatus[u.id] === '…'} onClick={() => sendWelcomeEmail(u.id)}>
                    Send welcome email
                  </button>
                  {emailStatus[u.id] && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{emailStatus[u.id]}</div>}
                </td>
              </tr>
            ))}
            {users?.length === 0 && <tr><td colSpan={6} className="empty">No users yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input placeholder="Phone (for WhatsApp welcome)" style={{ width: 170 }} value={phone} onChange={(e) => setPhone(e.target.value)} />
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
            const input = { email: email.trim(), displayName: displayName.trim(), phone: phone.trim(), roleIds: newRoleIds };
            setEmail('');
            setDisplayName('');
            setPhone('');
            setNewRoleIds([]);
            void guard(() => backendApi.createUser(input));
          }}
        >
          Add user
        </button>
      </div>

      <h2 className="section-title">Notification settings</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -6 }}>
        Which number sends the "you've been added" WhatsApp welcome message to a new team member. Leave on Auto to infer it from
        whichever number's WABA has an APPROVED <code>team_member_welcome</code> template — pick a specific number if more than one
        WABA might ever have that template approved, so it's unambiguous which one is meant.
      </p>
      <div className="form-row" style={{ alignItems: 'center' }}>
        <select value={welcomeNumberId} disabled={welcomeNumberBusy} onChange={(e) => saveWelcomeNumber(e.target.value)}>
          <option value="">Auto (infer from template)</option>
          {numbers.filter((n) => n.active).map((n) => <option key={n.id} value={n.id}>{n.displayName} · {n.phoneNumber}</option>)}
        </select>
        {welcomeNumberSaved && !welcomeNumberBusy && <span style={{ fontSize: 12, color: 'var(--accent)' }}>Saved</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamsTab({ users, roles }: { users: User[]; roles: Role[] }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
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
          {teams === null && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
          {teams?.map((t) => (
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
                              <td>{(m.numberIds ?? []).length ? m.numberIds.join(', ') : 'all granted numbers'}</td>
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
          {teams?.length === 0 && <tr><td colSpan={4} className="empty">No teams yet.</td></tr>}
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
  const [numbers, setNumbers] = useState<WhatsAppNumber[] | null>(null);
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
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        WABA ID is the WhatsApp Business Account this number belongs to (Meta Business Manager →
        WhatsApp Accounts → the ID next to the account name — not the Business Portfolio ID, and
        not the phone number's own "Phone Profile" ID). Needed for Templates → Create/Sync.
      </p>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Phone</th><th>WABA ID</th><th>Chatbot</th><th>Active</th></tr></thead>
        <tbody>
          {numbers === null && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
          {numbers?.map((n) => (
            <tr key={n.id}>
              <td>
                <input defaultValue={n.displayName} onBlur={(e) => { if (e.target.value !== n.displayName) void guard(() => backendApi.updateNumber(n.id, { displayName: e.target.value })); }} />
              </td>
              <td>{n.phoneNumber}</td>
              <td>
                <input placeholder="e.g. 1960468407986497" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} defaultValue={n.wabaId} onBlur={(e) => { if (e.target.value !== n.wabaId) void guard(() => backendApi.updateNumber(n.id, { wabaId: e.target.value.trim() })); }} />
              </td>
              <td>
                <select value={n.chatbotMode ?? 'off'} disabled={busy} onChange={(e) => void guard(() => backendApi.updateNumber(n.id, { chatbotMode: e.target.value }))}>
                  <option value="off">Off — agents only</option>
                  <option value="shadow">Shadow — draft only</option>
                  <option value="active">Active — auto reply</option>
                  <option value="paused">Paused</option>
                </select>
              </td>
              <td><input type="checkbox" checked={n.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateNumber(n.id, { active: e.target.checked }))} /></td>
            </tr>
          ))}
          {numbers?.length === 0 && <tr><td colSpan={5} className="empty">None yet.</td></tr>}
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

function ChatbotTab({ numbers }: { numbers: WhatsAppNumber[] }) {
  const [numberId, setNumberId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [profileId, setProfileId] = useState('');
  const [status, setStatus] = useState<ChatbotConnectionStatus | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = numbers.find((number) => number.id === numberId) ?? null;

  useEffect(() => { if (!numberId && numbers[0]) setNumberId(numbers[0].id); }, [numberId, numbers]);
  useEffect(() => {
    setNewApiKey(null);
    setNewWebhookSecret(null);
    if (!selected) { setStatus(null); return; }
    setWebhookUrl(selected.chatbotWebhookUrl ?? '');
    setProfileId(selected.chatbotProfileId ?? '');
    backendApi.getChatbotConnectionStatus(selected.id).then(setStatus).catch((err) => setError(errMsg(err)));
  }, [selected?.id]);

  async function saveSettings() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await backendApi.updateNumber(selected.id, { chatbotWebhookUrl: webhookUrl.trim(), chatbotProfileId: profileId.trim() });
      setStatus(await backendApi.getChatbotConnectionStatus(selected.id));
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function rotateKey() {
    if (!selected || !window.confirm('Generate a new key? The previous key and webhook secret will stop working immediately.')) return;
    setBusy(true); setError(null);
    try {
      const result = await backendApi.rotateChatbotApiKey(selected.id);
      setNewApiKey(result.apiKey);
      setNewWebhookSecret(result.webhookSecret);
      setStatus(await backendApi.getChatbotConnectionStatus(selected.id));
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  const replyEndpoint = selected ? `${import.meta.env.VITE_API_BASE_URL}/api/integrations/chatbot/numbers/${encodeURIComponent(selected.id)}/reply` : '';
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>Chatbot Integration</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Configure the internal chatbot separately for each WhatsApp number. This screen never stores or re-displays its API key; copy a generated key once and give it only to the chatbot team.
      </p>
      <div className="form-row">
        <label>WhatsApp number</label>
        <select value={numberId} onChange={(e) => setNumberId(e.target.value)} disabled={busy}>
          {numbers.length === 0 && <option value="">No numbers available</option>}
          {numbers.map((number) => <option key={number.id} value={number.id}>{number.displayName} · {number.phoneNumber}</option>)}
        </select>
        {selected && <span className="pill">Mode: {selected.chatbotMode ?? 'off'}</span>}
      </div>
      {selected && <>
        <div className="form-row">
          <input style={{ flex: 1, minWidth: 300 }} placeholder="Chatbot incoming webhook URL (https://...)" value={webhookUrl} disabled={busy} onChange={(e) => setWebhookUrl(e.target.value)} />
          <input style={{ minWidth: 180 }} placeholder="Bot profile / agent ID" value={profileId} disabled={busy} onChange={(e) => setProfileId(e.target.value)} />
          <button className="btn primary" disabled={busy} onClick={() => void saveSettings()}>Save settings</button>
        </div>
        <div className="form-row" style={{ alignItems: 'center' }}>
          <button className="btn" disabled={busy} onClick={() => void rotateKey()}>{status?.apiKeyConfigured ? 'Rotate API key' : 'Generate API key'}</button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {status?.apiKeyConfigured ? `Configured (${status.apiKeyPrefix}…)` : 'No per-number key generated yet.'}
            {status?.keyLastRotatedAt ? ` · last changed ${fmt(status.keyLastRotatedAt)}` : ''}
          </span>
        </div>
        {newApiKey && <div className="form-row" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 12, minWidth: 110 }}>API key:</span>
          <code style={{ overflowWrap: 'anywhere', flex: 1 }}>{newApiKey}</code>
          <button className="btn primary" onClick={() => void copyText(newApiKey)}>Copy once</button>
        </div>}
        {newWebhookSecret && <div className="form-row" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 12, minWidth: 110 }}>Webhook secret:</span>
          <code style={{ overflowWrap: 'anywhere', flex: 1 }}>{newWebhookSecret}</code>
          <button className="btn primary" onClick={() => void copyText(newWebhookSecret)}>Copy once</button>
        </div>}
        {(newApiKey || newWebhookSecret) && <div className="form-row"><button className="btn" onClick={() => { setNewApiKey(null); setNewWebhookSecret(null); }}>Hide</button></div>}

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 4 }}>
          <strong>Outbound — we call the chatbot.</strong> Every inbound WhatsApp message on this number (while mode is <code>active</code> or <code>shadow</code>, and the conversation isn't handed off to a human) is POSTed as JSON to the webhook URL above, with a body of <code>{'{event, mode, numberId, conversationId, messageId, customerId, customerPhone, customerName, messageType, messageText, timestamp, isNewConversation, isNewCustomer}'}</code>. The request carries a <code>X-Chatbot-Signature: sha256=&lt;hex&gt;</code> header — an HMAC-SHA256 of the raw JSON body using the webhook secret above — so the bot can verify it's really from us before acting on it.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          <strong>Inbound — the chatbot calls us back.</strong> Give this callback URL and the API key to the chatbot team:
        </p>
        <code style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 12 }}>{replyEndpoint}</code>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Authenticated with header <code>Authorization: Bearer &lt;api key&gt;</code>, body must include <code>conversationId</code>, <code>inReplyToMessageId</code>, optional <code>reply</code>, and optional <code>handover</code>. Shadow mode records a safe activity only; active mode can deliver a bot reply and hand the chat to the team.
        </p>
        {status?.latestActivity && <div className="meta">Latest activity: {status.latestActivity.kind} · {status.latestActivity.detail} · {fmt(status.latestActivity.createdAt)}</div>}
      </>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NumberAccessTab({ users, numbers }: { users: User[]; numbers: WhatsAppNumber[] }) {
  const [grants, setGrants] = useState<NumberAccess[] | null>(null);
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
          {grants === null && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
          {grants?.map((g) => (
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
          {grants?.length === 0 && <tr><td colSpan={4} className="empty">None yet.</td></tr>}
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

/** getAssignmentEligibility's `assignmentEligible` field means "passes every gate" (grant +
 * availability + number access + team enablement) — not just "the grant exists". The
 * checkbox needs the raw grant alone, which isn't returned directly; these are the only two
 * reasons evaluate() can return before it even looks at the grant, so their absence means
 * a grant record with eligible:true exists, whatever else is still blocking assignment. */
function hasEligibilityGrant(status: AssignmentEligibilityStatus | undefined): boolean {
  if (!status) return false;
  if (status.assignmentEligible) return true;
  return status.reasons[0] !== 'ELIGIBILITY_NOT_GRANTED' && status.reasons[0] !== 'USER_INACTIVE';
}

function AssignmentRulesTab({ users, numbers }: { users: User[]; numbers: WhatsAppNumber[] }) {
  const [numberId, setNumberId] = useState(numbers[0]?.id ?? '');
  const [config, setConfig] = useState<NumberAssignmentConfig | null>(null);
  const [participants, setParticipants] = useState<NumberAssignmentUser[] | null>(null);
  const [eligibility, setEligibility] = useState<Record<string, AssignmentEligibilityStatus>>({});
  const [newUserId, setNewUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    if (!numberId) return;
    backendApi.getNumberAssignmentConfig(numberId).then(setConfig).catch(() => setConfig(null));
    backendApi.listNumberAssignmentParticipants(numberId).then((ps) => {
      setParticipants(ps);
      Promise.all(ps.map((p) => backendApi.getAssignmentEligibility(p.userId, numberId).then((status) => [p.userId, status] as const)))
        .then((pairs) => setEligibility(Object.fromEntries(pairs)))
        .catch(() => setEligibility({}));
    }).catch(() => setParticipants([]));
  }
  useEffect(reload, [numberId]);

  function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    return fn().then(reload).catch((err) => setError(errMsg(err))).finally(() => setBusy(false));
  }

  /** teamId is stored on the eligibility record but never read back by the evaluator (see
   * Phase1Api.evaluate — it keys purely on userId:numberId) and ADMIN's own authorization
   * path doesn't scope by it either, so any stable value works here; only a SITE_MANAGER/
   * SUPERVISOR-facing version of this control would need the caller's real team id. */
  function toggleEligible(userId: string, eligible: boolean) {
    void guard(() => backendApi.setAssignmentEligibility({ userId, numberId, teamId: 'admin', eligible }));
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;
  const available = users.filter((u) => !(participants ?? []).some((p) => p.userId === u.id));

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
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: -6 }}>
            "Eligible" is a separate on/off grant from "Active" — round-robin skips a participant entirely until they're explicitly marked eligible here, even if active. "Assignable now" also factors in their current Availability and number access, so it can say No even when Eligible is checked.
          </p>
          <table className="data-table">
            <thead><tr><th>Agent</th><th>Active</th><th>Eligible</th><th>Assignable now</th></tr></thead>
            <tbody>
              {participants === null && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
              {participants && [...participants].sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((p) => {
                const status = eligibility[p.userId];
                return (
                  <tr key={p.id}>
                    <td>{userName(p.userId)}</td>
                    <td><input type="checkbox" checked={p.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateNumberAssignmentParticipant(p.id, { active: e.target.checked }))} /></td>
                    <td><input type="checkbox" checked={hasEligibilityGrant(status)} disabled={busy} onChange={(e) => toggleEligible(p.userId, e.target.checked)} /></td>
                    <td>
                      {status ? (
                        <span className={`lead-status-tag ${status.assignableNow ? 'ASSIGNED' : 'UNASSIGNED'}`} title={status.reasons.join(', ')}>
                          {status.assignableNow ? 'Yes' : status.reasons[0] ?? 'No'}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {participants?.length === 0 && <tr><td colSpan={4} className="empty">None yet.</td></tr>}
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
                void guard(() => backendApi.addNumberAssignmentParticipant(numberId, u, (participants ?? []).length + 1));
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
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
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
            {entries === null && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
            {entries?.slice(0, 300).map((e) => (
              <tr key={e.id}>
                <td>{fmt(e.occurredAt)}</td>
                <td>{userName(e.actorUserId)}</td>
                <td>{e.action}</td>
                <td>{e.targetType} / {e.targetId}</td>
              </tr>
            ))}
            {entries?.length === 0 && <tr><td colSpan={4} className="empty">No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {entries && entries.length > 300 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Showing the 300 most recent of {entries.length} entries.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BackupTab() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  async function downloadBackup() {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await backendApi.backupNow();
      const name = `whatsapp-panel-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setLastBackupAt(new Date().toISOString());
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Backup</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Downloads a full JSON export of the entire database (users, teams, numbers, customers, conversations, messages, leads — everything)
        straight to your computer. There's no automatic scheduled backup yet — that needs a durable place to store it (Cloudflare R2), which
        isn't set up. Doing this every so often, and keeping the file somewhere safe, is the manual equivalent for now.
      </p>
      {error && <div className="form-error">{error}</div>}
      {lastBackupAt && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Last downloaded: {fmt(lastBackupAt)}</p>}
      <div className="form-row">
        <button className="btn primary" disabled={busy} onClick={() => void downloadBackup()}>{busy ? 'Preparing…' : 'Download full backup (JSON)'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AutoDialerTab() {
  const [settings, setSettings] = useState<AutoDialerSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.getAutoDialerSettings().then(setSettings).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  function toggle(key: keyof AutoDialerSettings, value: boolean) {
    setBusy(true);
    setError(null);
    backendApi.updateAutoDialerSettings({ [key]: value })
      .then(setSettings)
      .catch((err) => setError(errMsg(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Auto Dialer</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Each piece of the Auto Dialer effort can be switched off independently — nothing here ever dials a phone
        automatically, these only control the prompts and auto-created reminders.
      </p>
      {error && <div className="form-error">{error}</div>}
      {!settings ? (
        <div className="empty">Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.callPromptEnabled}
              disabled={busy}
              onChange={(e) => toggle('callPromptEnabled', e.target.checked)}
            />
            "Call now" prompts — the 📞 badge on Leads and the highlighted card for a freshly-assigned, not-yet-called lead.
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.missedCallReminderEnabled}
              disabled={busy}
              onChange={(e) => toggle('missedCallReminderEnabled', e.target.checked)}
            />
            Missed-call auto-reminder — automatically creates a "Call back" reminder when a placed call goes unanswered.
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuickRepliesSection() {
  const [items, setItems] = useState<QuickReply[] | null>(null);
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
          {items === null && <tr><td colSpan={3} className="empty">Loading…</td></tr>}
          {items?.map((q) => (
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
          {items?.length === 0 && <tr><td colSpan={3} className="empty">None yet.</td></tr>}
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

/** Distinct {{n}} placeholders in a template's BODY component — same convention as ChatPane's own templateVariableSlots. */
function templatePlaceholderCount(t: Template): number {
  const body = (t.components ?? []).find((c) => c.type === 'BODY');
  return new Set([...(body?.text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
}

function TemplatesSection({ numbers }: { numbers: WhatsAppNumber[] }) {
  const numbersWithWaba = numbers.filter((n) => n.wabaId);
  const [items, setItems] = useState<Template[] | null>(null);
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
        <thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Status</th><th>Variable labels</th><th></th></tr></thead>
        <tbody>
          {items === null && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
          {items?.map((t) => {
            const slotCount = templatePlaceholderCount(t);
            return (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.language}</td>
                <td>{t.category}</td>
                <td><span className="lead-status-tag ASSIGNED">{t.status}</span></td>
                <td>
                  {slotCount === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No variables</span>
                  ) : (
                    <>
                      <input
                        defaultValue={(t.variables ?? []).join(', ')}
                        placeholder={Array.from({ length: slotCount }, (_, i) => `{{${i + 1}}} label`).join(', ')}
                        style={{ width: 220, fontSize: 11 }}
                        disabled={busy}
                        onBlur={(e) => {
                          const next = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                          const current = (t.variables ?? []).join(', ');
                          if (e.target.value.trim() === current) return;
                          if (next.length !== slotCount) { setError(`This template has ${slotCount} variable(s) ({{1}}..{{${slotCount}}}) — enter exactly ${slotCount} comma-separated label(s).`); return; }
                          void guard(() => backendApi.updateTemplateVariableLabels(t.id, next));
                        }}
                      />
                      {(t.variables ?? []).length !== slotCount && <div style={{ fontSize: 10, color: 'var(--danger)' }}>Needs {slotCount} label(s) — shown as {'{{n}}'} to agents until set</div>}
                    </>
                  )}
                </td>
                <td>
                  {t.status === 'LOCAL_DRAFT' && (
                    <button className="btn" disabled={busy || !t.wabaId} title={t.wabaId ? '' : 'Set a wabaId first'} onClick={() => void guard(() => backendApi.submitTemplateForReview(t.id))}>
                      Submit for review
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {items?.length === 0 && <tr><td colSpan={6} className="empty">None yet.</td></tr>}
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
        <select value={wabaId} onChange={(e) => setWabaId(e.target.value)}>
          <option value="">WABA ID (needed to submit)…</option>
          {numbersWithWaba.map((n) => <option key={n.id} value={n.wabaId}>{n.displayName}</option>)}
        </select>
      </div>
      <div className="form-row">
        <textarea rows={2} style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Body text — use {{1}}, {{2}} for variables" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
      </div>
      <div className="form-row">
        <button className="btn primary" disabled={busy || !name.trim() || !language.trim() || !category.trim()} onClick={() => void createDraft()}>Create draft</button>
      </div>

      <h2 className="section-title">Sync from Exotel</h2>
      {numbersWithWaba.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No number has a WABA ID set yet — add one under Admin → Numbers first.</p>
      )}
      <div className="form-row">
        <select value={syncWabaId} onChange={(e) => setSyncWabaId(e.target.value)}>
          <option value="">WABA ID…</option>
          {numbersWithWaba.map((n) => <option key={n.id} value={n.wabaId}>{n.displayName}</option>)}
        </select>
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

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'stage';
}

function LeadStagesTab() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listStages().then((s) => setStages([...s].sort((a, b) => a.sequenceOrder - b.sequenceOrder))).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    await guard(() => backendApi.createStage({ key: slugify(trimmed), name: trimmed, sequenceOrder: (stages ?? []).length + 1 }));
  }

  async function move(stage: Stage, direction: -1 | 1) {
    const idx = (stages ?? []).findIndex((s) => s.id === stage.id);
    const swapWith = (stages ?? [])[idx + direction];
    if (!swapWith) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all([
        backendApi.updateStage(stage.id, { sequenceOrder: swapWith.sequenceOrder }),
        backendApi.updateStage(swapWith.id, { sequenceOrder: stage.sequenceOrder }),
      ]);
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Lead Stages</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        This is the pipeline both Leads (the Kanban board) and WhatsApp customers use for their "Stage" field — reorder,
        rename, or deactivate as your team's process changes. Deactivating a stage keeps any leads already on it, it just
        stops appearing as a column/option for new ones.
      </p>
      <table className="data-table">
        <thead><tr><th>Order</th><th>Name</th><th>Key</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {stages === null && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
          {stages?.map((s, idx) => (
            <tr key={s.id}>
              <td>{s.sequenceOrder}</td>
              <td>{s.name}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{s.key}</td>
              <td>
                <input type="checkbox" checked={s.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateStage(s.id, { active: e.target.checked }))} />
              </td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn" disabled={busy || idx === 0} onClick={() => void move(s, -1)}>↑</button>
                <button className="btn" disabled={busy || idx === (stages?.length ?? 0) - 1} onClick={() => void move(s, 1)}>↓</button>
              </td>
            </tr>
          ))}
          {stages?.length === 0 && <tr><td colSpan={5} className="empty">No stages yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="New stage name (e.g. Site Visit Booked)" style={{ flex: 1, minWidth: 220 }} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => void create()}>Add stage</button>
        {stages?.length === 0 && (
          <button className="btn" disabled={busy} onClick={() => void guard(() => backendApi.seedDefaultLeadStages())}>
            Seed default 6 (New Leads → Contacted → Interested → Not Interested → Lead Won / Lead Lost)
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', select: 'Dropdown', date: 'Date', campaign: 'Dropdown (live campaigns)' };

function CustomFieldsTab() {
  const [entityType, setEntityType] = useState<CustomFieldEntityType>('lead');
  const [defs, setDefs] = useState<CustomFieldDefinition[] | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listCustomFieldDefinitions(entityType).then((d) => setDefs([...d].sort((a, b) => a.sequenceOrder - b.sequenceOrder))).catch((err) => setError(errMsg(err)));
  }
  useEffect(() => { setDefs(null); reload(); }, [entityType]);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = label.trim();
    if (!trimmed) return;
    const opts = type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : undefined;
    if (type === 'select' && (!opts || opts.length === 0)) { setError('A dropdown field needs at least one option.'); return; }
    setLabel('');
    setOptions('');
    setType('text');
    await guard(() => backendApi.createCustomFieldDefinition({ entityType, label: trimmed, type, options: opts }));
  }

  async function move(def: CustomFieldDefinition, direction: -1 | 1) {
    const idx = (defs ?? []).findIndex((d) => d.id === def.id);
    const swapWith = (defs ?? [])[idx + direction];
    if (!swapWith) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all([
        backendApi.updateCustomFieldDefinition(def.id, { sequenceOrder: swapWith.sequenceOrder }),
        backendApi.updateCustomFieldDefinition(swapWith.id, { sequenceOrder: def.sequenceOrder }),
      ]);
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Custom Fields</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Extra fields shown on every Lead and Customer record (e.g. Campaign Name, Lead Source, Product Interest,
        Expected Revenue) — useful for reporting to management. Deactivating a field keeps any values already stored,
        it just stops appearing as an editable field for new entries.
      </p>
      <div className="settings-tabs" style={{ marginBottom: 12 }}>
        <button className={`settings-tab${entityType === 'lead' ? ' active' : ''}`} onClick={() => setEntityType('lead')}>Lead fields</button>
        <button className={`settings-tab${entityType === 'customer' ? ' active' : ''}`} onClick={() => setEntityType('customer')}>Customer fields</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Order</th><th>Label</th><th>Type</th><th>Options</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {defs === null && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
          {defs?.map((d, idx) => (
            <tr key={d.id}>
              <td>{d.sequenceOrder}</td>
              <td>{d.label}</td>
              <td>{FIELD_TYPE_LABELS[d.type]}</td>
              <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.type === 'select' ? d.options.join(', ') : d.type === 'campaign' ? 'Live from Ad Accounts' : '—'}</td>
              <td>
                <input type="checkbox" checked={d.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateCustomFieldDefinition(d.id, { active: e.target.checked }))} />
              </td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn" disabled={busy || idx === 0} onClick={() => void move(d, -1)}>↑</button>
                <button className="btn" disabled={busy || idx === (defs?.length ?? 0) - 1} onClick={() => void move(d, 1)}>↓</button>
              </td>
            </tr>
          ))}
          {defs?.length === 0 && <tr><td colSpan={6} className="empty">No {entityType} fields yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Field label (e.g. Expected Revenue)" style={{ flex: 1, minWidth: 200 }} value={label} onChange={(e) => setLabel(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
          {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
        </select>
        {type === 'select' && (
          <input placeholder="Options, comma separated" style={{ flex: 1, minWidth: 200 }} value={options} onChange={(e) => setOptions(e.target.value)} />
        )}
        <button className="btn primary" disabled={busy || !label.trim()} onClick={() => void create()}>Add field</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProductsTab() {
  const [numbers, setNumbers] = useState<WhatsAppNumber[] | null>(null);
  const [numberId, setNumberId] = useState('');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendApi.listMyNumbers().then((list) => { setNumbers(list); if (list.length > 0) setNumberId((cur) => cur || list[0]!.id); }).catch((err) => setError(errMsg(err)));
  }, []);

  function reload() {
    if (!numberId) return;
    backendApi.listProducts(numberId).then((p) => setProducts([...p].sort((a, b) => a.sequenceOrder - b.sequenceOrder))).catch((err) => setError(errMsg(err)));
  }
  useEffect(() => { setProducts(null); reload(); }, [numberId]);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmed = name.trim();
    const price = Number(unitPrice);
    if (!trimmed || !Number.isFinite(price) || price < 0) return;
    setName('');
    setSku('');
    setUnitPrice('');
    await guard(() => backendApi.createProduct({ numberId, name: trimmed, sku: sku.trim(), unitPrice: price }));
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Product Master</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Prices are per WhatsApp number — each site/location has its own catalog. Agents pick from
        this list when building a Quotation on a Lead; deactivating a product keeps it on any
        quotation already built, it just stops appearing as an option for new ones.
      </p>
      <div className="form-row">
        <select value={numberId} onChange={(e) => setNumberId(e.target.value)}>
          {numbers === null && <option>Loading…</option>}
          {numbers?.length === 0 && <option>No numbers available</option>}
          {numbers?.map((n) => <option key={n.id} value={n.id}>{n.displayName}</option>)}
        </select>
      </div>
      <table className="data-table">
        <thead><tr><th>Order</th><th>Name</th><th>SKU</th><th>Price</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {products === null && <tr><td colSpan={6} className="empty">Loading…</td></tr>}
          {products?.map((p, idx) => (
            <tr key={p.id}>
              <td>{p.sequenceOrder}</td>
              <td>{p.name}</td>
              <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.sku || '—'}</td>
              <td>{p.unitPrice.toLocaleString(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}</td>
              <td>
                <input type="checkbox" checked={p.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateProduct(p.id, { active: e.target.checked }))} />
              </td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn" disabled={busy || idx === 0} onClick={() => void guard(async () => { const prev = products[idx - 1]!; await Promise.all([backendApi.updateProduct(p.id, { sequenceOrder: prev.sequenceOrder }), backendApi.updateProduct(prev.id, { sequenceOrder: p.sequenceOrder })]); })}>↑</button>
                <button className="btn" disabled={busy || idx === (products?.length ?? 0) - 1} onClick={() => void guard(async () => { const next = products[idx + 1]!; await Promise.all([backendApi.updateProduct(p.id, { sequenceOrder: next.sequenceOrder }), backendApi.updateProduct(next.id, { sequenceOrder: p.sequenceOrder })]); })}>↓</button>
              </td>
            </tr>
          ))}
          {products?.length === 0 && <tr><td colSpan={6} className="empty">No products yet for this number.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Product name" style={{ flex: 1, minWidth: 160 }} value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="SKU (optional)" style={{ width: 120 }} value={sku} onChange={(e) => setSku(e.target.value)} />
        <input placeholder="Price" type="number" min="0" style={{ width: 100 }} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim() || !unitPrice} onClick={() => void create()}>Add product</button>
      </div>
    </div>
  );
}

function AdAccountsTab() {
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [name, setName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    backendApi.listAdAccounts().then(setAccounts).catch((err) => setError(errMsg(err)));
  }
  useEffect(reload, []);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const trimmedName = name.trim();
    const trimmedId = externalAccountId.trim();
    if (!trimmedName || !trimmedId) return;
    setName('');
    setExternalAccountId('');
    await guard(() => backendApi.createAdAccount({ name: trimmedName, externalAccountId: trimmedId }));
  }

  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Ad Accounts</h2>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Meta ad accounts to report on in Dashboard → Ad Performance. Paste the numeric account id
        from Ads Manager (the "act_" prefix, if you copy it with one, is stripped automatically).
        Reading real spend/reach data also needs a <code>META_ACCESS_TOKEN</code> set on the backend —
        ask your developer if a new account here shows a configuration error.
      </p>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Account ID</th><th>Active</th></tr></thead>
        <tbody>
          {accounts === null && <tr><td colSpan={3} className="empty">Loading…</td></tr>}
          {accounts?.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{a.externalAccountId}</td>
              <td>
                <input type="checkbox" checked={a.active} disabled={busy} onChange={(e) => void guard(() => backendApi.updateAdAccount(a.id, { active: e.target.checked }))} />
              </td>
            </tr>
          ))}
          {accounts?.length === 0 && <tr><td colSpan={3} className="empty">No ad accounts yet.</td></tr>}
        </tbody>
      </table>
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <input placeholder="Account name (e.g. Entartica Sea World)" style={{ flex: 1, minWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Meta ad account id" style={{ width: 180 }} value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim() || !externalAccountId.trim()} onClick={() => void create()}>Add account</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type AdminTab = 'users' | 'teams' | 'numbers' | 'chatbot' | 'access' | 'assignment' | 'quickReplies' | 'templates' | 'leadStages' | 'customFields' | 'products' | 'adAccounts' | 'autoDialer' | 'audit' | 'backup';

export function Admin({ whoAmI }: { whoAmI: WhoAmI }) {
  const isFullAdmin = whoAmI.roleKeys.includes('ADMIN');
  const [tab, setTab] = useState<AdminTab>(isFullAdmin ? 'users' : 'customFields');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);

  useEffect(() => {
    if (!isFullAdmin) return;
    backendApi.listUsers().then(setUsers).catch(() => setUsers([]));
    backendApi.listRoles().then(setRoles).catch(() => setRoles([]));
    backendApi.listNumbers().then(setNumbers).catch(() => setNumbers([]));
  }, [tab, isFullAdmin]);

  const tabs: [AdminTab, string][] = isFullAdmin
    ? [
        ['users', 'Users'], ['teams', 'Teams'], ['numbers', 'Numbers'], ['chatbot', 'Chatbot'], ['access', 'Number Access'],
        ['assignment', 'Assignment Rules'], ['quickReplies', 'Quick Replies'], ['templates', 'Templates'],
        ['leadStages', 'Lead Stages'], ['customFields', 'Custom Fields'], ['products', 'Products'], ['adAccounts', 'Ad Accounts'],
        ['autoDialer', 'Auto Dialer'], ['audit', 'Audit Log'], ['backup', 'Backup'],
      ]
    : [['customFields', 'Custom Fields'], ['products', 'Products']];

  return (
    <>
      <h1 className="page-title">Admin</h1>
      <div className="settings-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={`settings-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'users' && <UsersTab roles={roles} numbers={numbers} />}
      {tab === 'teams' && <TeamsTab users={users} roles={roles} />}
      {tab === 'numbers' && <NumbersTab />}
      {tab === 'chatbot' && <ChatbotTab numbers={numbers} />}
      {tab === 'access' && <NumberAccessTab users={users} numbers={numbers} />}
      {tab === 'assignment' && <AssignmentRulesTab users={users} numbers={numbers} />}
      {tab === 'quickReplies' && <QuickRepliesSection />}
      {tab === 'templates' && <TemplatesSection numbers={numbers} />}
      {tab === 'leadStages' && <LeadStagesTab />}
      {tab === 'customFields' && <CustomFieldsTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'adAccounts' && <AdAccountsTab />}
      {tab === 'autoDialer' && <AutoDialerTab />}
      {tab === 'audit' && <AuditLogTab users={users} />}
      {tab === 'backup' && <BackupTab />}
    </>
  );
}
