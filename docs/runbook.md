# Runbook

## Build order

Do not build this top to bottom. Build it in slices that each work end to end,
and let real data tell you what to fix next.

### Phase 1 — prove the pipe (one evening)

One Distill monitor on one LinkedIn search → email → n8n Gmail node → append
raw text to `raw_inbox`. Nothing else. Disable every node after
`Append Raw Inbox`.

**Done when:** data arrives on its own for two consecutive days and the diff
contains what you expect.

### Phase 2 — structure it (one evening)

Enable through `Hard Filters` and `Write Jobs Sheet`. Run for three days, then
read the `jobs` tab by hand.

This is the tuning phase and it is not optional. You are looking for:

- the same job appearing twice → tighten `canonicalUrl` or `fingerprint`
- obvious non-jobs in the sheet → add a Distill regex filter, or a word to
  `filters.title_blocklist` in `profile/profile.json`
- real jobs missing → your `TITLE_HINT` heuristic is splitting blocks wrong
- the same forty jobs every morning → Distill noise filters are not applied

**Done when:** a morning's `jobs` rows are jobs you would actually consider,
with no repeats from yesterday.

### Phase 3 — score it (half a day)

Enable the scoring branch. Run a week in evaluation only — score everything,
apply to nothing.

Read the scores against your own judgement. If everything clusters at 80–90,
the "be harsh" instruction is not biting; make the rubric in
[n8n/code/req-score.js](../n8n/code/req-score.js) stricter until a 90 genuinely
means you want that job.

**Done when:** you agree with the model on nine of ten borderline calls.

### Phase 4 — tailor (one day)

Enable workflow 02 through `Upload Resume to Drive`. Still applying to nothing.

Read ten generated resumes end to end. If you would not send them yourself, the
automation should not either. Check specifically that nothing was invented —
the prompt forbids it, but verify rather than trust.

**Done when:** ten resumes in a row are ones you would send unedited.

### Phase 5 — apply, narrowly (two days)

Greenhouse only. Leave `DRY_RUN=true` in `.env` for the first day and read
every screenshot. Then set `DRY_RUN=false` and `MAX_APPLICATIONS_PER_RUN=3`,
run `docker compose restart`, and watch each one.

**Done when:** ~20 Greenhouse submissions land with `result: success` and the
after-screenshots show real confirmation pages.

### Phase 6 — widen

Add Lever, then Ashby. Raise the cap toward 8. Keep LinkedIn on `manual`.

---

## Daily check (about 60 seconds)

1. Telegram summary arrived? If not, workflow 02 did not run.
2. `raw_inbox` gained rows today? If not, a monitor is broken — see the canary
   section in [distill-setup.md](distill-setup.md).
3. Any `jobs` rows at `failed`? Open the error screenshot in
   `apply-svc/artifacts/`.
4. Any at `review`? Decide, and set them to `queued` or `skipped` in the sheet.

---

## Failure modes

### Distill diffs on noise

**Symptom:** the same jobs re-extracted every morning; `raw_inbox` rows are
large and mostly identical.
**Fix:** the regex filters in the Distill monitor, not in n8n. Filtering at the
source stops the change from being recorded at all.

### Google Sheets 429

**Symptom:** `Quota exceeded for quota metric 'Write requests'`.
**Fix:** something is writing per item. Every sheets node here appends in batch
and reads once per run — check anything you added.

### LinkedIn session expiry

**Symptom:** a monitor stops changing; extracted job count drops to zero on one
source while others are fine.
**Fix:** re-authenticate in the browser running the Distill extension. Happens
every two to four weeks. For apply-svc, re-run `npm run login -- linkedin`.

### Scores cluster high

**Symptom:** everything is 85–95, the queue fills with mediocre matches.
**Fix:** the rubric, not the threshold. Raising `AUTO_APPLY_THRESHOLD` to 92
just moves the problem. Make the scoring prompt in
[n8n/code/req-score.js](../n8n/code/req-score.js) harsher, add explicit
penalties, then `npm run setup` and re-import.

### Resume PDF renders blank or unstyled

**Symptom:** `Render PDF` returns a file but it is empty or has no colours.
**Fix:** `printBackground: true` is already set in
[apply-svc/src/pdf.js](../apply-svc/src/pdf.js). A blank page usually means
`resume_html` was empty — check that `Render Resume HTML` parsed the tailoring
response.

### Application submitted but unconfirmed

**Symptom:** `result: submitted_unconfirmed`.
**Fix:** the form went through but no confirmation text matched. Look at the
after-screenshot; if it shows a real confirmation page, add its wording to that
handler's `confirm()`.

### Everything at `manual`

**Symptom:** nothing auto-applies.
**Fix:** expected if your sources are mostly LinkedIn and Naukri. Those are
consumer boards without stable form markup. The ATS handlers pay off when your
monitors include company career pages, which are overwhelmingly Greenhouse,
Lever, or Ashby underneath.

---

## Things worth adding later, in order

1. **JD enrichment.** Right now scoring often runs on title + company only,
   because the Distill diff rarely contains the full description. Add a step
   between `Dedupe` and `Hard Filters` that fetches the JD — an HTTP node for
   Greenhouse/Lever/Ashby (they expose predictable JSON) and apply-svc for the
   rest. This is the single largest quality improvement available.
2. **Reply detection.** A Gmail trigger that watches for interview invitations
   and flips the matching `applications` row. Closes the loop.
3. **Analytics.** Response rate by source, by score band, by resume variant.
   Three months in, this tells you which parts of the pipeline are earning
   their keep.
4. **Postgres instead of Sheets.** Only once the `jobs` tab passes a few
   thousand rows and reads get slow. Sheets is genuinely fine before that, and
   being able to hand-edit a status column is worth a lot during tuning.
