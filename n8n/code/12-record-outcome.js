// Node: "Record Outcome"  | Mode: Run Once for Each Item
// Maps apply-svc's result onto the two rows that need writing: the new
// `applications` row and the `jobs` status transition.
//
// apply-svc always answers 200 with a result object — a failed application is
// data, not an exception. Anything it could not finish stays actionable rather
// than silently disappearing.

const job = $('Build Apply Request').item.json;
const r = $json || {};

// result -> (job status, whether it is worth retrying tomorrow)
const OUTCOMES = {
  success: ['applied', false],
  submitted_unconfirmed: ['applied', false],
  dry_run: ['queued', false],          // stays queued; nothing was submitted
  manual: ['manual', false],
  unsupported: ['manual', false],
  needs_human: ['manual', false],
  captcha: ['manual', false],
  login_required: ['manual', false],
  not_easy_apply: ['manual', false],
  closed: ['expired', false],
  no_form_found: ['failed', true],
  failed: ['failed', true],
};

const [status, retryable] = OUTCOMES[r.result] || ['failed', true];
const attempts = (Number(job.attempts) || 0) + (retryable ? 1 : 0);

return {
  json: {
    application: {
      application_id: r.application_id || uid('app'),
      job_id: job.job_id,
      company: job.company,
      title: job.title,
      attempted_at: nowIso(),
      method: job.apply_method || 'browser',
      ats: job.ats,
      result: r.result || 'failed',
      resume_url: job.resume_drive_url || '',
      cover_letter_url: job.cover_letter_drive_url || '',
      screenshot_before: r.screenshot_before || '',
      screenshot_after: r.screenshot_after || '',
      error: r.error || '',
    },
    job_update: {
      job_id: job.job_id,
      status,
      attempts,
      last_error: r.error || '',
      applied_at: status === 'applied' ? nowIso() : (job.applied_at || ''),
      resume_variant: job.resume_variant || '',
    },
    // Flattened for the Telegram message.
    result: r.result || 'failed',
    status,
    company: job.company,
    title: job.title,
    score: job.score,
    ats: job.ats,
    url: job.canonical_url || job.url,
    error: r.error || '',
  },
};
