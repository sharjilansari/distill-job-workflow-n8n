// Node: "Build Source Requests"  | Mode: Run Once for All Items
//
// Tier 1 of ingestion: sources that hand back structured JSON. Every item this
// node emits is one HTTP call, and the responses go straight to
// 21-normalize-api-jobs.js — no page diffing, no LLM extraction, no tokens.
//
// Edit the searches in profile/profile.json under "sources", then run
// `npm run setup`. Adding a keyword or a city is a text edit, not a code edit.
//
// The two sources that need a key (Adzuna, Jooble) read it from the
// environment at runtime, exactly like the LLM keys — nothing is baked in.

const SOURCES = ($('Load Profile').first().json.profile.sources) || {};
const MAX_REQUESTS = envNum('MAX_SOURCE_REQUESTS', 40);
const DEFAULT_MAX_AGE = Number(SOURCES.max_age_days ?? 3);

// Some of these endpoints are the site's own front-end API. They answer a
// plain client, but a blank user-agent is the one thing that reliably gets a
// 403, so send a normal one.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const JSON_HEADERS = { accept: 'application/json', 'user-agent': UA };

const arr = (v, fallback = []) =>
  (Array.isArray(v) && v.length ? v.map((x) => String(x).trim()).filter(Boolean) : fallback);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));

/**
 * Query-string builder taking ordered pairs, because one of these APIs uses a
 * repeated key (skills=React&skills=Next.js) as its OR syntax, which a plain
 * object cannot express. encodeURIComponent rather than URLSearchParams: the
 * n8n Code sandbox exposes URL but not reliably its constructor siblings, and
 * this has no dependency at all.
 */
function qs(pairs) {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ===========================================================================
// Builders — one per source. Each returns an array of requests.
// ===========================================================================
// A builder returning [] means "enabled but nothing configured", which is
// reported below rather than passing silently.

const BUILDERS = {
  /**
   * Instahyre's own search API. `skills` is repeatable and OR'd server-side,
   * so the whole skill list costs exactly one call. It has no location or
   * free-text parameter that does anything — verified by comparing response
   * counts — so city filtering happens in the hard filters, where it is free.
   */
  instahyre(s) {
    const skills = arr(s.skills);
    if (!skills.length) return [];
    const pairs = [
      ['job_type', s.job_type ?? 1],
      ['limit', clamp(s.limit ?? 50, 1, 100)],
      ['offset', 0],
      // associate | entry_level | mid_senior | senior | internship
      ['experience_level', s.experience_level || ''],
    ];
    for (const sk of skills) pairs.push(['skills', sk]);
    return [{
      label: `skills=${skills.join('|')}`,
      url: `https://www.instahyre.com/api/v1/job_search?${qs(pairs)}`,
    }];
  },

  /**
   * foundit.in (formerly Monster India). The `appid` header is not a secret —
   * it is a constant the site's own front end sends, and the endpoint replies
   * "content negotiation failed" without it.
   */
  foundit(s) {
    const out = [];
    const queries = arr(s.queries);
    const locations = arr(s.locations, ['']);
    const age = Number(s.max_age_days ?? DEFAULT_MAX_AGE);
    for (const query of queries) {
      for (const loc of locations) {
        const pairs = [
          ['query', query],
          ['locations', loc],
          ['start', 0],
          ['sort', 1],
          ['limit', clamp(s.limit ?? 40, 1, 60)],
          // Server-side recency filter, in days. Cheaper than pulling a month
          // of listings and dropping most of them here.
          ['jobFreshness', age > 0 ? Math.ceil(age) : ''],
        ];
        if (s.experience_min != null && s.experience_max != null) {
          pairs.push(['experienceRanges', `${s.experience_min}~${s.experience_max}`]);
        }
        out.push({
          label: `${query}${loc ? ` @ ${loc}` : ''}`,
          url: `https://www.foundit.in/middleware/jobsearch?${qs(pairs)}`,
          headers: { ...JSON_HEADERS, appid: '105', referer: 'https://www.foundit.in/' },
        });
      }
    }
    return out;
  },

  // --- ATS boards: public, keyless, and the same systems apply-svc can
  // --- actually submit to. One call per company board.
  greenhouse: (s) => arr(s.boards).map((b) => ({
    label: b,
    url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}/jobs`,
  })),

  lever: (s) => arr(s.boards).map((b) => ({
    label: b,
    url: `https://api.lever.co/v0/postings/${encodeURIComponent(b)}?mode=json`,
  })),

  ashby: (s) => arr(s.boards).map((b) => ({
    label: b,
    url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b)}`,
  })),

  // --- Remote-only boards. Global and large, so `limit` matters here.
  remoteok: () => [{ label: 'all', url: 'https://remoteok.com/api' }],

  arbeitnow: () => [{ label: 'all', url: 'https://www.arbeitnow.com/api/job-board-api' }],

  /** Needs a free key pair from developer.adzuna.com. */
  adzuna(s) {
    const appId = env('ADZUNA_APP_ID');
    const appKey = env('ADZUNA_APP_KEY');
    if (!appId || !appKey) {
      throw new Error('ADZUNA_APP_ID / ADZUNA_APP_KEY are not set in .env');
    }
    const out = [];
    const country = (s.country || 'in').toLowerCase();
    const age = Number(s.max_age_days ?? DEFAULT_MAX_AGE);
    for (const what of arr(s.queries)) {
      for (const where of arr(s.locations, [''])) {
        const pairs = [
          ['app_id', appId],
          ['app_key', appKey],
          ['results_per_page', clamp(s.limit ?? 50, 1, 50)],
          ['what', what],
          ['where', where],
          ['max_days_old', age > 0 ? Math.ceil(age) : ''],
        ];
        out.push({
          label: `${what}${where ? ` @ ${where}` : ''}`,
          url: `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${qs(pairs)}`,
        });
      }
    }
    return out;
  },

  /** Needs a free key from jooble.org/api/about. POST, unlike everything else. */
  jooble(s) {
    const key = env('JOOBLE_API_KEY');
    if (!key) throw new Error('JOOBLE_API_KEY is not set in .env');
    const out = [];
    for (const keywords of arr(s.queries)) {
      for (const location of arr(s.locations, [''])) {
        out.push({
          label: `${keywords}${location ? ` @ ${location}` : ''}`,
          method: 'POST',
          url: `https://jooble.org/api/${encodeURIComponent(key)}`,
          headers: { ...JSON_HEADERS, 'content-type': 'application/json' },
          body: { keywords, location, page: '1' },
        });
      }
    }
    return out;
  },
};

