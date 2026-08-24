// Node: "Route ATS"  | Mode: Run Once for Each Item
// Per-ATS scripts beat a general browser agent: Greenhouse's form is identical
// across every company using it, so one script covers hundreds of employers.

const HANDLERS = [
  [/boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io/i, 'greenhouse'],
  [/jobs\.lever\.co|lever\.co/i, 'lever'],
  [/jobs\.ashbyhq\.com|ashbyhq\.com/i, 'ashby'],
  [/linkedin\.com/i, 'linkedin'],
];

const url = $json.canonical_url || $json.url || '';
const match = HANDLERS.find(([re]) => re.test(url));

// Anything unrecognised goes to you with the PDFs pre-generated — 30 seconds of
// manual work beats a brittle automation that silently submits garbage.
const ats = match ? match[1] : 'manual';

return { json: { ...$json, ats, apply_method: ats === 'manual' ? 'manual' : 'browser' } };
