# Setup

You do not need to know how to code. You will copy some things, paste some
things, and click "Sign in with Google" a few times. Budget about 45 minutes,
most of it waiting.

If anything goes wrong, run `npm run doctor` — it checks everything it can and
tells you what to fix in plain words.

---

## What you need first

**Docker Desktop** — this runs everything for you.
Download from [docker.com](https://www.docker.com/products/docker-desktop/), install it,
and **start it**. You should see a whale icon in your taskbar before continuing.

**Node.js** — used only by the setup script.
Download the "LTS" version from [nodejs.org](https://nodejs.org/) and install it.

**An AI account** — one of these, whichever you already have:

| | Where to get a key |
|---|---|
| Claude | [console.anthropic.com](https://console.anthropic.com/settings/keys) → API Keys → Create Key |
| ChatGPT | [platform.openai.com](https://platform.openai.com/api-keys) → Create new secret key |
| Gemini | [aistudio.google.com](https://aistudio.google.com/apikey) → Get API key |

These are **API keys**, which are separate from a ChatGPT Plus or Claude Pro
subscription. You pay per use, and this system is designed to be cheap — a
realistic month is a few dollars.

Copy the key somewhere safe now. Most providers show it only once.

---

## Step 1 — Open a terminal here

**Windows:** open the `worklfow` folder in File Explorer, click the address bar,
type `powershell`, press Enter.

**Mac:** right-click the folder → Services → New Terminal at Folder.

Then run:

```
npm run setup
```

It will say there is no `.env` yet and create one for you. That is expected.

---

## Step 2 — Fill in the settings file

Open the file called `.env` that just appeared. On Windows:

```
notepad .env
```

It is a plain list of settings with instructions above each one. You only need
the four lines marked **REQUIRED**. Everything else already has a sensible
value.

**a) Which AI to use** — set one of `anthropic`, `openai`, or `gemini`:

```
LLM_PROVIDER=anthropic
```

**b) Your key** — paste it after the `=` for the one you chose:

```
ANTHROPIC_API_KEY=sk-ant-paste-yours-here
```

**c) A password for the system to talk to itself** — mash the keyboard:

```
APPLY_TOKEN=k4j2hg8sdf7g6h5j4k3l2m1n0p9q8r7s
```

**d) Your spreadsheet** — you will get this in the next step. Leave it blank
for now.

Save and close.

---

## Step 3 — Make the spreadsheet

1. Go to [sheets.new](https://sheets.new) — a blank Google Sheet opens.
2. Name it something like **Job Agent**.
3. In the menu: **Extensions → Apps Script**.
4. Delete whatever is in the code box.
5. Open `sheets/bootstrap.gs` from this project, copy **everything** in it,
   paste it into the code box.
6. Click the **Save** icon, then **Run**.
7. Google will ask for permission. Click **Review permissions → your account →
   Advanced → Go to Untitled project (unsafe) → Allow**. This is Google warning
   you about your own script; it is safe.
8. Go back to the spreadsheet tab. It now has four tabs at the bottom:
   `raw_inbox`, `jobs`, `applications`, `run_log`.

Now copy the sheet's ID. Look at the web address:

```
docs.google.com/spreadsheets/d/1a2B3cD4eF5gH6iJ7kL8mN9oP0qR/edit
                               └──────── this bit ────────┘
```

Paste it into `.env`:

```
GOOGLE_SHEET_ID=1a2B3cD4eF5gH6iJ7kL8mN9oP0qR
```

---

## Step 4 — Tell it about yourself

Two files in the `profile` folder. Open each, replace the example details with
yours, and save. They are plain text — just be careful to keep the quotes and
commas where they are.

**`profile/profile.json`** — your name, contact details, your stack, and the
filters that decide which jobs are worth looking at at all. The `filters`
section is worth a minute of thought: `title_allowlist` is words that should
appear in a job title you would take, `title_blocklist` is words that mean
"definitely not me". These run before any AI call, so they cost nothing and
usually remove half the jobs.

**`profile/master-resume.json`** — everything you have actually done. This is
the only source of facts the resume writer is allowed to use; it is forbidden
from inventing anything, so whatever is not in here will never appear on a
resume.

Then run setup again:

```
npm run setup
```

It should now say **Ready**. If it lists problems, each one says what to fix.

---

## Step 5 — Start it

```
docker compose up -d
```

The first time this takes a few minutes — it downloads n8n and a browser. When
it finishes:

```
npm run doctor
```

This checks the services are up and makes a real test call to your AI provider,
so a wrong key gets caught right now rather than at 9am next Tuesday.

---

## Step 6 — Connect Google

Open **http://localhost:5678** in your browser. Create an account when it asks
— this is your own private n8n, the account is local to your machine.

**Import the two workflows:**

1. Top right **⋯ → Import from File**
2. Choose `n8n/dist/01-ingest-and-score.json`
3. Repeat for `n8n/dist/02-tailor-and-apply.json`

**Connect your Google account** (three times — Sheets, Gmail, Drive):

1. Left sidebar → **Credentials → Add credential**
2. Search **Google Sheets OAuth2**, choose it
3. Click **Sign in with Google**, pick your account, allow access
4. Repeat for **Gmail OAuth2** and **Google Drive OAuth2**

> If n8n asks for a Client ID and Secret instead of a sign-in button, follow the
> link it shows to n8n's Google setup guide. It is a ten-minute detour through
> Google Cloud Console, done once.

**Attach them:** open each workflow, click any Google node, and pick the
credential you just made from the dropdown. Do this once per Google node —
n8n usually preselects it for the rest.

Finally, toggle both workflows **Active** (top right).

---

## Step 7 — Choose what to watch

This is the one part nobody can automate for you, because it means choosing
which searches to watch. There is no setup beyond editing a file.

Open `profile/profile.json`, find the `sources` block, and put your own skills,
job titles and cities in it. Then:

```
npm run sources
```

That fetches every source and prints the jobs it would write — no AI call, no
spreadsheet write, nothing saved. Adjust and re-run until the list looks like
jobs you would actually apply to, then `npm run setup` to push it into the
workflow. **[docs/sources.md](docs/sources.md)** explains every setting.

Optional, and only worth it for sites with no API of their own:
**[docs/distill-setup.md](docs/distill-setup.md)** sets up page-change
monitoring. Note that Distill's free plan sends **30 alerts a month in total**,
so it is a canary for one or two searches, not a way to watch ten boards.

---

## You are done

Tomorrow morning at 9am the first run happens. Open your spreadsheet and look
at the `jobs` tab.

**Nothing is being submitted yet.** `DRY_RUN=true` means the system fills in
application forms, takes a screenshot, and stops. The screenshots land in
`apply-svc/artifacts/`. Look at a dozen of them over the first week or two.

When you are happy with what it would have sent, open `.env`, change:

```
DRY_RUN=false
```

then:

```
docker compose restart
```

**[docs/runbook.md](docs/runbook.md)** has a phased plan for getting there
safely, and what to check each morning.

---

## Common problems

**"docker: command not found"** — Docker Desktop is not installed, or not
started. Look for the whale icon.

**"npm: command not found"** — Node.js is not installed, or the terminal was
open before you installed it. Close it and open a new one.

**doctor says the key was rejected** — the key was pasted wrong. Check there
are no spaces or quotes around it in `.env`, and no missing characters at
either end.

**doctor says the model was rejected** — your account does not have that model.
Open `.env` and set `OPENAI_MODEL` (or `GEMINI_MODEL` / `ANTHROPIC_MODEL`) to
one your account lists on the provider's website.

**Nothing appears in the spreadsheet after a day** — run `npm run sources`.
It shows each source's health and how many jobs survive your filters, which
separates "the sources broke" from "my filters are too narrow" in one command.
If you also use Distill, check its emails are arriving under the `distill/jobs`
label.

**Everything says `manual` in the status column** — expected if you are
watching mostly LinkedIn and Naukri. Those sites do not have automatable
application forms. Add company boards to `sources` in `profile/profile.json` —
Greenhouse, Lever and Ashby are all free to pull from and all three are ATSes
this system can submit to end to end.

**I want to change something** — almost everything lives in `.env` or the two
profile files. Edit, then:

```
npm run setup
docker compose restart
```

and re-import the workflows if `npm run setup` rebuilt them.
