// Node: "Build Cover Letter Request"  | Mode: Run Once for Each Item

const profile = $('Load Profile').first().json.profile;

const SYSTEM = `Write a short cover letter, maximum 200 words, from the candidate to the hiring team.

- Open with the specific reason this role fits. Not "I am writing to apply".
- One concrete example from the candidate's actual work.
- One sentence on why this company specifically, drawn from the job description. If the description gives you nothing specific, omit the sentence rather than inventing enthusiasm.
- Plain declarative sentences. No "passionate", "leverage", "synergy", "I am excited to", "delve", or "in today's fast-paced world".
- No em-dashes. No bulleted lists. Three or four short paragraphs.
- Sign off with the candidate's name only.
- Output plain text. No markdown, no bracketed placeholders.`;

const SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    word_count: { type: 'integer' },
  },
  required: ['body', 'word_count'],
  additionalProperties: false,
};

const user = `CANDIDATE
Name: ${profile.name}
Current: ${profile.current_title} at ${profile.current_company}
Core stack: ${(profile.core_stack || []).join(', ')}
Notable work: ${(($('Load Profile').first().json.master_resume.experience || [])[0]?.bullets || []).join(' | ')}

ROLE
${$json.title} at ${$json.company} (${$json.location})

JOB DESCRIPTION
${($json.jd_text || '').slice(0, 8000) || '(no description captured)'}`;

return {
  json: {
    ...$json,
    _llm: llmRequest({ system: SYSTEM, user, schema: SCHEMA, effort: 'medium', maxTokens: 2000 }),
  },
};
