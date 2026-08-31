# Sheet schema

Four tabs, created by [bootstrap.gs](bootstrap.gs). The `jobs.status` column is
the backbone of the whole system — everything else is bookkeeping.

## The state machine

Every stage reads rows in one status and writes another. That is what makes the
pipeline resumable: if a run dies, the next one picks up whatever is still in
an open status, with no special recovery logic.

```
                 workflow 01                      workflow 02
  ┌──────┐  extract   ┌────────┐  score   ┌────────┐  apply   ┌─────────┐
  │ new  │───────────▶│ scored │─────────▶│ queued │─────────▶│ applied │
  └──────┘            └────────┘          └────────┘          └─────────┘
      │                    │                   │
      │ enrich             │ 70-84             │ blocked / unknown ATS
      ▼                    ▼                   ▼
  ┌──────────┐        ┌────────┐         ┌────────┐
  │ enriched │        │ review │         │ manual │
  └──────────┘        └────────┘         └────────┘
                           │                   
      hard filter or <70   │  you decide       submit error
              ▼            ▼                       ▼
         ┌─────────┐  (queued / skipped)      ┌────────┐
         │ skipped │                          │ failed │──▶ retried next run
         └─────────┘                          └────────┘    up to 3 attempts

  21 days open with no application ──▶ expired  (housekeeping())
```

Rules that keep it honest:

- A node may only move a row **out of the status it selected on**. Nothing
  writes `applied` except the apply path.
- `dry_run` results leave the row at `queued` — nothing was submitted, so
  nothing should look like it was.
- `failed` increments `attempts`. At 3 the row stops being selected.
- `review` is the only status a human is expected to change by hand.

---

## `jobs`

| Column | Notes |
|---|---|
| `job_id` | Generated, `job_<base36>`. Match key for updates. |
| `fingerprint` | `hash(company \| title \| city)`. Catches reposts under a new URL. |
| `source` | Which source found it: `instahyre`, `foundit`, `greenhouse`, `lever`, `ashby`, `remoteok`, `arbeitnow`, `adzuna`, `jooble` for Tier 1; `linkedin`, `naukri`, … for page-diff ingestion |
| `company`, `title`, `location` | From the source's own JSON (Tier 1) or extracted by the LLM (Tier 2) |
| `remote_type` | onsite / hybrid / remote / unknown |
| `experience_min`, `experience_max` | Integer years, null if unstated |
| `salary` | Free text, usually empty |
| `url` | As found |
| `canonical_url` | Tracking params stripped; the primary dedupe key |
| `jd_text` | Full description, empty until you add enrichment |
| `posted_at`, `discovered_at`, `run_id` | Provenance |
| `score`, `score_reason`, `missing_skills` | From the scoring call |
| `resume_variant` | frontend / react / fullstack |
| `status` | The state machine above. Dropdown-validated. |
| `attempts`, `last_error` | Retry accounting |
| `applied_at` | Set only on a real submission |

## `raw_inbox`

Untouched payloads from the page-diff lane, written *before* anything parses
them. A change alert is not replayable and the free plan sends 30 a month
across every channel, so this is the safety net: if the LLM node 429s at step
four, the day's data is already on disk.

Tier 1 API sources do not write here. An API response *is* replayable — the
same call tomorrow returns the same postings — so the row would cost quota to
buy nothing. `Normalize API Jobs` logs a per-source health line instead, and
`npm run sources` reproduces any run on demand.

`run_id`, `received_at`, `source_channel` (email/webhook), `monitor_name`,
`monitor_uri`, `raw_text`, `processed`

`housekeeping()` trims this to roughly 60 days.

## `applications`

One row per attempt, not per job — a job retried twice has two rows here and
one row in `jobs`.

`application_id`, `job_id`, `company`, `title`, `attempted_at`, `method`,
`ats`, `result`, `resume_url`, `cover_letter_url`, `screenshot_before`,
`screenshot_after`, `error`

`result` values: `success`, `submitted_unconfirmed`, `dry_run`, `manual`,
`unsupported`, `needs_human`, `captcha`, `login_required`, `not_easy_apply`,
`closed`, `no_form_found`, `failed`.

## `run_log`

`run_id`, `workflow`, `started_at`, `finished_at`, `raw_count`, `extracted`,
`deduped_new`, `filtered_out`, `scored`, `queued`, `applied`, `failed`, `notes`

Not written by the shipped workflows — add an append node at the end of each
once you want the trend. The most useful column is `raw_count`: two consecutive
zeros means a monitor broke.

---

## Useful views

Add these as filter views rather than sorting the sheet itself, so the
workflows' row indices stay stable.

- **Decide now:** `status = review`, sorted by `score` desc
- **Broken:** `status = failed` and `attempts >= 2`
- **Do by hand:** `status = manual`
- **This week's applications:** `applications` filtered on `attempted_at`
