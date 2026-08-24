const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;

function emit(level, msg, meta) {
  if (LEVELS[level] < MIN) return;
  const line = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const log = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
