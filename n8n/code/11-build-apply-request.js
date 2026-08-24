// Node: "Build Apply Request"  | Mode: Run Once for Each Item
//
// The Drive node does not carry binary through to its output, so the PDF is
// read back from "Render PDF" by name rather than from $input. n8n stores
// binary as base64 already, so no conversion is needed.

const cfg = $('Load Profile').first().json.config;
const profile = $('Load Profile').first().json.profile;
const job = $('Merge Cover Letter').item.json;

const pdf = $('Render PDF').item.binary?.data?.data;
if (!pdf) throw new Error('resume PDF binary missing — check that Render PDF returned a file');

return {
  json: {
    ...job,
    resume_drive_url: $json.webViewLink || $json.id || '',
    _apply_url: `${cfg.apply_svc_url}/apply`,
    _body: {
      job_id: job.job_id,
      ats: job.ats,
      url: job.canonical_url || job.url,
      company: job.company,
      title: job.title,
      resume_pdf_base64: pdf,
      cover_letter_text: job.cover_letter_text,
      profile: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        current_company: profile.current_company,
        links: profile.links,
        standard_answers: profile.standard_answers,
      },
    },
  },
};
