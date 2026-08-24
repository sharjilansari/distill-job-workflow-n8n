import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger.js';

const SESSION_DIR = process.env.SESSION_DIR || './sessions';
const HEADLESS = process.env.HEADLESS !== 'false';

// A real UA and viewport. Not evasion — the default Playwright UA advertises
// HeadlessChrome, which some ATS form validators reject outright.
const CONTEXT_DEFAULTS = {
  viewport: { width: 1440, height: 900 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: HEADLESS,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
  }
  return browserPromise;
}

export function sessionPath(site) {
  return path.join(SESSION_DIR, `${site}.json`);
}

/**
 * Runs `fn` with a fresh context, restoring a saved login for `site` if one
 * exists. Contexts are per-application so a crash never poisons the next run.
 */
export async function withContext(site, fn) {
  const browser = await getBrowser();
  const storagePath = sessionPath(site);
  const hasSession = site && existsSync(storagePath);

  const context = await browser.newContext({
    ...CONTEXT_DEFAULTS,
    ...(hasSession ? { storageState: storagePath } : {}),
  });
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(60_000);

  if (site && !hasSession) {
    log.warn(`no saved session for ${site}; run "npm run login -- ${site}" if it needs auth`);
  }

  try {
    return await fn(context);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Saves a screenshot and returns its path, for the applications sheet. */
export async function shoot(page, applicationId, label, dir) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${applicationId}-${label}.png`);
  const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
  if (!buffer) return '';
  await writeFile(file, buffer);
  return file;
}

/** Human-ish pause. Job boards throttle bursts far more than steady traffic. */
export async function pace() {
  const min = Number(process.env.MIN_DELAY_MS || 45_000);
  const max = Number(process.env.MAX_DELAY_MS || 120_000);
  const ms = min + Math.random() * Math.max(0, max - min);
  log.info(`pacing ${Math.round(ms / 1000)}s`);
  await new Promise((r) => setTimeout(r, ms));
}

export async function shutdownBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  await browser.close().catch(() => {});
  browserPromise = null;
}
