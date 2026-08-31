// Node: "Normalize API Jobs"  | Mode: Run Once for All Items
//
// Turns each Tier-1 source's own JSON into the same job shape that
// 04-normalize-extracted.js produces from the LLM. Everything downstream —
// dedupe, hard filters, scoring, the sheet — cannot tell the two apart, which
// is the whole point: structured sources skip the extraction call entirely.
//
// Output is ONE item carrying every job in an array, not one item per job.
// That keeps "Read Existing Jobs" to a single Sheets read no matter how many
// jobs arrived, and it means this node always emits something, so the tail of
// the workflow runs even on a day when every source returns nothing.
//
// Adding a source = one entry in ADAPTERS here plus one builder in
// 20-build-source-requests.js. Nothing else in the pipeline changes.

const RUN_ID = uid('run');
const MAX_JD_CHARS = 3000;

// --- small helpers ---------------------------------------------------------

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Accepts epoch ms, epoch seconds, or anything Date can parse. */
function toIso(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    // Seconds vs milliseconds: anything below this is not a date in ms.
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function stripHtml(v) {
  return text(v)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_JD_CHARS);
}

/** Sources say "remote" in a dozen ways; the sheet only has four values. */
function remoteType(...hints) {
  const hay = hints.map(text).join(' ').toLowerCase();
  if (/\b(hybrid)\b/.test(hay)) return 'hybrid';
  if (/\b(remote|work from home|wfh|anywhere|telecommute)\b/.test(hay)) return 'remote';
  if (/\b(on-?site|in office|in-office)\b/.test(hay)) return 'onsite';
  return 'unknown';
}

const num = (v) => (Number.isFinite(Number(v)) && text(v) !== '' ? Number(v) : null);

/** "8,00,000-15,00,000 INR" and friends, kept as free text like the sheet wants. */
function money(min, max, currency) {
  const a = num(min);
  const b = num(max);
  if (a === null && b === null) return '';
  const cur = text(currency);
  const fmt = (n) => (n === null ? '' : n.toLocaleString('en-IN'));
  return `${[fmt(a), fmt(b)].filter(Boolean).join(' - ')}${cur ? ` ${cur}` : ''}`.trim();
}

// ===========================================================================
// Adapters — one per source
// ===========================================================================
// rows()  pulls the list of postings out of whatever wrapper the API uses.
// probe() is the schema guard: these are undocumented in two cases, so if a
//         payload stops looking like postings we say so loudly instead of
//         writing a sheet full of empty rows.
// toJob() maps one posting onto the canonical shape.

