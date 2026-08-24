// Node: "Dedupe"  | Mode: Run Once for All Items
// Input items = existing rows of the `jobs` sheet (from "Read Existing Jobs").
// New candidates are pulled from the extraction node.
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

const fresh = [];
let dupUrl = 0;
let dupFp = 0;

for (const item of $('Normalize Extracted').all()) {
  const j = item.json;
  if (j.canonical_url && seenUrl.has(j.canonical_url)) { dupUrl++; continue; }
  if (seenFp.has(j.fingerprint)) { dupFp++; continue; }
  // Guard against duplicates inside the same batch too.
  if (j.canonical_url) seenUrl.add(j.canonical_url);
  seenFp.add(j.fingerprint);
  fresh.push({ json: j });
}

console.log(`dedupe: ${fresh.length} new, ${dupUrl} dup-by-url, ${dupFp} dup-by-fingerprint, ${existing.length} known`);
return fresh;
