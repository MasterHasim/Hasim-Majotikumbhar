import { useEffect, useState } from 'react';
import type { CustomFieldDefinition, CustomFieldEntityType } from '../types';
import { backendApi } from '../lib/backendApi';

/**
 * Renders the Admin-defined custom fields for a Lead or Customer, in Leads' detail modal and
 * Inbox's right panel alike — same field definitions, same editing shape, just a different
 * entityType/onSave target. Inactive fields are hidden (their stored values, if any, are simply
 * not editable/visible here — updateLeadCustomFields/updateCustomer still keep them on the
 * record until someone re-activates the field or clears the value explicitly).
 */
export function CustomFieldsSection({
  entityType, entityId, values, editable, busy, onSave,
}: {
  entityType: CustomFieldEntityType;
  entityId: string;
  values: Record<string, string | number> | undefined;
  editable: boolean;
  busy: boolean;
  onSave: (key: string, value: string) => void;
}) {
  const [defs, setDefs] = useState<CustomFieldDefinition[] | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [campaigns, setCampaigns] = useState<string[] | null>(null);

  useEffect(() => {
    backendApi.listCustomFieldDefinitions(entityType).then((d) => setDefs(d.filter((x) => x.active))).catch(() => setDefs([]));
  }, [entityType]);

  useEffect(() => {
    // Only fetched once actually needed — most orgs won't have a 'campaign' field defined.
    if (defs?.some((d) => d.type === 'campaign') && campaigns === null) {
      backendApi.listActiveCampaigns().then((rows) => setCampaigns(rows.map((r) => r.name))).catch(() => setCampaigns([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs]);

  useEffect(() => { setLocal({}); }, [entityId]);

  if (!defs || defs.length === 0) return null;

  function valueOf(d: CustomFieldDefinition): string {
    if (local[d.key] !== undefined) return local[d.key]!;
    const raw = values?.[d.key];
    return raw !== undefined ? String(raw) : '';
  }

  function change(d: CustomFieldDefinition, value: string) {
    setLocal((prev) => ({ ...prev, [d.key]: value }));
  }

  function commit(d: CustomFieldDefinition) {
    onSave(d.key, valueOf(d));
  }

  return (
    <div className="cust-fields" style={{ padding: 0, border: 'none', marginTop: 10, marginBottom: 10 }}>
      <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>Additional Info</span>
      {defs.map((d) => (
        <div className="field-row" key={d.id}>
          <span className="field-label">{d.label}</span>
          {editable ? (
            d.type === 'select' ? (
              <select className="field-value" disabled={busy} value={valueOf(d)} onChange={(e) => { change(d, e.target.value); onSave(d.key, e.target.value); }}>
                <option value="">—</option>
                {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : d.type === 'campaign' ? (
              <select className="field-value" disabled={busy || campaigns === null} value={valueOf(d)} onChange={(e) => { change(d, e.target.value); onSave(d.key, e.target.value); }}>
                <option value="">{campaigns === null ? 'Loading campaigns…' : campaigns.length === 0 ? 'No active campaigns found' : '—'}</option>
                {/* Keep a previously-saved value selectable even if that campaign is no longer active/live. */}
                {valueOf(d) && !(campaigns ?? []).includes(valueOf(d)) && <option value={valueOf(d)}>{valueOf(d)} (no longer live)</option>}
                {(campaigns ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            ) : (
              <input
                className="field-value"
                type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                disabled={busy}
                value={valueOf(d)}
                onChange={(e) => change(d, e.target.value)}
                onBlur={() => commit(d)}
              />
            )
          ) : (
            <span className="field-value">{valueOf(d) || '—'}</span>
          )}
        </div>
      ))}
    </div>
  );
}
