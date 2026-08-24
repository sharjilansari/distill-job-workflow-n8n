// Node: "Build Tailor Request"  | Mode: Run Once for Each Item
// Effort is 'high' here. This output goes in front of a human reader — it is
// the one stage where quality matters more than cost.

const master = $('Load Profile').first().json.master_resume;
const variantHint = master.variants?.[$json.resume_variant] || '';

const SYSTEM = `You rewrite a candidate's resume bullets to match a specific job description.

Hard rules:
- Never invent experience. You may reframe, reorder, and re-emphasise what is in the master resume. You may not add a technology, employer, metric, or date that is not already there.
- Mirror the job description's own vocabulary where it honestly describes work the candidate did. This is what ATS keyword matching reads.
- Keep every bullet to one line at typical resume width, roughly 110 characters.
- Lead each bullet with a concrete verb. Put the outcome before the mechanism.
- Drop bullets irrelevant to this role rather than padding. A short focused resume beats a long generic one.
- Preserve the master resume's factual fields verbatim: name, contact, employers, titles, dates, education.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    skills_ordered: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          period: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['company', 'title', 'period', 'bullets'],
        additionalProperties: false,
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          stack: { type: 'array', items: { type: 'string' } },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'stack', 'bullets'],
        additionalProperties: false,
      },
    },
    keywords_targeted: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'skills_ordered', 'experience', 'projects', 'keywords_targeted'],
  additionalProperties: false,
};

const user = `MASTER RESUME (the only facts you may use)
${JSON.stringify(master, null, 2)}

VARIANT DIRECTION
${variantHint}

TARGET ROLE
${$json.title} at ${$json.company}
${$json.location} (${$json.remote_type})

JOB DESCRIPTION
${($json.jd_text || '').slice(0, 12000) || '(no description captured — tailor from the title and the variant direction only)'}`;

return {
  json: {
    ...$json,
    _llm: llmRequest({ system: SYSTEM, user, schema: SCHEMA, effort: 'high', maxTokens: 8000 }),
  },
};
