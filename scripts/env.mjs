// Shared .env handling for setup and doctor. No dependencies — this file runs
// before anyone has installed anything.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[36m', grey: '\x1b[90m',
};

export const ok = (m) => console.log(`  ${c.green}✓${c.reset} ${m}`);
export const bad = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`);
export const warn = (m) => console.log(`  ${c.yellow}!${c.reset} ${m}`);
export const info = (m) => console.log(`  ${c.grey}·${c.reset} ${m}`);
export const head = (m) => console.log(`\n${c.bold}${m}${c.reset}`);

/** Minimal .env parser: KEY=value, # comments, optional quotes. */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function readJson(file) {
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    // A JSON syntax error in a hand-edited file is the single most likely
    // failure here, so point at the line instead of dumping a parser message.
    const pos = Number((e.message.match(/position (\d+)/) || [])[1]);
    const where = Number.isFinite(pos)
      ? ` (around line ${text.slice(0, pos).split('\n').length})`
      : '';
    throw new Error(`${path.basename(file)} is not valid JSON${where}: ${e.message}`);
  }
}

/** Which provider is configured, and which key it needs. */
export const PROVIDERS = {
  anthropic: { key: 'ANTHROPIC_API_KEY', label: 'Claude (Anthropic)', modelVar: 'ANTHROPIC_MODEL', defaultModel: 'claude-opus-5' },
  openai:    { key: 'OPENAI_API_KEY',    label: 'ChatGPT (OpenAI)',   modelVar: 'OPENAI_MODEL',    defaultModel: 'gpt-4o' },
  gemini:    { key: 'GEMINI_API_KEY',    label: 'Gemini (Google)',    modelVar: 'GEMINI_MODEL',    defaultModel: 'gemini-2.0-flash' },
};

export function providerOf(env) {
  const name = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  return { name, ...(PROVIDERS[name] || {}) };
}
