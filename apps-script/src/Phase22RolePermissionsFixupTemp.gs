/**
 * ONE-TIME FIX: adds Phase 22's new permissions (leads.manage, leads.view.assigned,
 * leads.call) to already-bootstrapped Role records. Adding a permission to
 * Phase1Domain.gs's RoleDefinitions only affects a *fresh* bootstrapPhase1() call —
 * existing Role records were persisted with a fixed `permissions` snapshot back when
 * bootstrap actually ran (2026-08-09), so they don't retroactively pick up new
 * permissions added to the code later. Run once from the Apps Script editor's Run
 * button (Execution API/clasp run don't work here — same auto-managed-GCP-project
 * limitation as the original bootstrap, see memory/DECISIONS.md), then delete this
 * file, same convention as every other *Temp.gs one-off in this project's history.
 */
function fixupPhase22RolePermissions() {
  var repository = new PropertiesRepository();
  var additions = {
    ADMIN: [Phase1Permissions.LEADS_MANAGE, Phase1Permissions.LEADS_VIEW_ASSIGNED, Phase1Permissions.LEADS_CALL],
    SITE_MANAGER: [Phase1Permissions.LEADS_MANAGE],
    AGENT: [Phase1Permissions.LEADS_VIEW_ASSIGNED, Phase1Permissions.LEADS_CALL]
  };
  var roles = repository.list('roles');
  var results = [];
  roles.forEach(function (role) {
    var toAdd = additions[role.key];
    if (!toAdd) { results.push(role.key + ': no change (not one of ADMIN/SITE_MANAGER/AGENT)'); return; }
    var current = role.permissions || [];
    var missing = toAdd.filter(function (p) { return current.indexOf(p) === -1; });
    if (!missing.length) { results.push(role.key + ': already up to date'); return; }
    var updated = current.concat(missing);
    repository.update('roles', role.id, { permissions: updated });
    results.push(role.key + ': added ' + missing.join(', '));
  });
  Logger.log(results.join('\n'));
  return results;
}