// ===========================================================================

const out = [];
const notes = [];

for (const [source, build] of Object.entries(BUILDERS)) {
  const cfg = SOURCES[source];
  if (!cfg || cfg.enabled === false) continue;

  let requests;
  try {
    requests = build(cfg) || [];
  } catch (e) {
    // A missing key disables one source; it must not take the run down with
    // it, because the keyless sources are the ones carrying the volume.
    notes.push(`${source}: skipped — ${e.message}`);
    continue;
  }

  if (!requests.length) {
    notes.push(`${source}: enabled but produced no requests — check its entry in profile.json`);
    continue;
  }

  for (const r of requests) {
    out.push({
      json: {
        source,
        label: r.label || '',
        max_age_days: Number(cfg.max_age_days ?? DEFAULT_MAX_AGE),
        limit: Number(cfg.limit ?? 0),
        _req: {
          method: r.method || 'GET',
          url: r.url,
          headers: r.headers || JSON_HEADERS,
          body: r.body || {},
        },
      },
    });
  }
}

for (const n of notes) console.log(`sources: ${n}`);

if (!out.length) {
  throw new Error(
    'No job sources are enabled. Open profile/profile.json, set at least one ' +
    'entry under "sources" to "enabled": true, then run "npm run setup".'
  );
}

if (out.length > MAX_REQUESTS) {
  // Every request is a page fetch against someone else's server. A typo like
  // twelve cities times eight queries should be caught here, not by them.
  throw new Error(
    `${out.length} source requests configured, over the MAX_SOURCE_REQUESTS ` +
    `limit of ${MAX_REQUESTS}. Trim the queries or locations in ` +
    `profile.json, or raise MAX_SOURCE_REQUESTS in .env if you mean it.`
  );
}

console.log(
  `sources: ${out.length} request(s) across ` +
  `${new Set(out.map((i) => i.json.source)).size} source(s)`
);
return out;
