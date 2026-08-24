# Job Agent

Distill Web Monitor watches job boards → n8n normalises, dedupes and scores what
it finds → a Playwright service tailors a resume and submits the application.
Google Sheets is the database and the control panel.

**New here? Read [SETUP.md](SETUP.md) instead.** It assumes no coding knowledge
and walks through every click.

---

## Quick start

```bash
npm run setup          # creates .env, checks it, builds the workflows
# fill in .env and profile/*.json, then:
npm run setup          # again — it tells you what's still missing
docker compose up -d   # start n8n + the browser service
npm run doctor         # verifies everything, incl. a live AI test call
```

| Command | What it does |
|---|---|
| `npm run setup` | Validate `.env`, bake your profile in, build `n8n/dist/` |
| `npm run doctor` | Check config, services, and make a real test call to your AI |
| `npm start` | `docker compose up -d` then `doctor` |
| `npm run logs` | Follow the logs |
| `npm run restart` | Pick up `.env` changes |
| `npm run login -- linkedin` | Save a browser login (run on your desktop, not in Docker) |

---

## Configuration lives in three files

Nothing else needs editing.

| File | Holds |
|---|---|
| `.env` | Keys, which AI to use, thresholds, safety switches |
| `profile/profile.json` | Who you are, and the free filters that run before any AI call |
| `profile/master-resume.json` | The only facts the resume writer may use |

`npm run setup` bakes the two profile files into the workflow's Code nodes.
**Keys are never baked** — they are read from the environment at runtime, so
rotating one means editing `.env` and running `docker compose restart`, and no
secret ever lands in a workflow file.

---

## Switching AI provider

One line in `.env`:

```
LLM_PROVIDER=anthropic     # or: openai, gemini
```

…plus that provider's key. Then `docker compose restart`. Nothing else changes
— not a workflow node, not a prompt.

| Provider | Key | Endpoint used | JSON enforced by |
|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `/v1/messages` | `output_config.format` |
| `openai` | `OPENAI_API_KEY` | `/v1/chat/completions` | `response_format` strict schema |
| `gemini` | `GEMINI_API_KEY` | `:generateContent` | `responseSchema` |

All four AI calls go through HTTP Request nodes that read `$json._llm` — the
url, auth header and body that [`n8n/code/lib.js`](n8n/code/lib.js) built for
whichever provider is configured. That file also absorbs the awkward parts:
OpenAI's strict mode rejects `minimum`/`maximum`, and Gemini wants an OpenAPI
dialect where `["string","null"]` becomes `nullable: true`. One schema is
written per call and reshaped per provider.

Per-stage models are supported, since extraction is the high-volume step:

```
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_MODEL_EXTRACT=claude-opus-5    # point this at something cheaper
```

Model names change. If `npm run doctor` reports a rejected model, set that
provider's `*_MODEL` to one your account lists.

---

## Layout

```
SETUP.md                 Start here if you're not a developer
docker-compose.yml       n8n + apply-svc, one command
.env                     Everything configurable (gitignored)
scripts/setup.mjs        Validate, bake, build
scripts/doctor.mjs       Health check with a live AI test call
docs/distill-setup.md    Monitor config — 70% of reliability lives here
docs/runbook.md          Phased build order, failure modes, daily checks
docs/blueprint.html      The design reference, publishable as a web page
sheets/bootstrap.gs      Apps Script that creates the 4 tabs
sheets/schema.md         Column reference and the status state machine
n8n/code/*.js            Code-node sources (edit these)
n8n/workflows/*.json     Templates with @@include: references
n8n/dist/*.json          Generated — import these into n8n
prompts/*.md             Prompt + schema reference for each AI call
profile/*.json           Your details (gitignored; .example.json is committed)
apply-svc/               Playwright service: form submission + PDF rendering
```

`n8n/code/*.js` is the source of truth. n8n stores Code-node bodies as one
escaped JSON string, which is miserable to edit and drifts immediately, so
`setup.mjs` injects the real files at build time — which also means the parsing
logic can be tested outside n8n, and it is.

Never hand-edit `n8n/dist/` or the code inside the n8n editor; both are
regenerated.

---

## How it runs

**Workflow 01 — Ingest & Score** (daily 09:00)

The raw payload lands in `raw_inbox` *before* anything parses it, because a
Distill webhook fire is not replayable and you only get 30 a month. Then: parse
the diff into job blocks → one batched AI call per ~20 blocks to extract
structure → dedupe against the sheet in memory → free hard filters from
`profile.json` (typically drop 50–60%) → score the survivors → write to `jobs`
with a status.

**Workflow 02 — Tailor & Apply** (daily 10:00)

Reads everything at `status = queued`, one job at a time: tailor the resume →
write a cover letter → render to PDF → archive to Drive → submit through the
matching ATS handler → record the outcome and transition the status.

The `status` column is the whole resume mechanism. Every stage reads one status
and writes another, so if a run dies halfway, tomorrow's picks up whatever is
still `queued` with no recovery logic.

```
new → enriched → scored → queued → applied
                   ↓         ↓
                review     manual / failed / expired
                   ↓
                skipped
```

---

## Why the webhook is a clock, not a pipe

Distill allows 30 webhook calls a month — exactly one a day with nothing spare.
So the schedule trigger (free, unlimited) is the real clock, and Distill's
unmetered **email** action carries the actual job data into a Gmail label.
The 30 webhooks become a bonus early-trigger lane for one high-priority
monitor.

[docs/blueprint.html](docs/blueprint.html) explains this in full, with
diagrams. [docs/distill-setup.md](docs/distill-setup.md) has the exact monitor
settings.

---

## Safety defaults

- `DRY_RUN=true` — apply-svc fills every field, screenshots, and stops before
  submitting. Jobs stay `queued`, so nothing is lost while you evaluate.
- `MAX_APPLICATIONS_PER_RUN=8`, concurrency 1, 45–120s apart.
- Every attempt screenshots before and after submit into `apply-svc/artifacts/`.
- Unrecognised ATS → `manual`, with the tailored PDF already generated.
- Telegram notifications are off unless you set `TELEGRAM_ENABLED=true`.
- LinkedIn Easy Apply is `manual` unless you set `LINKEDIN_AUTOSUBMIT=true`.
  Read the header comment in
  [apply-svc/src/ats/linkedin.js](apply-svc/src/ats/linkedin.js) first —
  automated applying is against their User Agreement, restrictions happen, and
  it is the account recruiters use to reach you.

---

## Cost and quota

Distill: 30 webhook calls ÷ 1 per day = exactly 30 days. A 31-day month runs
out on the last day, which is why the schedule is the clock.

AI: batched extraction plus hard-filtering before scoring keeps a realistic
month in single digits of dollars. Per-job unbatched extraction will not.

Google Sheets: ~60 writes/minute/user. Every sheet node appends in batch and
reads once per run. Do not add a per-item lookup.
