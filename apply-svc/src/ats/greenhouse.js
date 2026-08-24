import { log } from '../logger.js';

/**
 * Greenhouse — the highest-value handler to get right.
 *
 * Greenhouse renders the same form markup for every company on the platform,
 * so these selectors cover hundreds of employers. Two generations exist:
 * the classic `#application_form` and the newer `job-boards.greenhouse.io`
 * React embed. Both are handled below.
 */

const FIRST = ['#first_name', 'input[name="first_name"]', 'input[autocomplete="given-name"]'];
const LAST = ['#last_name', 'input[name="last_name"]', 'input[autocomplete="family-name"]'];
const FULL = ['#name', 'input[name="name"]', 'input[autocomplete="name"]'];
const EMAIL = ['#email', 'input[type="email"]', 'input[name="email"]'];
const PHONE = ['#phone', 'input[type="tel"]', 'input[name="phone"]'];
const RESUME = ['input[type="file"][name*="resume" i]', '#resume', 'input[type="file"]'];
const COVER = ['#cover_letter_text', 'textarea[name*="cover" i]', 'textarea[id*="cover" i]'];

/** Fills the first selector that actually exists. Missing fields are normal. */
async function fillFirst(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.fill(String(value), { timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

export default {
  site: 'greenhouse',

  /** Return a blocker string to abort cleanly, or null to proceed. */
  async precheck(page) {
    if (await page.locator('iframe[src*="recaptcha"], .g-recaptcha').count()) {
      return 'captcha';
    }
    const closed = page.getByText(/no longer accepting applications|position (is )?closed/i);
    if (await closed.count()) return 'closed';
    const hasForm = await page.locator('input[type="file"], #application_form, form').count();
    return hasForm ? null : 'no_form_found';
  },

  async fill(page, job) {
    const p = job.profile || {};
    const [first, ...rest] = String(p.name || '').split(' ');

    // Newer boards hide the form behind an "Apply" button.
    const applyBtn = page.getByRole('button', { name: /^apply/i }).first();
    if (await applyBtn.count().catch(() => 0)) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    if (!(await fillFirst(page, FULL, p.name))) {
      await fillFirst(page, FIRST, first);
      await fillFirst(page, LAST, rest.join(' '));
    }
    await fillFirst(page, EMAIL, p.email);
    await fillFirst(page, PHONE, p.phone);
    await fillFirst(page, COVER, job.cover_letter_text);

    if (job.resumePath) {
      for (const sel of RESUME) {
        const input = page.locator(sel).first();
        if (await input.count().catch(() => 0)) {
          await input.setInputFiles(job.resumePath).catch((e) =>
            log.warn('resume upload failed', { error: e.message })
          );
          break;
        }
      }
      // Greenhouse parses the PDF server-side and repopulates fields.
      await page.waitForTimeout(4000);
    }

    await fillLinks(page, p.links || {});
    await answerCustomQuestions(page, p.standard_answers || {});
  },

  async submit(page) {
    const btn = page
      .locator('#submit_app, button[type="submit"], input[type="submit"]')
      .filter({ hasNotText: /save|cancel/i })
      .first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  },

  async confirm(page) {
    const ok = page.getByText(
      /thank you for applying|application (was )?(submitted|received)|we.{0,3}ve received your application/i
    );
    return (await ok.count().catch(() => 0)) > 0;
  },
};

async function fillLinks(page, links) {
  const map = [
    [/linkedin/i, 'linkedin', links.linkedin],
    [/github/i, 'github', links.github],
    [/portfolio|website|personal site/i, 'website', links.portfolio],
  ];
  for (const [pattern, nameHint, value] of map) {
    if (!value) continue;
    const labelled = page.getByLabel(pattern).first();
    if (await labelled.count().catch(() => 0)) {
      await labelled.fill(value).catch(() => {});
      continue;
    }
    const byName = page.locator(`input[name*="${nameHint}" i]`).first();
    if (await byName.count().catch(() => 0)) await byName.fill(value).catch(() => {});
  }
}

/**
 * Greenhouse custom questions are free-form per employer. We answer only what
 * we can map confidently from the profile; anything unmatched is left blank so
 * a required-field error surfaces as a `failed` result you can inspect, rather
 * than a confidently wrong answer being submitted in your name.
 */
async function answerCustomQuestions(page, answers) {
  const rules = [
    [/authoriz(ed|ation) to work|legally authorized/i, answers.authorized_to_work],
    [/require.*(sponsorship|visa)/i, answers.requires_sponsorship],
    [/willing to relocate|open to relocation/i, answers.willing_to_relocate],
    [/notice period/i, answers.notice_period],
    [/years.*(react)/i, answers.years_react],
    [/years.*(javascript|experience)/i, answers.years_javascript],
    [/gender/i, answers.gender],
    [/veteran/i, answers.veteran_status],
    [/disability/i, answers.disability_status],
    [/race|ethnicity/i, answers.race_ethnicity],
  ];

  for (const [pattern, value] of rules) {
    if (!value || value === 'GENERATE') continue;
    const field = page.getByLabel(pattern).first();
    if (!(await field.count().catch(() => 0))) continue;

    const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    try {
      if (tag === 'select') await field.selectOption({ label: value });
      else await field.fill(String(value));
    } catch (e) {
      log.debug('question unanswered', { pattern: pattern.source, error: e.message });
    }
  }
}