const ADAPTERS = {
  instahyre: {
    rows: (r) => r?.objects || [],
    probe: (x) => Boolean(x && x.title && x.employer),
    toJob: (x) => ({
      company: text(x.employer?.company_name),
      title: text(x.title),
      location: text(x.locations),
      remote_type: remoteType(x.locations),
      experience_min: null,
      experience_max: null,
      salary: '',
      url: text(x.public_url),
      posted_at: '',
      // The search response carries no description, and the detail endpoint
      // is one call per job. The keyword list is what it does give us, and
      // it is enough for scoring to have something to work with.
      jd_text: Array.isArray(x.keywords) ? x.keywords.join(', ') : '',
    }),
  },

  foundit: {
    rows: (r) => r?.jobSearchResponse?.data || [],
    probe: (x) => Boolean(x && x.title && x.companyName),
    toJob: (x) => ({
      company: text(x.companyName),
      title: text(x.title),
      location: text(x.locations),
      remote_type: remoteType(x.locations, (x.jobTypes || []).join(' ')),
      experience_min: num(x.minimumExperienceFilter),
      experience_max: num(x.maximumExperienceFilter),
      salary: x.hideSalary ? '' : text(x.salary),
      url: `https://www.foundit.in${text(x.seoJdUrl || x.jdUrl)}`,
      posted_at: toIso(x.createdAt),
      jd_text: text(x.skills),
      // An expired posting still sits in the index for a while.
      _skip: x.isJobActive === false || x.activeJob === false,
    }),
  },

  greenhouse: {
    rows: (r) => r?.jobs || [],
    probe: (x) => Boolean(x && x.title && x.absolute_url),
    toJob: (x, req) => ({
      company: text(x.company_name || req.label),
      title: text(x.title),
      location: text(x.location?.name),
      remote_type: remoteType(x.location?.name, x.title),
      experience_min: null,
      experience_max: null,
      salary: '',
      url: text(x.absolute_url),
      posted_at: toIso(x.updated_at || x.first_published),
      jd_text: stripHtml(x.content),
    }),
  },

  lever: {
    rows: (r) => (Array.isArray(r) ? r : r?.data || []),
    probe: (x) => Boolean(x && x.text && x.hostedUrl),
    toJob: (x, req) => ({
      company: text(req.label),
      title: text(x.text),
      location: text(x.categories?.location),
      remote_type: remoteType(x.categories?.location, x.workplaceType, x.categories?.commitment),
      experience_min: null,
      experience_max: null,
      salary: money(x.salaryRange?.min, x.salaryRange?.max, x.salaryRange?.currency),
      url: text(x.hostedUrl),
      posted_at: toIso(x.createdAt),
      jd_text: stripHtml(x.descriptionPlain || x.description),
    }),
  },

  ashby: {
    rows: (r) => r?.jobs || [],
    probe: (x) => Boolean(x && x.title && x.jobUrl),
    toJob: (x, req) => ({
      company: text(req.label),
      title: text(x.title),
      location: text(x.location),
      // workplaceType is the explicit field ("Remote" / "Hybrid" / "Onsite");
      // isRemote is only a fallback because it cannot express hybrid.
      remote_type: remoteType(x.workplaceType) !== 'unknown'
        ? remoteType(x.workplaceType)
        : (x.isRemote ? 'remote' : remoteType(x.location)),
      experience_min: null,
      experience_max: null,
      salary: text(x.compensation?.summary),
      url: text(x.jobUrl || x.applyUrl),
      posted_at: toIso(x.publishedAt || x.updatedAt),
      jd_text: stripHtml(x.descriptionPlain || x.descriptionHtml),
      // A board keeps unlisted drafts in the same feed.
      _skip: x.isListed === false,
    }),
  },

  remoteok: {
    // The first element of RemoteOK's array is a legal notice, not a job.
    rows: (r) => (Array.isArray(r) ? r.filter((x) => x && x.id && x.position) : []),
    probe: (x) => Boolean(x && x.position && x.company),
    toJob: (x) => ({
      company: text(x.company),
      title: text(x.position),
      location: text(x.location) || 'Remote',
      remote_type: 'remote',
      experience_min: null,
      experience_max: null,
      salary: money(x.salary_min, x.salary_max, 'USD'),
      url: text(x.url || x.apply_url),
      posted_at: toIso(x.date || x.epoch),
      jd_text: stripHtml(x.description),
    }),
  },

  arbeitnow: {
    rows: (r) => r?.data || [],
    probe: (x) => Boolean(x && x.title && x.company_name),
    toJob: (x) => ({
      company: text(x.company_name),
      title: text(x.title),
      location: text(x.location),
      remote_type: x.remote ? 'remote' : remoteType(x.location),
      experience_min: null,
      experience_max: null,
      salary: '',
      url: text(x.url),
      posted_at: toIso(x.created_at),
      jd_text: stripHtml(x.description),
    }),
  },

  adzuna: {
    rows: (r) => r?.results || [],
    probe: (x) => Boolean(x && x.title && x.redirect_url),
    toJob: (x) => ({
      company: text(x.company?.display_name),
      title: text(x.title),
      location: text(x.location?.display_name),
      remote_type: remoteType(x.location?.display_name, x.title),
      experience_min: null,
      experience_max: null,
      salary: money(x.salary_min, x.salary_max, 'INR'),
      url: text(x.redirect_url),
      posted_at: toIso(x.created),
      jd_text: stripHtml(x.description),
    }),
  },

  jooble: {
    rows: (r) => r?.jobs || [],
    probe: (x) => Boolean(x && x.title && x.link),
    toJob: (x) => ({
      company: text(x.company),
      title: text(x.title),
      location: text(x.location),
      remote_type: remoteType(x.location, x.type),
      experience_min: null,
      experience_max: null,
      salary: text(x.salary),
      url: text(x.link),
      posted_at: toIso(x.updated),
      jd_text: stripHtml(x.snippet),
    }),
  },
};

// ===========================================================================

const requests = $('Build Source Requests').all().map((i) => i.json);
const responses = $input.all();

// One HTTP response can arrive split across several items — n8n fans a
// top-level JSON array out into one item each — so group by the request that
// produced them rather than assuming one item per call.
const byRequest = new Map();
for (const [idx, item] of responses.entries()) {
  const reqIdx = Number.isInteger(item.pairedItem?.item) ? item.pairedItem.item : idx;
  if (!byRequest.has(reqIdx)) byRequest.set(reqIdx, []);
  byRequest.get(reqIdx).push(item.json);
}

const jobs = [];
const health = [];
const seen = new Set();

