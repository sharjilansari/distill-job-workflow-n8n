// Node: "Render Resume HTML"  | Mode: Run Once for Each Item
// Turns the tailored JSON into print HTML, which apply-svc converts to PDF.
//
// ATS parsers read the PDF text layer, so this template stays single-column
// with real headings and no tables, icons, or text inside images. Two-column
// resume templates are the most common reason a good resume scores badly.

const master = $('Load Profile').first().json.master_resume;
const p = master.contact || {};

let tailored;
try {
  tailored = JSON.parse(llmText($json));
} catch (e) {
  throw new Error(`tailored resume JSON did not parse: ${e.message}`);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const bullets = (arr) => (arr || []).map((b) => `<li>${esc(b)}</li>`).join('');

const experience = (tailored.experience || [])
  .map(
    (job) => `
      <article class="entry">
        <header>
          <h3>${esc(job.title)}</h3>
          <span class="meta">${esc(job.company)} &middot; ${esc(job.period)}</span>
        </header>
        <ul>${bullets(job.bullets)}</ul>
      </article>`
  )
  .join('');

const projects = (tailored.projects || [])
  .map(
    (proj) => `
      <article class="entry">
        <header>
          <h3>${esc(proj.name)}</h3>
          <span class="meta">${(proj.stack || []).map(esc).join(' &middot; ')}</span>
        </header>
        <ul>${bullets(proj.bullets)}</ul>
      </article>`
  )
  .join('');

const education = (master.education || [])
  .map(
    (ed) => `
      <article class="entry">
        <header>
          <h3>${esc(ed.degree)}</h3>
          <span class="meta">${esc(ed.institution)} &middot; ${esc(ed.period)}</span>
        </header>
      </article>`
  )
  .join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(master.name)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font: 10.5pt/1.45 "Georgia", "Times New Roman", serif;
    color: #14181d; margin: 0; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { padding: 0 2mm; }
  h1 { font-size: 20pt; letter-spacing: .2px; margin: 0 0 2mm; }
  .contact { font-size: 9pt; color: #3c4550; margin-bottom: 4mm; }
  .contact span::after { content: " · "; color: #9aa4b0; }
  .contact span:last-child::after { content: ""; }
  h2 {
    font-size: 10pt; text-transform: uppercase; letter-spacing: 1.1px;
    border-bottom: 1px solid #c8cfd7; padding-bottom: 1mm;
    margin: 5mm 0 2.5mm;
  }
  .summary { margin: 0 0 1mm; }
  .entry { margin-bottom: 3.5mm; page-break-inside: avoid; }
  .entry header { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; }
  .entry h3 { font-size: 11pt; margin: 0; }
  .meta { font-size: 9pt; color: #4c5663; white-space: nowrap; }
  ul { margin: 1.2mm 0 0; padding-left: 4.5mm; }
  li { margin-bottom: .8mm; }
  .skills { font-size: 10pt; margin: 0; }
</style></head>
<body><div class="sheet">
  <h1>${esc(master.name)}</h1>
  <div class="contact">
    <span>${esc(p.email)}</span><span>${esc(p.phone)}</span><span>${esc(p.location)}</span>
    <span>${esc(p.github)}</span><span>${esc(p.linkedin)}</span>
  </div>

  <h2>Summary</h2>
  <p class="summary">${esc(tailored.summary)}</p>

  <h2>Skills</h2>
  <p class="skills">${(tailored.skills_ordered || []).map(esc).join(' &middot; ')}</p>

  <h2>Experience</h2>
  ${experience}

  ${projects ? `<h2>Projects</h2>${projects}` : ''}

  <h2>Education</h2>
  ${education}
</div></body></html>`;

return {
  json: {
    ...$('Route ATS').item.json,
    resume_html: html,
    resume_filename: `${String(master.name).replace(/\s+/g, '-')}-${String($('Route ATS').item.json.company).replace(/[^\w]+/g, '-')}.pdf`,
    keywords_targeted: (tailored.keywords_targeted || []).join(', '),
  },
};
