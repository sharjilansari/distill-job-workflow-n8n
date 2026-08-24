// Node: "Normalize Extracted"  | Mode: Run Once for All Items
// Input: raw Claude responses (one per chunk). output_config.format guarantees
// the first content block is text containing valid JSON, but we still guard —
// an HTTP-level failure produces a body with no `content` at all.

const out = [];
// "Build Extract Request" is 1:1 with this node's input and carries the chunk
// metadata forward, so positional lookup is safe here.
const chunks = $('Build Extract Request').all();

for (const [idx, item] of $input.all().entries()) {
  const chunk = chunks[idx]?.json || {};
  let parsed;
  try {
    const text = llmText(item.json);
    parsed = JSON.parse(text);
  } catch (e) {
    // Never drop the whole run over one bad chunk — the raw row is already
    // persisted. Log it, though: a bad API key fails every chunk identically,
    // and silence would look like "no jobs today".
    console.log(`chunk ${idx} failed: ${e.message}`);
    continue;
  }

  for (const j of parsed.jobs || []) {
    if (!j.title || !j.company) continue;
    if (typeof j.confidence === 'number' && j.confidence < 0.4) continue;

    const canonical = canonicalUrl(j.url);
    const job = {
      job_id: uid('job'),
      source: j.source || chunk.blocks?.[0]?.source || 'other',
      company: String(j.company).trim(),
      title: String(j.title).trim(),
      location: (j.location || '').trim(),
      remote_type: ['onsite', 'hybrid', 'remote'].includes(j.remote_type) ? j.remote_type : 'unknown',
      experience_min: Number.isFinite(j.experience_min) ? j.experience_min : null,
      experience_max: Number.isFinite(j.experience_max) ? j.experience_max : null,
      salary: (j.salary || '').trim(),
      url: j.url || '',
      canonical_url: canonical,
      jd_text: '',
      posted_at: j.posted_at || '',
      discovered_at: nowIso(),
      run_id: chunk.run_id || '',
      score: '',
      score_reason: '',
      resume_variant: '',
      status: 'new',
      attempts: 0,
      last_error: '',
      applied_at: '',
    };
    job.fingerprint = fingerprint(job);
    out.push({ json: job });
  }
}

return out;
