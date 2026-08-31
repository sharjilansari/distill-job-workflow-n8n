// Node: "Dedupe"  | Mode: Run Once for All Items
// Input items = existing rows of the `jobs` sheet (from "Read Existing Jobs").
// New candidates come from the two ingestion lanes:
//
//   Tier 1  "Normalize API Jobs"    structured JSON sources, no LLM involved
//   Tier 2  "Normalize Extracted"   page diffs that needed an extraction call
//
// One sheet read, one in-memory pass. Do NOT do a lookup per item — a 200-job
// day would blow through the Sheets per-minute quota.

const existing = $input.all().map((i) => i.json);
const seenUrl = new Set();
const seenFp = new Set();

for (const row of existing) {
  if (row.canonical_url) seenUrl.add(row.canonical_url);
  if (row.fingerprint) seenFp.add(String(row.fingerprint));
}

/**
 * A lane that produced nothing never executes, and asking n8n for the output
 * of a node that did not run throws. Either lane is allowed to be silent, so
 * both lookups are guarded and an absent lane contributes zero candidates
 * instead of failing the run.
 */
function lane(nodeName, pick) {
  try {
    return pick($(nodeName)) || [];
  } catch (e) {
    console.log(`dedupe: no candidates from "${nodeName}" (${e.message.split('\n')[0]})`);
    return [];
  }
}

const fromApi = lane('Normalize API Jobs', (n) => n.first().json.jobs);
const fromLlm = lane('Normalize Extracted', (n) => n.all().map((i) => i.json));
const candidates = [...fromApi, ...fromLlm];

const fresh = [];
let dupUrl = 0;
let dupFp = 0;

for (const j of candidates) {
  if (!j || !j.job_id) continue;
  if (j.canonical_url && seenUrl.has(j.canonical_url)) { dupUrl++; continue; }
  if (seenFp.has(j.fingerprint)) { dupFp++; continue; }
  // Guard against duplicates inside the same batch too — the same posting
  // routinely shows up on two different sources.
  if (j.canonical_url) seenUrl.add(j.canonical_url);
  seenFp.add(j.fingerprint);
  fresh.push({ json: j });
}

console.log(
  `dedupe: ${fresh.length} new of ${candidates.length} candidate(s) ` +
  `(${fromApi.length} api, ${fromLlm.length} extracted), ` +
  `${dupUrl} dup-by-url, ${dupFp} dup-by-fingerprint, ${existing.length} known`
);
return fresh;
