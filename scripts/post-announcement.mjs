#!/usr/bin/env node
/**
 * Posts a generated release announcement to Weegloo CMA as a Content entry.
 *
 * Reads the announcement JSON produced by the `weegloo-announce` agent
 * (`.claude/agents/weegloo-announce.md`), wraps it in the Weegloo content payload
 * envelope, and POSTs it. The agent produces ONLY the localized content
 * (title/summary/body for 10 locales); the fixed envelope values (pinned, category,
 * metadata.tags) and the auth/secret live here — never in the LLM.
 *
 * Skip guard: if the agent reported no user-facing change (`changed` empty), this
 * exits 0 without posting, so a typo-only / internal push never creates an empty
 * announcement in Weegloo.
 *
 * Env:
 *   WEEGLOO_CMA_TOKEN   (required)  Bearer token for CMA. Provided via GitHub Secret.
 *   ANNOUNCEMENT_PATH   (optional)  Path to the announcement JSON. Default announcement.json
 *   WEEGLOO_CMA_BASE    (optional)  CMA base URL. Default production.
 *   WEEGLOO_SPACE_ID    (optional)  Space id. Default production announcement space.
 *   WEEGLOO_CONTENT_TYPE_ID (optional) Content type id. Default production announcement type.
 */
import { readFileSync } from 'node:fs';

const CMA_BASE = process.env.WEEGLOO_CMA_BASE || 'https://cma.weegloo.com/v1';
const SPACE_ID = process.env.WEEGLOO_SPACE_ID || '42EhgutI';
const CONTENT_TYPE_ID = process.env.WEEGLOO_CONTENT_TYPE_ID || '3trmXRN5fEtDh8odpgvtQdZeNlImcH';
const ANNOUNCEMENT_PATH = process.env.ANNOUNCEMENT_PATH || 'announcement.json';
const TOKEN = process.env.WEEGLOO_CMA_TOKEN;

function fail(msg) {
  console.error(`[post-announcement] ${msg}`);
  process.exit(1);
}

if (!TOKEN) fail('WEEGLOO_CMA_TOKEN is not set');

let ann;
try {
  ann = JSON.parse(readFileSync(ANNOUNCEMENT_PATH, 'utf-8'));
} catch (e) {
  fail(`cannot read/parse ${ANNOUNCEMENT_PATH}: ${e.message}`);
}

// Skip guard — nothing user-facing to announce.
if (!Array.isArray(ann.changed) || ann.changed.length === 0) {
  console.log('[post-announcement] no user-facing change (changed is empty) — skipping POST');
  process.exit(0);
}

// Sanity: the three localized field maps must exist and agree on locale keys.
for (const f of ['title', 'summary', 'body']) {
  if (!ann[f] || typeof ann[f] !== 'object' || Object.keys(ann[f]).length === 0) {
    fail(`announcement.${f} is missing or empty`);
  }
}
const titleKeys = Object.keys(ann.title).sort().join(',');
for (const f of ['summary', 'body']) {
  if (Object.keys(ann[f]).sort().join(',') !== titleKeys) {
    fail(`locale keys of ${f} do not match title`);
  }
}

// Per-field length caps — hard publish constraints. Count characters (code points),
// not bytes, so CJK/Devanagari are measured fairly.
const MAX_LEN = { title: 64, summary: 64, body: 204800 };
for (const f of ['title', 'summary', 'body']) {
  for (const [locale, value] of Object.entries(ann[f])) {
    const len = [...String(value)].length;
    if (len > MAX_LEN[f]) {
      const preview = f === 'body' ? '' : `: ${JSON.stringify(value)}`;
      fail(`${f}[${locale}] is ${len} chars (max ${MAX_LEN[f]})${preview}`);
    }
  }
}

const payload = {
  fields: {
    title: ann.title,
    summary: ann.summary,
    body: ann.body,
    pinned: { 'en-US': false },
    category: { 'en-US': 'Release' },
  },
  metadata: { tags: [] },
};

const createUrl = `${CMA_BASE}/spaces/${SPACE_ID}/content-types/${CONTENT_TYPE_ID}/contents`;
console.log(`[post-announcement] create + publish (${ann.changed.length} change(s), ${Object.keys(ann.title).length} locales)`);

// DRY_RUN — validate + show the envelope without sending (used in CI smoke tests / locally).
if (process.env.DRY_RUN) {
  console.log(`[post-announcement] DRY_RUN — would POST ${createUrl} then PUBLISH the created content. Payload:`);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

// 1) Create the content. A Content is NOT published automatically on create.
const createRes = await fetch(createUrl, {
  method: 'POST',
  headers: {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/vnd.com.weegloo.v1+json;charset=UTF-8',
    Authorization: `Bearer ${TOKEN}`,
  },
  body: JSON.stringify(payload),
});
const createText = await createRes.text();
if (!createRes.ok) {
  fail(`create failed ${createRes.status} ${createRes.statusText}: ${createText.slice(0, 1000)}`);
}
let created;
try {
  created = JSON.parse(createText);
} catch {
  fail(`create response is not JSON: ${createText.slice(0, 300)}`);
}
const contentId = created?.sys?.id;
const version = created?.sys?.version;
if (!contentId) fail(`create response has no sys.id: ${createText.slice(0, 300)}`);
console.log(`[post-announcement] created content ${contentId} (version ${version ?? 'n/a'})`);

// 2) Publish it. PUT .../contents/{id}/publish, no body; X-Weegloo-Version carries the
// current sys.version for optimistic concurrency control.
const publishUrl = `${CMA_BASE}/spaces/${SPACE_ID}/contents/${contentId}/publish`;
const publishHeaders = {
  accept: 'application/json, text/plain, */*',
  Authorization: `Bearer ${TOKEN}`,
};
if (version !== undefined && version !== null) {
  publishHeaders['X-Weegloo-Version'] = String(version);
}
const publishRes = await fetch(publishUrl, { method: 'PUT', headers: publishHeaders });
const publishText = await publishRes.text();
if (!publishRes.ok) {
  fail(`publish failed ${publishRes.status} ${publishRes.statusText}: ${publishText.slice(0, 1000)}`);
}
console.log(`[post-announcement] published content ${contentId} (${publishRes.status})`);
