// Node: "Merge Score"  | Mode: Run Once for Each Item
// Folds Claude's verdict onto the job row and decides its final status.
//
// "Build Score Request" is 1:1 with the HTTP node's output, so positional
// lookup is correct. Do NOT reach back to "Hard Filters" — the IF node between
// them drops items and the indices no longer line up.

const cfg = $('Load Profile').first().json.config;
const job = $('Build Score Request').all()[$itemIndex]?.json || {};
delete job._llm;

let verdict;
try {
  const text = llmText($json);
  verdict = JSON.parse(text);
} catch (e) {
  // Leave it at `new` so tomorrow's run retries it, and record why.
  return {
    json: {
      ...job,
      status: 'new',
      attempts: (Number(job.attempts) || 0) + 1,
      last_error: `score parse failed: ${e.message}`,
    },
  };
}

const score = Math.max(0, Math.min(100, Math.round(verdict.score ?? 0)));

let status;
if (score >= cfg.auto_apply_threshold) status = 'queued';
else if (score >= cfg.review_threshold) status = 'review';
else status = 'skipped';

return {
  json: {
    ...job,
    score,
    score_reason: [
      ...(verdict.reasons || []),
      verdict.red_flags?.length ? `RED FLAGS: ${verdict.red_flags.join('; ')}` : '',
    ].filter(Boolean).join(' | ').slice(0, 900),
    missing_skills: (verdict.missing_skills || []).join(', '),
    resume_variant: verdict.resume_variant || 'frontend',
    status,
    last_error: '',
  },
};
