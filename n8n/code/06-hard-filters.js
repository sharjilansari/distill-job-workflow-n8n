// Node: "Hard Filters"  | Mode: Run Once for All Items
//
// Free, instant, runs before any token is spent. Typically removes 50-60%.
// The rules live in profile/profile.json under "filters" — edit them there,
// run `npm run setup`, and they take effect. No JavaScript to touch.

const f = ($('Load Profile').first().json.profile.filters) || {};

const years = Number(f.years_experience ?? 2);
const tolerance = Number(f.years_tolerance ?? 1);
const locations = (f.allowed_locations || []).map((s) => String(s).toLowerCase());

// Strings from JSON become case-insensitive regexes here so the config file
// stays plain text a non-programmer can edit safely.
const toRe = (list) =>
  (list || []).length ? new RegExp(`\\b(${list.map(escapeRe).join('|')})\\b`, 'i') : null;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const titleBlock = toRe(f.title_blocklist);
const titleAllow = toRe(f.title_allowlist);
const companyBlock = toRe(f.company_blocklist);

function reject(job) {
  const title = job.title || '';
  const loc = (job.location || '').toLowerCase();

  if (titleBlock && titleBlock.test(title)) return 'title blocklisted';
  if (titleAllow && !titleAllow.test(title)) return 'title outside allowlist';
  if (companyBlock && companyBlock.test(job.company || '')) return 'company blocklisted';

  if (Number.isFinite(job.experience_min) && job.experience_min > years + tolerance) {
    return `needs ${job.experience_min}y, you have ${years}y`;
  }

  const locOk =
    job.remote_type === 'remote' ||
    !loc ||
    !locations.length ||
    locations.some((l) => loc.includes(l));
  if (!locOk) return `location ${job.location} not allowed`;

  return null;
}

let dropped = 0;
const out = $input.all().map((item) => {
  const reason = reject(item.json);
  if (reason) dropped++;
  return {
    json: {
      ...item.json,
      filtered_out: Boolean(reason),
      filter_reason: reason || '',
      status: reason ? 'skipped' : 'new',
      score: reason ? 0 : '',
      score_reason: reason ? `hard filter: ${reason}` : '',
    },
  };
});

console.log(`hard filters: ${dropped} of ${out.length} dropped before any token was spent`);
return out;
