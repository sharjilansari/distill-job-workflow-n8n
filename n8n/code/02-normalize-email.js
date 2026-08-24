// Node: "Normalize Email Payload"  | Mode: Run Once for All Items
// Gmail node returns the message with `text` (plain body) and `subject`.
// Distill subjects are templated as "[DISTILL] <monitor name>".

const runId = uid('run');
const out = [];

for (const item of $input.all()) {
  const j = item.json;
  const subject = j.subject || j.Subject || '';
  const body = j.text || j.textPlain || j.snippet || '';
  if (!body.trim()) continue;

  out.push({
    json: {
      run_id: runId,
      received_at: nowIso(),
      source_channel: 'email',
      monitor_name: subject.replace(/^\[DISTILL\]\s*/i, '').trim() || 'unknown-monitor',
      monitor_uri: (body.match(/https?:\/\/\S+/) || [''])[0],
      raw_text: body,
      processed: false,
      _gmail_id: j.id || '',
    },
  });
}

return out;
