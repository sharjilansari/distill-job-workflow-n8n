#!/usr/bin/env node
/**
 * npm run sources
 *
 * Fetches every source you enabled in profile/profile.json and prints the rows
 * the pipeline would write, without touching n8n, Google Sheets, or your AI
 * key. Nothing is written anywhere — this only reads.
 *
 * It runs the *actual* Code-node files, in the same order and with the same
 * shared helpers n8n injects, so what you see here is what the workflow does.
 * That is the point: a source that breaks should break here first, on your
 * machine, in two seconds, instead of silently at 09:00 tomorrow.
 *
 *   npm run sources              summary + a sample of the rows
 *   npm run sources -- --all     every row
 *   npm run sources -- --json    the normalized jobs as JSON, for piping
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, c, ok, bad, warn, info, head, loadEnv, readJson } from './env.mjs';

const CODE_DIR = path.join(ROOT, 'n8n', 'code');
const args = process.argv.slice(2);
const SHOW_ALL = args.includes('--all');
const AS_JSON = args.includes('--json');
const SAMPLE = SHOW_ALL ? Infinity : 12;

// ---------------------------------------------------------------------------
// Config: same files setup.mjs reads, same precedence.
// ---------------------------------------------------------------------------

// lib.js reads process.env directly, exactly as it does inside the container.
Object.assign(process.env, loadEnv());

function profilePath() {
  const live = path.join(ROOT, 'profile', 'profile.json');
  return existsSync(live) ? live : path.join(ROOT, 'profile', 'profile.example.json');
}

const profileFile = profilePath();
const profile = readJson(profileFile);
if (profileFile.endsWith('.example.json')) {
  warn('Using profile.example.json — you have not created profile/profile.json yet.');
}

// ---------------------------------------------------------------------------
// Run a real Code-node file with n8n's globals shimmed.
// ---------------------------------------------------------------------------

const prelude = [
  `const PROFILE = ${JSON.stringify(profile)};`,
  'const MASTER_RESUME = {};',
  readFileSync(path.join(CODE_DIR, 'lib.js'), 'utf8'),
].join('\n');

const quiet = [];
function runNode(file, { input = [], nodes = {} }) {
  const src = `${prelude}\n// ---- ${file} ----\n${readFileSync(path.join(CODE_DIR, file), 'utf8')}`;

  const wrap = (items) => ({
    all: () => items,
    first: () => items[0],
    last: () => items[items.length - 1],
  });
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`no node named "${name}"`);
    return wrap(nodes[name]);
  };
  // Node logs are collected rather than printed inline, so the summary below
  // stays readable. They are shown under --all.
  const shimConsole = { log: (...a) => quiet.push(a.join(' ')) };

  // eslint-disable-next-line no-new-func
  return new Function('$input', '$', 'console', src)(wrap(input), $, shimConsole);
}

// ---------------------------------------------------------------------------

console.log(`\n${c.bold}Job sources${c.reset}`);
head('1. Building requests');

const loadProfileItems = [{ json: { profile, config: {} } }];
let requests;
try {
  requests = runNode('20-build-source-requests.js', {
    input: loadProfileItems,
    nodes: { 'Load Profile': loadProfileItems },
  });
} catch (e) {
  bad(e.message);
  console.log(`\nEdit ${c.bold}${path.relative(ROOT, profileFile)}${c.reset} and try again.\n`);
  process.exit(1);
}

for (const line of quiet.splice(0)) info(line.replace(/^sources: /, ''));
ok(`${requests.length} request(s) to make`);

// ---------------------------------------------------------------------------

head('2. Fetching');

const responses = [];
for (const [idx, item] of requests.entries()) {
  const { _req: req, source, label } = item.json;
  const started = Date.now();
  let body;
  let status = 0;
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    const raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      // The workflow's HTTP node has neverError set, so a non-JSON body
      // reaches the normalizer as-is and the schema guard reports it. Same
      // here, so the two behave identically.
      body = { error: `not JSON (HTTP ${status}): ${raw.slice(0, 120)}` };
    }
  } catch (e) {
    body = { error: e.message };
  }
  const ms = Date.now() - started;
  const line = `${source}${label ? ` [${label}]` : ''} — HTTP ${status || 'ERR'} in ${ms}ms`;
  if (status >= 200 && status < 300) ok(line);
  else bad(line);
  responses.push({ json: body, pairedItem: { item: idx } });
}

// ---------------------------------------------------------------------------

head('3. Normalizing');

const [normalized] = runNode('21-normalize-api-jobs.js', {
  input: responses,
  nodes: { 'Build Source Requests': requests },
});
const { jobs, health } = normalized.json;

for (const h of health) {
  const line =
    `${h.source}${h.label ? ` [${h.label}]` : ''}: ` +
    `${h.rows} record(s) → ${c.bold}${h.jobs}${c.reset} job(s)` +
    (h.note ? ` ${c.grey}(${h.note})${c.reset}` : '');
  if (!h.ok) bad(line);
  else if (h.jobs === 0) warn(line);
  else ok(line);
}
quiet.splice(0);

// ---------------------------------------------------------------------------

head('4. After your hard filters');

const hardFiltered = runNode('06-hard-filters.js', {
  input: jobs.map((json) => ({ json })),
  nodes: { 'Load Profile': loadProfileItems },
});
for (const line of quiet.splice(0)) info(line);

const kept = hardFiltered.filter((i) => !i.json.filtered_out).map((i) => i.json);
const cut = hardFiltered.length - kept.length;
ok(`${kept.length} job(s) would be scored, ${cut} dropped before any token was spent`);

if (AS_JSON) {
  console.log(JSON.stringify(kept, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------

head(`5. What would land in the sheet${kept.length > SAMPLE ? ` (first ${SAMPLE})` : ''}`);

if (!kept.length) {
  warn('Nothing survived. Widen filters.title_allowlist or filters.allowed_locations,');
  info('or lower "max_age_days" under sources — a 1-day window on a quiet day is empty.');
} else {
  // slice one short of the width so long values keep a gap after them.
  const pad = (s, n) => String(s ?? '').slice(0, n - 1).padEnd(n);
  console.log(
    `  ${c.grey}${pad('SOURCE', 11)}${pad('TITLE', 34)}${pad('COMPANY', 24)}` +
    `${pad('LOCATION', 20)}${pad('EXP', 6)}POSTED${c.reset}`
  );
  for (const j of kept.slice(0, SAMPLE)) {
    const exp = j.experience_min === null ? '' : `${j.experience_min}-${j.experience_max ?? ''}y`;
    console.log(
      `  ${pad(j.source, 11)}${pad(j.title, 34)}${pad(j.company, 24)}` +
      `${pad(j.location || '—', 20)}${pad(exp, 6)}${(j.posted_at || '').slice(0, 10)}`
    );
  }
}

const unhealthy = health.filter((h) => !h.ok);
console.log(
  `\n  ${c.bold}${jobs.length}${c.reset} job(s) fetched, ` +
  `${c.bold}${kept.length}${c.reset} pass your filters, ` +
  `${c.bold}0${c.reset} AI calls spent.`
);
if (unhealthy.length) {
  console.log(
    `  ${c.red}${unhealthy.length} source(s) look broken.${c.reset} ` +
    `If one changed shape, fix its adapter in ${c.bold}n8n/code/21-normalize-api-jobs.js${c.reset}.`
  );
}
console.log(
  `  ${c.grey}Change what is fetched in ${path.relative(ROOT, profileFile)} → "sources", ` +
  `then run "npm run setup" to push it into the workflow.${c.reset}\n`
);
