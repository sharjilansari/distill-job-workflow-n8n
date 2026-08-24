import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withContext, shoot, pace } from './browser.js';
import { log } from './logger.js';

import greenhouse from './ats/greenhouse.js';
import lever from './ats/lever.js';
import ashby from './ats/ashby.js';
import linkedin from './ats/linkedin.js';

export const HANDLERS = { greenhouse, lever, ashby, linkedin };

/**
 * Writes the base64 resume to a real temp file, because file inputs need a
 * path on disk. Cleaned up in `finally` regardless of outcome.
 */
async function materialiseResume(job) {
  if (!job.resume_pdf_base64) return null;
  const dir = path.join(os.tmpdir(), `apply-${job.job_id || Date.now()}`);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${(job.company || 'resume').replace(/[^\w-]/g, '_')}.pdf`);
  await writeFile(target, Buffer.from(job.resume_pdf_base64, 'base64'));
  return target;
}

export async function runApplication(job, { applicationId, artifactDir }) {
  const handler = HANDLERS[job.ats];
  if (!handler) {
    return {
      result: 'unsupported',
      error: `no handler for ats "${job.ats}"`,
      screenshot_before: '',
      screenshot_after: '',
    };
  }

  const dryRun = process.env.DRY_RUN !== 'false';
  let resumePath = null;

  try {
    resumePath = await materialiseResume(job);

    return await withContext(handler.site, async (context) => {
      const page = await context.newPage();
      let before = '';
      let after = '';

      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded' });

        // Handlers report their own blockers rather than throwing, so a login
        // wall or captcha becomes a routable status instead of a stack trace.
        const gate = await handler.precheck(page, job);
        if (gate) {
          before = await shoot(page, applicationId, 'blocked', artifactDir);
          return { result: gate, error: `blocked: ${gate}`, screenshot_before: before, screenshot_after: '' };
        }

        await handler.fill(page, { ...job, resumePath });
        before = await shoot(page, applicationId, 'before', artifactDir);

        if (dryRun) {
          log.warn('DRY_RUN active — form filled, submit skipped', { applicationId });
          return {
            result: 'dry_run',
            error: '',
            screenshot_before: before,
            screenshot_after: '',
          };
        }

        await handler.submit(page, job);
        const confirmed = await handler.confirm(page);
        after = await shoot(page, applicationId, 'after', artifactDir);

        // Pace only after a real submission — dry runs and blocks cost nothing.
        await pace();

        return {
          result: confirmed ? 'success' : 'submitted_unconfirmed',
          error: confirmed ? '' : 'no confirmation element matched after submit',
          screenshot_before: before,
          screenshot_after: after,
        };
      } catch (err) {
        after = await shoot(page, applicationId, 'error', artifactDir);
        return {
          result: 'failed',
          error: err.message,
          screenshot_before: before,
          screenshot_after: after,
        };
      }
    });
  } finally {
    if (resumePath) await rm(path.dirname(resumePath), { recursive: true, force: true }).catch(() => {});
  }
}
