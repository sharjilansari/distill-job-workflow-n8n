// Node: "Build Extract Request"  | Mode: Run Once for Each Item
// One request per chunk of ~20 blocks. Batching is the difference between
// pennies and dollars on a busy day.

const SYSTEM = `You extract structured job listings from noisy text scraped off job-board search pages by a change monitor. The text is fragmentary: partial rows, interleaved UI labels, and truncated descriptions are normal.

Rules:
- One object per distinct job posting. Merge lines that clearly describe the same posting.
- If a block is not a job posting (navigation, filter chips, promo banners, "N results found"), omit it entirely. Returning fewer jobs is correct.
- Never invent a URL, salary, or company name. Use null when absent.
- experience_min / experience_max are years as integers. "2-5 years" means min 2, max 5. "5+ years" means min 5, max null. Absent means null.
- confidence reflects how sure you are this is a real, distinct posting.`;

const SCHEMA = {
  type: 'object',
  properties: {
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          remote_type: { type: 'string', enum: ['onsite', 'hybrid', 'remote', 'unknown'] },
          experience_min: { type: ['integer', 'null'] },
          experience_max: { type: ['integer', 'null'] },
          salary: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          posted_at: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
        required: ['company', 'title', 'location', 'remote_type', 'experience_min',
                   'experience_max', 'salary', 'url', 'posted_at', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['jobs'],
  additionalProperties: false,
};

const blocks = $json.blocks || [];
const user = [
  `Source: ${blocks[0]?.source || 'unknown'}`,
  `Monitor: ${blocks[0]?.monitor_name || 'unknown'}`,
  `Search page: ${blocks[0]?.monitor_uri || 'unknown'}`,
  '',
  'Blocks:',
  '---',
  blocks.map((b) => b.text).join('\n---\n'),
  '---',
].join('\n');

return {
  json: {
    ...$json,
    _llm: llmRequest({
      stage: 'extract',     // lets you point extraction at a cheaper model
      system: SYSTEM,
      user,
      schema: SCHEMA,
      effort: 'low',        // mechanical transcription, not judgement
      maxTokens: 8000,
    }),
  },
};
