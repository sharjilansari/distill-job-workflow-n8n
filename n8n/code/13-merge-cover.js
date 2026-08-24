// Node: "Merge Cover Letter"  | Mode: Run Once for Each Item

const job = $('Build Cover Letter Request').item.json;
delete job._llm;

let letter = '';
try {
  const text = llmText($json);
  letter = JSON.parse(text).body || '';
} catch (e) {
  // A missing cover letter is not fatal — most ATS forms treat it as optional.
  letter = '';
}

return { json: { ...job, cover_letter_text: letter } };
