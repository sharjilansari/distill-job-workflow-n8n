# Where jobs come from

Ingestion is tiered by what a site is willing to hand you.

| Tier | What it is | Cost per job | Where it lives |
|---|---|---|---|
| **1** | APIs that return structured JSON | nothing — no extraction call | this document |
| **2** | Page-diff monitoring for sites with no API | one extraction call per ~20 jobs | [distill-setup.md](distill-setup.md) |
| **3** | Sites that need a real browser session | a browser run | not built yet |

Tier 1 is the data path. Everything else is there to cover what Tier 1 cannot
reach.

The reason is a correction to an assumption this project was originally built
on: Distill's free plan allows **30 alerts a month across email and webhook
together** — roughly one a day for your entire watchlist, not one a day per
monitor. Email was never an unmetered pipe. A monitor's *checks* are unlimited
locally; its *alerts* are the thing you only get thirty of.

---

## The sources

All of these were tested against live endpoints. The three marked keyless and
India-focused are the ones carrying the volume.

| Source | Auth | Coverage | Gives you |
|---|---|---|---|
| **Instahyre** | none | India, tech | title, company, city, skills, apply URL |
| **foundit.in** | none (a fixed `appid` header) | India, broad | everything above plus **experience range, salary, posted date** |
| **Greenhouse** | none | per company board | title, company, location, posted date, full description |
| **Lever** | none | per company board | as above, plus workplace type and salary range |
| **Ashby** | none | per company board | as above, plus explicit remote/hybrid flag |
| **RemoteOK** | none | global remote | title, company, salary band, description |
| **Arbeitnow** | none | global, EU-heavy | title, company, location, description |
| **Adzuna** | free key | 16 countries incl. India | title, company, location, salary, posted date |
| **Jooble** | free key | 60+ countries incl. India | title, company, location, snippet |

The three ATS boards deserve special attention: they are the same systems
[apply-svc](../apply-svc/src/ats/) can actually submit to. A job found through
Greenhouse, Lever or Ashby is one the pipeline can carry end to end without a
human, which no aggregator result can promise.

### What Tier 1 does not cover

Naukri, LinkedIn, Indeed and Hirist. Naukri answers `406 recaptcha required`,
Hirist ships an empty page and loads its feed behind a bot-detection layer,
Indeed retired RSS and runs Cloudflare fingerprinting, and LinkedIn's guest
endpoint returns HTML rather than JSON. Those are Tier 3, and they need the
browser that already exists in this project for applying.

---

## Configuring

Everything lives in `profile/profile.json` under `sources`. It is plain text —
no code — and `npm run setup` bakes it into the workflow.

```json
"sources": {
  "max_age_days": 3,
  "instahyre": {
    "enabled": true,
    "skills": ["React", "TypeScript", "Next.js"],
    "experience_level": "associate",
    "limit": 50
  },
  "foundit": {
    "enabled": true,
    "queries": ["react developer"],
    "locations": ["noida", "bengaluru"],
    "experience_min": 1,
    "experience_max": 4
  },
  "greenhouse": { "enabled": true, "boards": ["razorpaysoftwareprivatelimited"] }
}
```

Notes that save an afternoon:

- **`max_age_days` is the single biggest cost lever.** It is applied
  server-side where the API supports it (foundit, Adzuna) and locally
  everywhere else. A posting with no date is always kept — "undated" must not
  quietly become "old".
- **Instahyre's `skills` list is one request, not one per skill.** The API ORs
  them server-side.
- **Instahyre has no working location parameter.** Verified by comparing result
  counts across every spelling. City filtering happens in `filters.allowed_locations`,
  which runs for free anyway.
- **foundit is one request per query × location.** Three queries and four
  cities is twelve calls. `MAX_SOURCE_REQUESTS` in `.env` stops a typo from
  becoming fifty.
- **Board names come from the careers URL** — `job-boards.greenhouse.io/NAME`,
  `jobs.lever.co/NAME`, `jobs.ashbyhq.com/NAME`.
- **Ashby and Lever boards can be enormous.** A large board is a multi-megabyte
  response. `limit` caps what is kept, not what is downloaded.

---

## Seeing what you would get

```bash
npm run sources
```

Fetches every enabled source and prints the rows the pipeline would write —
without n8n, without Google Sheets, and without touching your AI key.

```
3. Normalizing
  ✓ instahyre [skills=React|TypeScript]: 35 record(s) → 35 job(s)
  ✓ foundit [react developer @ bengaluru]: 15 record(s) → 9 job(s) (1 too old, 2 already seen this run)
  ✓ greenhouse [razorpaysoftware…]: 23 record(s) → 7 job(s) (16 too old)

4. After your hard filters
  ✓ 30 job(s) would be scored, 21 dropped before any token was spent
```

It runs the real Code-node files with the same helpers n8n injects, so a source
that breaks here breaks there. Use it whenever you change a search, and after
any run that looked wrong.

`--all` prints every row instead of a sample; `--json` prints the normalized
jobs for piping somewhere else.

---

## When a source breaks

Two of these — Instahyre and foundit — are the site's own front-end API rather
than a published product. They are free, fast and clean, and they can change
shape without anyone announcing it. That is a fair trade only if you find out
immediately, so every adapter declares a `probe()` and the pipeline reports
three states rather than one:

| What you see | What happened |
|---|---|
| `15 record(s) → 9 job(s)` | working |
| `0 record(s) → 0 job(s) (no rows)` | working, nothing matched today |
| `schema changed — 40 record(s), none with the expected fields` | **the endpoint moved** |

The third one names the source. Fix its adapter in
[21-normalize-api-jobs.js](../n8n/code/21-normalize-api-jobs.js), which is the
only file that knows any source's field names.

A source going quiet for two runs in a row is a bug, not a slow market. Check
it with `npm run sources` before assuming nobody is hiring.

---

## Adding a source

Two files, both small:

1. **A builder** in [20-build-source-requests.js](../n8n/code/20-build-source-requests.js)
   — turn its config block into one or more `{ label, url, headers }` requests.
2. **An adapter** in [21-normalize-api-jobs.js](../n8n/code/21-normalize-api-jobs.js)
   — `rows()` to find the postings in whatever wrapper the API uses, `probe()`
   to recognise a posting, `toJob()` to map one.

Then add its block to `profile.json` and run `npm run sources`. Nothing else in
the pipeline changes: dedupe, filters, scoring and the sheet cannot tell one
source from another.

---

## On terms of service

The ATS boards and the two keyed aggregators publish these endpoints for
programmatic use. Instahyre's and foundit's are internal endpoints their own
site calls — reading them is not something they invite, and the Tier 3 sites
(Naukri, LinkedIn, Indeed) prohibit automated access in their terms outright.

This runs at the pace of a person checking their job feed once a day, which is
both the polite thing and the thing least likely to break. Keep it that way:
the batching in the fetch node is one request at a time with a pause between,
and it is there on purpose.
