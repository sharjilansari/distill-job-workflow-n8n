import { log } from '../logger.js';

/**
 * LinkedIn Easy Apply — deliberately conservative.
 *
 * Read this before enabling it. LinkedIn is the highest-volume source AND the
 * platform recruiters actually use to contact you. Automated applying is
 * against their User Agreement and account restrictions do happen. Losing the
 * account costs far more than the time this handler saves.
 *
 * Default behaviour is therefore: detect Easy Apply, confirm the flow is
 * single-step and answerable from the profile, and otherwise hand back
 * `needs_human` so workflow 02 routes the job to you with the tailored PDF
 * already generated. Set LINKEDIN_AUTOSUBMIT=true to allow submission of
 * single-step forms only.
 */

const AUTOSUBMIT = process.env.LINKEDIN_AUTOSUBMIT === 'true';

export default {
  site: 'linkedin',

  async precheck(page) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    if (/authwall|\/login/.test(page.url())) return 'login_required';
    if (await page.getByText(/no longer accepting applications/i).count()) return 'closed';

    const easy = page.getByRole('button', { name: /easy apply/i }).first();
    if (!(await easy.count().catch(() => 0))) {
      // External ATS behind an "Apply" button — let the router's other
      // handlers deal with it on a future run rather than guessing here.
      return 'not_easy_apply';
    }
    return null;
  },

  async fill(page, job) {
    const p = job.profile || {};

    await page.getByRole('button', { name: /easy apply/i }).first().click();
    await page.waitForTimeout(2500);

    // Contact step is usually prefilled from the LinkedIn profile.
    const phone = page.getByLabel(/mobile phone number|phone/i).first();
    if ((await phone.count().catch(() => 0)) && !(await phone.inputValue().catch(() => ''))) {
      await phone.fill(p.phone || '').catch(() => {});
    }

    if (job.resumePath) {
      const input = page.locator('input[type="file"][name*="resume" i]').first();
      if (await input.count().catch(() => 0)) {
        await input.setInputFiles(job.resumePath).catch((e) =>
          log.warn('resume upload failed', { error: e.message })
        );
        await page.waitForTimeout(3000);
      }
    }

    // If the modal offers "Next" rather than "Review"/"Submit", this is a
    // multi-step flow with employer questions we will not guess at.
    const next = page.getByRole('button', { name: /^next$/i });
    if (await next.count().catch(() => 0)) {
      throw new Error('needs_human: multi-step Easy Apply with custom questions');
    }
  },

  async submit(page) {
    if (!AUTOSUBMIT) {
      throw new Error('needs_human: LINKEDIN_AUTOSUBMIT is not enabled');
    }
    const btn = page.getByRole('button', { name: /submit application/i }).first();
    if (!(await btn.count().catch(() => 0))) {
      throw new Error('needs_human: no single-step submit button found');
    }
    await btn.click();
    await page.waitForTimeout(5000);
  },

  async confirm(page) {
    return (
      (await page
        .getByText(/your application was sent|application sent/i)
        .count()
        .catch(() => 0)) > 0
    );
  },
};
