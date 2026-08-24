// Node: "Select Queued Jobs"  | Mode: Run Once for All Items
// Workflow 02 entry point. The `status` column is the whole resume mechanism:
// anything left at `queued` yesterday is simply picked up today.
//
// Limits come from .env (MAX_APPLICATIONS_PER_RUN, MAX_ATTEMPTS).

const cfg = $('Load Profile').first().json.config;

const rows = $input.all()
  .map((i) => i.json)
  .filter((r) => r.status === 'queued')
  .filter((r) => (Number(r.attempts) || 0) < cfg.max_attempts)
  .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
  .slice(0, cfg.max_applications_per_run);

console.log(`apply run: ${rows.length} job(s) selected (cap ${cfg.max_applications_per_run})`);
return rows.map((json) => ({ json }));
