// Node: "Build Score Request"  | Mode: Run Once for Each Item
// One request per job. Only jobs that survived the free hard filters get here.

// Comes from profile/profile.json via "Load Profile". Named CANDIDATE rather
// than PROFILE because the baked-in profile already occupies that name.
const CANDIDATE = $('Load Profile').first().json.profile;

const SYSTEM = `You screen job postings for a specific candidate. Be harsh. Most jobs should score below 70. A generous scorer makes the threshold meaningless and floods the apply queue with mediocre matches.

Scoring bands:
- 90-100: strong match. Stack, seniority, and location all line up.
- 70-89: plausible. Worth a human look, some meaningful gap.
- 40-69: weak. Wrong seniority, adjacent stack, or vague posting.
- 0-39: no. Different discipline, or the posting is spam or a mass repost.

Penalise heavily for: experience mismatch in either direction, a primary stack the candidate does not have, vague descriptions with no named technologies, obvious staffing-agency reposts, and roles that are a different discipline wearing a familiar title.

resume_variant picks which stored resume to tailor: "frontend" for pure UI roles, "react" when React/Next.js is the explicit centre of the role, "fullstack" when backend ownership is a real requirement.`;

const SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    reasons: { type: 'array', items: { type: 'string' } },
    missing_skills: { type: 'array', items: { type: 'string' } },
    red_flags: { type: 'array', items: { type: 'string' } },
    resume_variant: { type: 'string', enum: ['frontend', 'react', 'fullstack'] },
  },
  required: ['score', 'reasons', 'missing_skills', 'red_flags', 'resume_variant'],
  additionalProperties: false,
};

const j = $json;
const description = j.jd_text?.trim()
  ? j.jd_text.slice(0, 12000)
  : '(enrichment failed or not attempted — judge from the title, company and metadata above, and lower confidence accordingly)';

const user = `CANDIDATE
${JSON.stringify(CANDIDATE, null, 2)}

JOB
Company:    ${j.company}
Title:      ${j.title}
Location:   ${j.location} (${j.remote_type})
Experience: ${j.experience_min ?? '?'}-${j.experience_max ?? '?'} years
Salary:     ${j.salary || 'not stated'}
Source:     ${j.source}
URL:        ${j.canonical_url}

DESCRIPTION
${description}`;

return {
  json: {
    ...j,
    _llm: llmRequest({ system: SYSTEM, user, schema: SCHEMA, effort: 'medium', maxTokens: 4000 }),
  },
};
