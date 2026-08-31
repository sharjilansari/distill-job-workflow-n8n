# Distill setup

> **Read [sources.md](sources.md) first.** Distill is Tier 2 — it covers sites
> with no API. The free plan gives you **30 alerts a month across email and
> webhook together**, not thirty webhooks plus unlimited email, so it cannot be
> the data path for a daily pipeline. Tier 1 (job APIs) carries the volume;
> what follows is for the sites Tier 1 cannot reach, and for spending those
> thirty alerts well.

A badly configured monitor produces a diff every check, and every one of those
costs tokens, fills `raw_inbox`, and regenerates jobs you already saw. On a
30-alert budget it also burns the month in a week.

---

## 1. Pre-filter at the URL

Do not monitor "LinkedIn jobs". Monitor a search URL with the filters already
applied, so fewer results arrive and fewer tokens are spent.

**LinkedIn**

```
https://www.linkedin.com/jobs/search/?keywords=react%20developer&location=Bengaluru&f_TPR=r86400&f_E=2%2C3&f_WT=2&sortBy=DD
```

| Param | Meaning |
|---|---|
| `f_TPR=r86400` | posted in the last 24 hours (seconds) |
| `f_E=2,3` | experience level: entry, associate |
| `f_WT=2` | remote (`1` on-site, `3` hybrid) |
| `sortBy=DD` | sort by date, newest first |

`f_TPR=r86400` matters most: it makes the page itself only show today's jobs,
so the daily diff is naturally the day's new listings.

**Naukri** — build the search in the UI, then copy the resulting URL. It
encodes experience and location into the path.

**Wellfound / Cutshort** — same approach: filter in the UI, copy the URL that
results. (Instahyre and foundit.in do not belong here — they have APIs, and
Tier 1 pulls them for free. See [sources.md](sources.md).)

---

## 2. Select the list, not the page

Use Distill's element picker on the `<ul>` or `<div>` that wraps the result
cards. Selecting the whole page means the header, footer, sidebar ads and
"jobs you may like" all contribute to the diff.

---

## 3. Text mode, never HTML

HTML mode diffs on class-name churn. Every one of these sites ships CSS-in-JS
with generated class names that change between deploys, so HTML mode fires
constantly with no job change at all.

---

## 4. Add the noise filters

In the monitor's **filter/regex** settings, strip anything that changes without
a new job existing:

```
\d+\s+applicants?
(over|about)?\s*\d+\s*(second|minute|hour|day|week|month)s?\s+ago
^(Promoted|Viewed|Easy Apply|Actively hiring|Be an early applicant)$
^\d+\s+(job|result)s?\s+found$
```

Skipping this step is the single most common reason one of these pipelines
processes the same forty jobs every day forever.

The same patterns are also stripped in
[n8n/code/03-parse-diff.js](../n8n/code/03-parse-diff.js) as a second line of
defence, but filtering at Distill is better — it stops the change from being
recorded at all.

---

## 5. Interval and schedule

Set the check interval to **24 hours** at a fixed hour, around 08:30 — half an
hour before workflow 01 runs.

This is what makes the batching work. Distill diffs against the last snapshot
it took, so a 24-hour interval means one check produces one change event
containing *everything* posted that day. A 15-minute interval would produce
~96 fragmentary events instead.

---

## 6. Actions

### Email — one alert of your thirty

Set the action to Email, with the subject templated as:

```
[DISTILL] {{name}}
```

Then in Gmail: **Settings → Filters → Create a new filter**

- Subject contains: `[DISTILL]`
- Apply label: `distill/jobs`
- Skip the inbox

Workflow 01 queries `label:distill/jobs is:unread newer_than:2d`. The
`newer_than` guard means a Gmail credential hiccup does not replay a month of
history on the next successful run.

Email alerts are metered exactly like webhooks — one shared allowance of 30 a
month on the free plan. Ten monitors alerting daily is not thirty alerts, it is
three hundred, and the ones after the thirtieth are simply never sent. Pick one
or two searches worth an alert; put everything else on Tier 1.

### Webhook — paid plans only

The webhook action is not available on the free plan at all; it starts at
Starter. If you are on a paid plan, point one monitor at the `Distill Webhook`
node as an early-trigger lane for your single highest-priority search, and let
the schedule handle the rest.

Point it at the production URL of the `Distill Webhook` node in workflow 01,
and template the body:

```json
{
  "name": "{{name}}",
  "uri": "{{uri}}",
  "text": "{{text}}",
  "diff": "{{diff}}",
  "timestamp": "{{timestamp}}"
}
```

**Placeholder names vary** between the browser extension and Distill Cloud.
Before wiring it up, point the action at a request-bin (webhook.site or
similar), trigger one change, and copy what actually arrives.
[n8n/code/01-normalize-webhook.js](../n8n/code/01-normalize-webhook.js) accepts
both `diff` and `text` and falls back gracefully, but it cannot invent a field
Distill never sends.

---

## 7. The canary

Silent monitor failure is the number one way this system dies — a changed
selector or an expired login, and for two weeks you assume nobody is hiring.

Two checks worth wiring:

1. **In n8n**: if `raw_inbox` gains no rows on two consecutive runs, send
   yourself a Telegram alert. Distill going quiet is a bug, not good news.
2. **In Distill**: open the watchlist weekly and look at "last changed" per
   monitor. A monitor that has not changed in ten days on a `f_TPR=r86400`
   search is broken, not lucky.

If a LinkedIn monitor starts returning nothing, the usual cause is session
expiry — Distill is now diffing a login wall. Re-authenticate in the browser
where the extension runs.
