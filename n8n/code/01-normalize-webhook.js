// Node: "Normalize Webhook Payload"  | Mode: Run Once for All Items
//
// This node sits on both trigger paths, so it must ignore items that came from
// the schedule branch. A webhook item always carries `headers`; a Load Profile
// item never does.
//
// Distill's webhook action lets you template the body. Configure it as:
//   {"name":"{{name}}","uri":"{{uri}}","text":"{{text}}","diff":"{{diff}}"}
// Placeholder names vary slightly between the extension and Distill Cloud —
// fire one test call at a request-bin first and copy what actually arrives.

const runId = uid('run');
const out = [];

for (const item of $input.all()) {
  const j = item.json;
  if (!j.headers && !j.body) continue;   // schedule branch passing through

  const b = j.body || j;
  const text = b.diff || b.text || '';
  if (!String(text).trim()) continue;

  out.push({
    json: {
      run_id: runId,
      received_at: nowIso(),
      source_channel: 'webhook',
      monitor_name: b.name || b.monitor || 'unknown-monitor',
      monitor_uri: b.uri || b.url || '',
      raw_text: String(text),
      processed: false,
    },
  });
}

return out;
