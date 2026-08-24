import { withContext } from './browser.js';

/**
 * HTML string -> PDF buffer.
 *
 * `printBackground` matters: without it every background colour in the resume
 * template renders white, which usually means the header band disappears.
 */
export async function renderPdf(html) {
  return withContext(null, async (context) => {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Give webfonts a beat to settle, otherwise metrics shift after layout.
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    return page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
    });
  });
}
