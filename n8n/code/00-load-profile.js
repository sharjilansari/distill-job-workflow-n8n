// Node: "Load Profile"  | Mode: Run Once for All Items
//
// Everything here comes from two places you already filled in:
//   .env                      -> settings and secrets, read at runtime
//   profile/profile.json      -> who you are
//   profile/master-resume.json-> the only facts the resume writer may use
//
// The profile files are baked in by `npm run setup`. Nothing secret is baked;
// keys are read from the environment every run, so rotating a key means
// editing .env and restarting, not rebuilding anything.

const CONFIG = {
  sheet_id: env('GOOGLE_SHEET_ID'),
  apply_svc_url: env('APPLY_SVC_URL', 'http://apply-svc:3000'),
  apply_token: env('APPLY_TOKEN'),
  telegram_chat_id: env('TELEGRAM_CHAT_ID'),
  auto_apply_threshold: envNum('AUTO_APPLY_THRESHOLD', 85),
  review_threshold: envNum('REVIEW_THRESHOLD', 70),
  max_applications_per_run: envNum('MAX_APPLICATIONS_PER_RUN', 8),
  max_attempts: envNum('MAX_ATTEMPTS', 3),
  expire_after_days: envNum('EXPIRE_AFTER_DAYS', 21),
  notify: envBool('TELEGRAM_ENABLED', false),
};

// Fail on the first node with a sentence that says what to do, rather than
// letting a blank sheet id surface as a confusing Google API error six nodes
// later.
const missing = [];
if (!CONFIG.sheet_id) missing.push('GOOGLE_SHEET_ID');
if (!CONFIG.apply_token) missing.push('APPLY_TOKEN');
if (LLM_PROVIDER === 'anthropic' && !env('ANTHROPIC_API_KEY')) missing.push('ANTHROPIC_API_KEY');
if (LLM_PROVIDER === 'openai' && !env('OPENAI_API_KEY')) missing.push('OPENAI_API_KEY');
if (LLM_PROVIDER === 'gemini' && !env('GEMINI_API_KEY')) missing.push('GEMINI_API_KEY');

if (missing.length) {
  throw new Error(
    `Missing in .env: ${missing.join(', ')}.\n` +
    `Fill them in, then restart n8n with:  docker compose restart n8n\n` +
    `Run "npm run doctor" to check everything at once.`
  );
}

if (typeof PROFILE === 'undefined' || !PROFILE.name || PROFILE.name === 'Your Name') {
  throw new Error(
    'profile/profile.json still has the example values. Edit it, then run "npm run setup".'
  );
}

return [{
  json: {
    config: CONFIG,
    profile: PROFILE,
    master_resume: MASTER_RESUME,
    llm: { provider: LLM_PROVIDER, model: modelFor('default'), extract_model: modelFor('extract') },
  },
}];
