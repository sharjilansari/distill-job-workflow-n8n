import { log } from '../logger.js';

/**
 * Lever — `jobs.lever.co/<company>/<id>`.
 *
 * Lever's form is more uniform than Greenhouse's: field names are stable
 * (`name`, `email`, `phone`, `resume`, `urls[LinkedIn]`) and custom questions
 * live under `cards[...]` with employer-specific keys.
 */
export default {
  site: 'lever',

  async precheck(page) {
    if (await page.locator('iframe[src*="recaptcha"], .g-recaptcha').count()) return 'captcha';
    if (await page.getByText(/posting is no longer|position (has been )?filled/i).count()) {
      return 'closed';
    }
    // Lever splits the posting page and the apply page.
    if (!(await page.locator('form[action*="apply"], input[name="resume"]').count())) {
      const applyLink = page.locator('a[href*="/apply"], .postings-btn').first();
      if (await applyLink.count()) {
        await applyLink.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
    }
    return (await page.locator('input[name="email"]').count()) ? null : 'no_form_found';
  },

  async fill(page, job) {
    const p = job.profile || {};

    await page.fill('input[name="name"]', p.name || '').catch(() => {});
    await page.fill('input[name="email"]', p.email || '').catch(() => {});
    await page.fill('input[name="phone"]', p.phone || '').catch(() => {});
    await page.fill('input[name="org"]', p.current_company || '').catch(() => {});

    const links = p.links || {};
    const urlFields = {
      'urls[LinkedIn]': links.linkedin,
      'urls[GitHub]': links.github,
      'urls[Portfolio]': links.portfolio,
      'urls[Other]': links.portfolio,
    };
    for (const [name, value] of Object.entries(urlFields)) {
      if (!value) continue;
      const el = page.locator(`input[name="${name}"]`).first();
      if (await el.count().catch(() => 0)) await el.fill(value).catch(() => {});
    }

    if (job.resumePath) {
      const input = page.locator('input[name="resume"], input[type="file"]').first();
      await input.setInputFiles(job.resumePath).catch((e) =>
        log.warn('resume upload failed', { error: e.message })
      );
      await page.waitForTimeout(3500);
    }

    if (job.cover_letter_text) {
      const cover = page.locator('textarea[name="comments"], textarea[name*="cover" i]').first();
      if (await cover.count().catch(() => 0)) {
        await cover.fill(job.cover_letter_text).catch(() => {});
      }
    }

    await answerCards(page, p.standard_answers || {});
  },

  async submit(page) {
    await page.locator('button[type="submit"], .postings-btn[type="submit"]').first().click();
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  },

  async confirm(page) {
    if (/thanks|confirmation/i.test(page.url())) return true;
    return (
      (await page
        .getByText(/thank you|application (received|submitted)|we.{0,3}ll be in touch/i)
        .count()
        .catch(() => 0)) > 0
    );
  },
};

async function answerCards(page, answers) {
  const rules = [
    [/authoriz|eligible to work/i, answers.authorized_to_work],
    [/sponsorship|visa/i, answers.requires_sponsorship],
    [/relocat/i, answers.willing_to_relocate],
    [/notice/i, answers.notice_period],
    [/years.*react/i, answers.years_react],
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
      log.debug('card unanswered', { pattern: pattern.source });
    }
  }
}
