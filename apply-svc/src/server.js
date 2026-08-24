import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { log } from './logger.js';
import { renderPdf } from './pdf.js';
import { runApplication, HANDLERS } from './router.js';
import { shutdownBrowser } from './browser.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.APPLY_TOKEN || '';
const ARTIFACTS = process.env.ARTIFACT_DIR || './artifacts';

const app = express();
app.use(express.json({ limit: '4mb' }));

// Shared-secret gate. n8n is the only caller; anything else is a mistake or an
// intruder, and this service can submit forms in your name.
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!TOKEN) return res.status(500).json({ error: 'APPLY_TOKEN not configured' });
  if (req.get('x-apply-token') !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    dry_run: process.env.DRY_RUN !== 'false',
    handlers: Object.keys(HANDLERS),
  });
});

/**
 * POST /render-pdf
 * { html, filename? } -> application/pdf
 *
 * Playwright is already here, so page.pdf() replaces an entire external PDF
 * service. n8n receives the binary and uploads it to Drive.
 */
app.post('/render-pdf', async (req, res) => {
  const { html, filename = 'document.pdf' } = req.body || {};
  if (!html) return res.status(400).json({ error: 'html is required' });
  try {
    const buffer = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    log.error('render-pdf failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /apply
 * {
 *   job_id, ats, url, company, title,
 *   resume_pdf_base64, cover_letter_text,
 *   profile: { name, email, phone, links, standard_answers }
 * }
 *
 * Always 200 with a result object — a failed application is data, not an
 * exception. n8n branches on `result`, and a thrown 500 would abort the loop
 * and strand the remaining jobs.
 */
app.post('/apply', async (req, res) => {
  const started = Date.now();
  const applicationId = `app_${randomUUID().slice(0, 12)}`;
  const job = req.body || {};

  if (!job.url || !job.ats) {
    return res.status(400).json({ error: 'url and ats are required' });
  }

  log.info('apply start', { applicationId, ats: job.ats, company: job.company, url: job.url });

  try {
    const outcome = await runApplication(job, { applicationId, artifactDir: ARTIFACTS });
    log.info('apply done', { applicationId, result: outcome.result, ms: Date.now() - started });
    res.json({ application_id: applicationId, duration_ms: Date.now() - started, ...outcome });
  } catch (err) {
    log.error('apply threw', { applicationId, error: err.message, stack: err.stack });
    res.json({
      application_id: applicationId,
      result: 'failed',
      error: err.message,
      duration_ms: Date.now() - started,
    });
  }
});

await mkdir(ARTIFACTS, { recursive: true });

const server = app.listen(PORT, () => {
  log.info(`apply-svc listening on :${PORT}`, {
    dry_run: process.env.DRY_RUN !== 'false',
  });
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    log.info(`${sig} received, shutting down`);
    server.close();
    await shutdownBrowser();
    process.exit(0);
  });
}
