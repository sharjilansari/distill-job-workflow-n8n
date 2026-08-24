#!/usr/bin/env node
/**
 * npm run doctor
 *
 * Checks everything that can be checked without you clicking anything, and
 * says in plain words what to do about whatever is wrong. Runs a real (tiny)
 * call against your AI provider, so a wrong key or a model name your account
 * cannot use is caught here rather than at 9am inside a workflow.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, c, ok, bad, warn, info, head, loadEnv, providerOf } from './env.mjs';

let problems = 0;
const fail = (m, fix) => { bad(m); if (fix) console.log(`      ${c.grey}→ ${fix}${c.reset}`); problems++; };

console.log(`\n${c.bold}Job Agent health check${c.reset}`);

// ---------------------------------------------------------------------------
head('Configuration');

if (!existsSync(path.join(ROOT, '.env'))) {
  fail('.env is missing', 'run: npm run setup');
  process.exit(1);
}
const env = loadEnv();
ok('.env found');

const provider = providerOf(env);
if (!provider.key) {
  fail(`LLM_PROVIDER="${env.LLM_PROVIDER}" is not valid`, 'use anthropic, openai or gemini');
} else if (!env[provider.key]) {
  fail(`${provider.key} is empty`, `add your ${provider.label} key to .env`);
} else {
  ok(`${provider.label}, key present`);
}

for (const k of ['GOOGLE_SHEET_ID', 'APPLY_TOKEN']) {
  if (env[k]) ok(`${k} set`);
  else fail(`${k} is empty`, 'fill it in .env');
}

if (!existsSync(path.join(ROOT, 'n8n', 'dist', '01-ingest-and-score.json'))) {
  fail('workflows have not been built', 'run: npm run setup');
} else {
  ok('workflows built in n8n/dist/');
}

if (!existsSync(path.join(ROOT, 'n8n', 'code', '_profile.generated.js'))) {
  fail('your profile has not been baked in', 'run: npm run setup');
} else {
  const gen = readFileSync(path.join(ROOT, 'n8n', 'code', '_profile.generated.js'), 'utf8');
  if (gen.includes('"Your Name"')) fail('profile still has example values', 'edit profile/profile.json, then: npm run setup');
  else ok('profile baked in');
}

// ---------------------------------------------------------------------------
head('Services');

async function ping(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const n8nUrl = env.N8N_URL || 'http://localhost:5678';
try {
  const r = await ping(`${n8nUrl}/healthz`);
  if (r.ok) ok(`n8n is up at ${n8nUrl}`);
  else fail(`n8n answered ${r.status}`, 'check: docker compose logs n8n');
} catch {
  fail(`n8n is not reachable at ${n8nUrl}`, 'start it with: docker compose up -d');
}

// From the host, apply-svc is on localhost even though n8n reaches it by name.
const applyUrl = (env.APPLY_SVC_URL || 'http://apply-svc:3000').replace('apply-svc', 'localhost');
try {
  const r = await ping(`${applyUrl}/health`);
  const body = await r.json();
  if (r.ok) {
    ok(`browser service is up (${body.handlers?.length || 0} job sites supported)`);
    if (body.dry_run) info('DRY_RUN is ON — forms get filled and screenshotted, never submitted');
    else warn('DRY_RUN is OFF — applications will really be submitted');
  } else {
    fail(`browser service answered ${r.status}`, 'check: docker compose logs apply-svc');
  }
} catch {
  fail(`browser service not reachable at ${applyUrl}`, 'start it with: docker compose up -d');
}

// ---------------------------------------------------------------------------
head(`Live test call to ${provider.label || 'your AI provider'}`);

if (!provider.key || !env[provider.key]) {
  info('skipped — no key configured');
} else {
  const model = env[provider.modelVar] || provider.defaultModel;
  const schema = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  };

  const REQ = {
    anthropic: () => ({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: {
        model, max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: 'Reply with {"ok":true}' }],
      },
      read: (j) => (j.content || []).find((b) => b.type === 'text')?.text,
    }),
    openai: () => ({
      url: `${env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: {
        model, max_tokens: 100,
        messages: [{ role: 'user', content: 'Reply with {"ok":true}' }],
        response_format: { type: 'json_schema', json_schema: { name: 'r', strict: true, schema } },
      },
      read: (j) => j.choices?.[0]?.message?.content,
    }),
    gemini: () => ({
      url: `${env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/${model}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with {"ok":true}' }] }],
        generationConfig: {
          maxOutputTokens: 100,
          responseMimeType: 'application/json',
          responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        },
      },
      read: (j) => j.candidates?.[0]?.content?.parts?.map((p) => p.text).join(''),
    }),
  }[provider.name]();

  try {
    const r = await ping(REQ.url, {
      method: 'POST',
      headers: REQ.headers,
      body: JSON.stringify(REQ.body),
      timeout: 60000,
    });
    const j = await r.json();

    if (!r.ok) {
      const msg = j?.error?.message || j?.error?.[0]?.message || JSON.stringify(j).slice(0, 200);
      if (r.status === 401 || r.status === 403) {
        fail(`${provider.label} rejected the key (${r.status})`, `check ${provider.key} in .env`);
      } else if (/model/i.test(msg)) {
        fail(`model "${model}" was rejected: ${msg}`, `set ${provider.modelVar} in .env to a model your account has`);
      } else {
        fail(`${provider.label} returned ${r.status}: ${msg}`);
      }
    } else {
      const text = REQ.read(j);
      JSON.parse(text);
      ok(`${provider.label} answered correctly using ${model}`);
      ok('structured JSON output is working');
    }
  } catch (e) {
    fail(`could not reach ${provider.label}: ${e.message}`, 'check your internet connection and the key in .env');
  }
}

// ---------------------------------------------------------------------------
head('Manual steps (nothing can check these for you)');
console.log(`  ${c.grey}·${c.reset} Google Sheets, Gmail and Drive connected inside n8n`);
console.log(`  ${c.grey}·${c.reset} Both workflows imported from n8n/dist/ and switched on`);
console.log(`  ${c.grey}·${c.reset} Distill monitors created — see docs/distill-setup.md`);

if (problems) {
  console.log(`\n${c.red}${c.bold}${problems} problem(s) found.${c.reset} Each one has a fix above.\n`);
  process.exit(1);
}
console.log(`\n${c.green}${c.bold}All automated checks passed.${c.reset}\n`);
