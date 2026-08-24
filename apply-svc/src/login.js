/**
 * One-time interactive login, so the service can reuse an authenticated
 * session without ever storing your password.
 *
 *   npm run login -- linkedin
 *   npm run login -- naukri
 *
 * Opens a real browser window. Log in by hand, solve any 2FA, then press
 * Enter in the terminal. The cookies land in sessions/<site>.json.
 *
 * Must run on your desktop, not in the container — it needs a display.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

const SITES = {
  linkedin: 'https://www.linkedin.com/login',
  naukri: 'https://www.naukri.com/nlogin/login',
  wellfound: 'https://wellfound.com/login',
  cutshort: 'https://cutshort.io/login',
  instahyre: 'https://www.instahyre.com/login/',
};

const site = process.argv[2];
if (!site || !SITES[site]) {
  console.error(`usage: npm run login -- <${Object.keys(SITES).join('|')}>`);
  process.exit(1);
}

const dir = process.env.SESSION_DIR || './sessions';
await mkdir(dir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-IN',
});
const page = await context.newPage();
await page.goto(SITES[site]);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question(`\nLog in to ${site} in the browser window, then press Enter here... `);
rl.close();

const target = path.join(dir, `${site}.json`);
await context.storageState({ path: target });
console.log(`\nSaved session -> ${target}`);
console.log('Sessions expire. Expect to re-run this every 2-4 weeks.');

await browser.close();