for (const [reqIdx, payloads] of byRequest) {
  const req = requests[reqIdx];
  if (!req) continue;

  const adapter = ADAPTERS[req.source];
  const where = `${req.source}${req.label ? ` (${req.label})` : ''}`;

  if (!adapter) {
    health.push({ source: req.source, label: req.label, ok: false, rows: 0, jobs: 0, note: 'no adapter' });
    continue;
  }

  // Collect postings across however many items this request produced.
  const rows = [];
  for (const payload of payloads) {
    const found = adapter.rows(payload) || [];
    if (found.length) rows.push(...found);
    else if (adapter.probe(payload)) rows.push(payload);   // already split into one job per item
  }

  if (!rows.length) {
    // Distinguish "nobody is hiring today" from "this endpoint changed" as
    // far as we can: an error body is the usual shape of the second.
    const err = payloads.find((p) => p && (p.error || p.message || p.detail));
    const note = err
      ? `no rows — response looks like an error: ${String(err.error?.message || err.error || err.message || err.detail).slice(0, 120)}`
      : 'no rows';
    health.push({ source: req.source, label: req.label, ok: !err, rows: 0, jobs: 0, note });
    console.log(`sources: ${where} returned ${note}`);
    continue;
  }

  // Schema guard. Two of these APIs are the site's own undocumented front-end
  // endpoint; the day one changes shape, this says so instead of quietly
  // writing a hundred blank rows into the sheet.
  const usable = rows.filter((x) => adapter.probe(x));
  if (!usable.length) {
    health.push({
      source: req.source, label: req.label, ok: false, rows: rows.length, jobs: 0,
      note: `schema changed — ${rows.length} record(s), none with the expected fields`,
    });
    console.log(
      `sources: ${where} returned ${rows.length} record(s) that no longer look like postings. ` +
      `Its response shape changed — check the adapter in 21-normalize-api-jobs.js.`
    );
    continue;
  }

  const maxAgeDays = Number(req.max_age_days || 0);
  const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 86400000 : 0;
  const cap = Number(req.limit) > 0 ? Number(req.limit) : Infinity;

  let kept = 0;
  let stale = 0;
  let dupes = 0;

  for (const row of usable) {
    if (kept >= cap) break;

    let mapped;
    try {
      mapped = adapter.toJob(row, req);
    } catch (e) {
      continue;
    }
    if (!mapped || mapped._skip || !mapped.title || !mapped.company) continue;

    // Recency, for the sources that date their postings. A job with no date
    // is kept — "unknown" must not silently mean "old".
    if (cutoff && mapped.posted_at) {
      const t = new Date(mapped.posted_at).getTime();
      if (Number.isFinite(t) && t < cutoff) { stale++; continue; }
    }

    const canonical = canonicalUrl(mapped.url);

    const job = {
      job_id: uid('job'),
      source: req.source,
      company: mapped.company,
      title: mapped.title,
      location: mapped.location || '',
      remote_type: ['onsite', 'hybrid', 'remote'].includes(mapped.remote_type)
        ? mapped.remote_type : 'unknown',
      experience_min: mapped.experience_min,
      experience_max: mapped.experience_max,
      salary: mapped.salary || '',
      url: mapped.url || '',
      canonical_url: canonical,
      jd_text: mapped.jd_text || '',
      posted_at: mapped.posted_at || '',
      discovered_at: nowIso(),
      run_id: RUN_ID,
      score: '',
      score_reason: '',
      resume_variant: '',
      status: 'new',
      attempts: 0,
      last_error: '',
      applied_at: '',
    };
    job.fingerprint = fingerprint(job);

    // Within-run dedupe, on the same two keys the Dedupe node uses against the
    // sheet. One posting routinely appears on two sources, and one board
    // routinely lists the same role twice under different ids.
    if ((canonical && seen.has(canonical)) || seen.has(job.fingerprint)) {
      dupes++;
      continue;
    }
    if (canonical) seen.add(canonical);
    seen.add(job.fingerprint);

    jobs.push(job);
    kept++;
  }

  health.push({
    source: req.source, label: req.label, ok: true,
    rows: rows.length, jobs: kept,
    note: [stale ? `${stale} too old` : '', dupes ? `${dupes} already seen this run` : '']
      .filter(Boolean).join(', '),
  });
}

const broken = health.filter((h) => !h.ok);
console.log(
  `sources: ${jobs.length} job(s) from ${health.filter((h) => h.jobs > 0).length}/${health.length} ` +
  `request(s)` + (broken.length ? `, ${broken.length} unhealthy` : '') + ' — no tokens spent'
);
for (const h of health) {
  console.log(`  ${h.ok ? '·' : '!'} ${h.source}${h.label ? ` [${h.label}]` : ''}: ` +
              `${h.rows} row(s) -> ${h.jobs} job(s)${h.note ? ` (${h.note})` : ''}`);
}

// Always exactly one item, even when empty — the rest of the workflow hangs
// off this node, and an empty output would stop the LLM lane's jobs from ever
// reaching the sheet.
return [{ json: { run_id: RUN_ID, jobs, health, source_count: health.length, job_count: jobs.length } }];
