// Shared helpers, injected into every Code node by scripts/build.mjs.
//
// NOTE: n8n Code nodes cannot `require()` Node builtins. Everything here is
// dependency-free on purpose. They CAN read process.env, because the bundled
// docker-compose sets NODE_FUNCTION_ALLOW_ENV=* — which is how your .env
// reaches this file without any secret being written into a workflow.

const ENV = (typeof process !== 'undefined' && process.env) ? process.env : {};

function env(key, fallback = '') {
  const v = ENV[key];
  return v === undefined || v === '' ? fallback : String(v);
}
function envNum(key, fallback) {
  const n = Number(env(key, ''));
  return Number.isFinite(n) ? n : fallback;
}
function envBool(key, fallback) {
  const v = env(key, '').toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

/** FNV-1a style hash, hex. Not cryptographic — only needs to avoid collisions. */
function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const TRACKING_PARAMS = [
  'refId', 'trackingId', 'trk', 'trkInfo', 'originalSubdomain', 'position',
  'pageNum', 'eBP', 'lipi', 'licu', 'gh_src', 'gh_jid', 'lever-origin',
  'lever-source', 'source', 'src', 'ref', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid',
];

/** Strip tracking junk so the same posting always yields the same key. */
function canonicalUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let u;
  try { u = new URL(raw.trim()); } catch { return raw.trim(); }
  u.hash = '';
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  const li = u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/);
  if (u.hostname.includes('linkedin.com') && li) {
    return `https://www.linkedin.com/jobs/view/${li[1]}`;
  }
  u.search = u.searchParams.toString();
  return u.toString().replace(/\/$/, '');
}

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same role reposted under a fresh URL must collapse to one row. */
function fingerprint(job) {
  const city = slug(job.location).split(' ').slice(0, 2).join(' ');
  return hash([slug(job.company), slug(job.title), city].join('|'));
}

function nowIso() { return new Date().toISOString(); }

// ===========================================================================
// LLM providers
// ===========================================================================
// Switch with LLM_PROVIDER in .env: anthropic | openai | gemini
//
// Every provider here is asked for schema-enforced JSON, so the parsing nodes
// downstream stay identical no matter which one you pick. The differences —
// endpoint, auth header, request shape, response shape, and what each one's
// JSON-schema dialect will accept — are all absorbed in this block.

const LLM_PROVIDER = env('LLM_PROVIDER', 'anthropic').toLowerCase();

/** Per-stage model override, else the provider's default model. */
function modelFor(stage) {
  const perStage = {
    anthropic: { extract: 'ANTHROPIC_MODEL_EXTRACT', default: 'ANTHROPIC_MODEL' },
    openai:    { extract: 'OPENAI_MODEL_EXTRACT',    default: 'OPENAI_MODEL' },
    gemini:    { extract: 'GEMINI_MODEL_EXTRACT',    default: 'GEMINI_MODEL' },
  }[LLM_PROVIDER];
  const fallbackModel = {
    anthropic: 'claude-opus-5',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash',
  }[LLM_PROVIDER];
  const base = env(perStage.default, fallbackModel);
  return stage === 'extract' ? env(perStage.extract, base) : base;
}

/**
 * OpenAI strict mode rejects validation keywords it does not implement, and
 * Gemini uses an OpenAPI dialect rather than JSON Schema. Both need the same
 * source schema reshaped rather than two schemas maintained by hand.
 */
function stripUnsupported(schema) {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'minimum' || k === 'maximum' || k === 'minItems' || k === 'maxItems') continue;
    out[k] = stripUnsupported(v);
  }
  return out;
}

function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === 'minimum' || k === 'maximum') continue;
    if (k === 'type' && Array.isArray(v)) {
      // ["string","null"] -> type: "string" + nullable: true
      const real = v.find((t) => t !== 'null');
      out.type = real || 'string';
      if (v.includes('null')) out.nullable = true;
      continue;
    }
    out[k] = toGeminiSchema(v);
  }
  return out;
}

const PROVIDERS = {
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: () => {
      const h = {
        'content-type': 'application/json',
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      };
      if (envBool('ANTHROPIC_ENABLE_FALLBACKS', true)) {
        h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      }
      return h;
    },
    body: ({ model, system, user, schema, effort, maxTokens }) => {
      const b = {
        model,
        max_tokens: maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: user }],
      };
      // Rescues a policy decline by re-running on a fallback model in the
      // same call. Turn off with ANTHROPIC_ENABLE_FALLBACKS=false if your
      // account does not have the beta — the header goes with it.
      if (envBool('ANTHROPIC_ENABLE_FALLBACKS', true)) b.fallbacks = 'default';
      return b;
    },
    text: (r) => (r?.content || []).find((b) => b.type === 'text')?.text,
  },

  openai: {
    url: () => `${env('OPENAI_BASE_URL', 'https://api.openai.com/v1')}/chat/completions`,
    headers: () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${env('OPENAI_API_KEY')}`,
    }),
    body: ({ model, system, user, schema, maxTokens }) => {
      const b = {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', strict: true, schema: stripUnsupported(schema) },
        },
      };
      const effort = env('OPENAI_REASONING_EFFORT');
      if (effort) b.reasoning_effort = effort;   // reasoning models only
      return b;
    },
    text: (r) => r?.choices?.[0]?.message?.content,
  },

  gemini: {
    url: ({ model }) =>
      `${env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')}` +
      `/models/${model}:generateContent`,
    headers: () => ({
      'content-type': 'application/json',
      // Header rather than ?key= so the secret never lands in a URL or a log.
      'x-goog-api-key': env('GEMINI_API_KEY'),
    }),
    body: ({ system, user, schema, maxTokens }) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    }),
    text: (r) => r?.candidates?.[0]?.content?.parts?.map((p) => p.text).join(''),
  },
};

/**
 * Builds a complete provider-agnostic request. The HTTP node reads url,
 * headers and body straight off `_llm`, so switching providers never touches
 * a workflow node.
 */
function llmRequest({ stage = 'default', system, user, schema, effort = 'medium', maxTokens = 8000 }) {
  const p = PROVIDERS[LLM_PROVIDER];
  if (!p) {
    throw new Error(
      `LLM_PROVIDER="${LLM_PROVIDER}" is not supported. Use anthropic, openai or gemini.`
    );
  }
  const model = modelFor(stage);
  const args = { model, system, user, schema, effort, maxTokens };
  return {
    provider: LLM_PROVIDER,
    model,
    url: typeof p.url === 'function' ? p.url(args) : p.url,
    headers: p.headers(args),
    body: p.body(args),
  };
}

/**
 * Pulls the JSON text out of whichever provider answered. Throws with the
 * provider's own error message when the call failed, so a bad key or a wrong
 * model name says so instead of surfacing as "undefined is not valid JSON".
 */
function llmText(response) {
  const p = PROVIDERS[LLM_PROVIDER];
  const text = p?.text(response);
  if (text) return text;

  const err =
    response?.error?.message ||
    response?.error?.[0]?.message ||
    response?.message ||
    (response?.promptFeedback?.blockReason
      ? `blocked: ${response.promptFeedback.blockReason}`
      : '');
  throw new Error(
    err
      ? `${LLM_PROVIDER} call failed: ${err}`
      : `${LLM_PROVIDER} returned no text. Raw: ${JSON.stringify(response).slice(0, 400)}`
  );
}
