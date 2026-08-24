import { log } from '../logger.js';

/**
 * Ashby — `jobs.ashbyhq.com/<company>/<uuid>`.
 *
 * Fully client-rendered with no stable `name` attributes, so everything is
 * located by visible label. That is slower but survives their frequent
 * class-name churn, which any CSS-selector approach would not.
 */
export default {
  site: 'ashby',

  async precheck(page) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count()) {
      return 'captcha';
    }
    if (await page.getByText(/no longer accepting|posting.*closed/i).count()) return 'closed';

    const applyBtn = page.getByRole('button', { name: /apply for this job|^apply$/i }).first();
    if (await applyBtn.count().catch(() => 0)) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    return (await page.getByLabel(/email/i).count().catch(() => 0)) ? null : 'no_form_found';
  },

  async fill(page, job) {
    const p = job.profile || {};

    const byLabel = async (pattern, value) => {
      if (!value) return;
      const el = page.getByLabel(pattern).first();
      if (await el.count().catch(() => 0)) await el.fill(String(value)).catch(() => {});
    };

    await byLabel(/^name|full name/i, p.name);
    await byLabel(/email/i, p.email);
    await byLabel(/phone/i, p.phone);
    await byLabel(/linkedin/i, (p.links || {}).linkedin);
    await byLabel(/github/i, (p.links || {}).github);
    await byLabel(/website|portfolio/i, (p.links || {}).portfolio);

    if (job.resumePath) {
      // Ashby's file input is visually hidden behind a styled dropzone.
      const input = page.locator('input[type="file"]').first();
      await input.setInputFiles(job.resumePath).catch((e) =>
        log.warn('resume upload failed', { error: e.message })
      );
      await page.waitForTimeout(4000);
    }

    if (job.cover_letter_text) {
      const cover = page.getByLabel(/cover letter|why.*interested/i).first();
      if (await cover.count().catch(() => 0)) {
        await cover.fill(job.cover_letter_text).catch(() => {});
      }
    }
  },

  async submit(page) {
    const btn = page.getByRole('button', { name: /submit application|^submit$/i }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    await page.waitForTimeout(6000);
  },

  async confirm(page) {
    return (
      (await page
        .getByText(/thank you|application (submitted|received)|successfully submitted/i)
        .count()
        .catch(() => 0)) > 0
    );
  },
};
