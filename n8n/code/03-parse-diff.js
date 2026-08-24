// Node: "Parse Distill Diff"  | Mode: Run Once for All Items
// Turns Distill's messy change text into candidate job blocks, then groups them
// into chunks so one Claude call handles ~20 jobs instead of 20 calls.
//
// Tune NOISE first. Anything that changes without a new job existing (applicant
// counts, relative timestamps) will otherwise regenerate the same jobs daily.

const CHUNK_SIZE = 20;
const MAX_LINES_PER_BLOCK = 12;

const NOISE = [
  /^\s*[-+]?\s*\d+\s+applicants?\b/i,
  /^\s*[-+]?\s*(over|about)?\s*\d+\s*(second|minute|hour|day|week|month)s?\s+ago/i,
  /^\s*[-+]?\s*(promoted|viewed|easy apply|actively hiring|be an early applicant)\s*$/i,
  /^\s*[-+]?\s*(save|saved|apply|share|report this job|dismiss)\s*$/i,
  /^\s*[-+]?\s*(sponsored|ad)\s*$/i,
  /^\s*[-+]?\s*\d+\s*(job|result)s?\s*(found)?\s*$/i,
  /^\s*[-+]?\s*(showing|page)\s+\d+/i,
  /^[\s\-=_*·|>+]*$/,
];

// A line that plausibly starts a new listing: no separator glyphs, no leading digits.
const TITLE_HINT = /^[A-Z][\w()/&.,'’+-]*(\s+[\w()/&.,'’+#-]+){0,9}$/;

const isNoise = (l) => NOISE.some((re) => re.test(l));

function cleanLines(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    // Distill marks insertions with a leading '+' in diff mode; keep only those
    // when the payload actually looks like a diff, else keep everything.
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);
}

function keepInsertions(lines) {
  const hasDiffMarkers = lines.some((l) => /^\+/.test(l)) && lines.some((l) => /^-/.test(l));
  if (!hasDiffMarkers) return lines.filter((l) => !isNoise(l));
  return lines
    .filter((l) => l.startsWith('+'))
    .map((l) => l.replace(/^\+\s*/, ''))
    .filter((l) => l && !isNoise(l));
}

function toBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const startsNew =
      current.length >= 2 && TITLE_HINT.test(line) && line.length < 90;
    if (startsNew || current.length >= MAX_LINES_PER_BLOCK) {
      if (current.length) blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  // A single orphan line is almost never a usable listing.
  return blocks.filter((b) => b.length >= 2);
}

const chunks = [];
let pending = [];
let runId = '';

for (const item of $input.all()) {
  const j = item.json;
  runId = runId || j.run_id;
  const blocks = toBlocks(keepInsertions(cleanLines(j.raw_text)));
  for (const b of blocks) {
    pending.push({
      monitor_name: j.monitor_name,
      monitor_uri: j.monitor_uri,
      source: sourceFromUri(j.monitor_uri, j.monitor_name),
      text: b.join('\n'),
    });
    if (pending.length >= CHUNK_SIZE) {
      chunks.push(pending);
      pending = [];
    }
  }
}
if (pending.length) chunks.push(pending);

function sourceFromUri(uri, name) {
  const hay = `${uri} ${name}`.toLowerCase();
  const known = ['linkedin', 'naukri', 'wellfound', 'cutshort', 'indeed',
                 'instahyre', 'greenhouse', 'lever', 'ashby', 'hirist'];
  return known.find((k) => hay.includes(k)) || 'other';
}

return chunks.map((blocks, i) => ({
  json: {
    run_id: runId,
    chunk_index: i,
    chunk_count: chunks.length,
    block_count: blocks.length,
    blocks,
  },
}));
