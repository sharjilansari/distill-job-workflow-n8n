/**
 * Google Apps Script — creates the four tabs with correct headers.
 *
 * Setup:
 *   1. Create a new Google Sheet, name it "job-agent".
 *   2. Extensions > Apps Script, paste this file, save.
 *   3. Run `bootstrap`. Grant the permission prompt.
 *   4. Copy the spreadsheet ID out of the URL into .env as SHEET_ID.
 */

const TABS = {
  raw_inbox: [
    'run_id', 'received_at', 'source_channel', 'monitor_name', 'monitor_uri',
    'raw_text', 'processed',
  ],
  jobs: [
    'job_id', 'fingerprint', 'source', 'company', 'title', 'location',
    'remote_type', 'experience_min', 'experience_max', 'salary', 'url',
    'canonical_url', 'jd_text', 'posted_at', 'discovered_at', 'run_id',
    'score', 'score_reason', 'missing_skills', 'resume_variant', 'status',
    'attempts', 'last_error', 'applied_at',
  ],
  applications: [
    'application_id', 'job_id', 'company', 'title', 'attempted_at', 'method',
    'ats', 'result', 'resume_url', 'cover_letter_url', 'screenshot_before',
    'screenshot_after', 'error',
  ],
  run_log: [
    'run_id', 'workflow', 'started_at', 'finished_at', 'raw_count',
    'extracted', 'deduped_new', 'filtered_out', 'scored', 'queued',
    'applied', 'failed', 'notes',
  ],
};

// status values used by the state machine, enforced as a dropdown on `jobs`
const STATUSES = [
  'new', 'enriched', 'scored', 'queued', 'review', 'applied',
  'skipped', 'manual', 'failed', 'expired',
];

function bootstrap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.entries(TABS).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#1f2933')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  });

  // Dropdown on jobs.status so a typo can never strand a row outside the
  // state machine.
  const jobs = ss.getSheetByName('jobs');
  const statusCol = TABS.jobs.indexOf('status') + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUSES, true)
    .setAllowInvalid(false)
    .build();
  jobs.getRange(2, statusCol, jobs.getMaxRows() - 1, 1).setDataValidation(rule);

  // Colour-code the statuses you actually scan for by eye.
  const rules = [
    ['queued', '#fff3cd'],
    ['applied', '#d1e7dd'],
    ['failed', '#f8d7da'],
    ['manual', '#cfe2ff'],
    ['review', '#e2d9f3'],
  ].map(([value, colour]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value)
      .setBackground(colour)
      .setRanges([jobs.getRange(2, statusCol, jobs.getMaxRows() - 1, 1)])
      .build()
  );
  jobs.setConditionalFormatRules(rules);

  // raw_text holds whole page diffs; keep the tab readable.
  const raw = ss.getSheetByName('raw_inbox');
  raw.setColumnWidth(TABS.raw_inbox.indexOf('raw_text') + 1, 400);

  const dflt = ss.getSheetByName('Sheet1');
  if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);

  SpreadsheetApp.getUi().alert('Created: ' + Object.keys(TABS).join(', '));
}

/**
 * Optional housekeeping — run on a time trigger.
 * Marks stale unapplied jobs `expired` and trims raw_inbox to 60 days.
 */
function housekeeping() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobs = ss.getSheetByName('jobs');
  const data = jobs.getDataRange().getValues();
  const head = data[0];
  const iDisc = head.indexOf('discovered_at');
  const iStat = head.indexOf('status');
  const cutoff = Date.now() - 21 * 24 * 3600 * 1000;

  for (let r = 1; r < data.length; r++) {
    const stale = new Date(data[r][iDisc]).getTime() < cutoff;
    const open = ['new', 'scored', 'queued', 'review'].includes(data[r][iStat]);
    if (stale && open) jobs.getRange(r + 1, iStat + 1).setValue('expired');
  }

  const raw = ss.getSheetByName('raw_inbox');
  const keep = 60 * 10; // ~60 days at 10 monitors/day
  const extra = raw.getLastRow() - 1 - keep;
  if (extra > 0) raw.deleteRows(2, extra);
}
