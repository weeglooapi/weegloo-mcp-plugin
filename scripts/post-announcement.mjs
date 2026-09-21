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
 * The POST TARGET is not hardcoded. This repository is public, so the announcement Space and
 * ContentType ids live outside it: in the environment, or in a gitignored `.env` at the repo
 * root (same convention as `installer-cli/scripts/release.mjs` and its NPM_TOKEN). They are
 * not secrets — a write still needs the token — but a public default publishes the exact
 * coordinates of the production announcement feed, which is free to avoid. `.env.example`
 * shows the shape. Missing ⇒ the script refuses rather than posting somewhere arbitrary.
 *
 * Env (or the same keys in a gitignored repo-root `.env`, except the token):
 *   WEEGLOO_CMA_TOKEN   (required)  Bearer token for CMA. Runtime input only — never a file.
 *   WEEGLOO_SPACE_ID    (required)  Announcement Space id.
 *   WEEGLOO_CONTENT_TYPE_ID (required) Announcement ContentType id.
 *   ANNOUNCEMENT_PATH   (optional)  Path to the announcement JSON. Default announcement.json
 *   WEEGLOO_CMA_BASE    (optional)  CMA base URL. Default production.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`[post-announcement] ${msg}`);
  process.exit(1);
}

/** `KEY=value` from the gitignored repo-root `.env`; optional quotes, optional `export `. */
function fromEnvFile(key) {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return null;
  let text;
  try {
    text = readFileSync(envPath, 'utf-8');
  } catch {
    return null;
  }
  const m = text.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  let val = m[1].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val || null;
}

/** Env wins over `.env`; absent ⇒ stop with the name of what to set (never a guessed target). */
function requiredSetting(key, what) {
  const value = process.env[key] || fromEnvFile(key);
  if (!value) fail(`${key} is not set — ${what}. Put it in the environment or in a gitignored .env at the repo root (see .env.example).`);
  return value;
}

const CMA_BASE = process.env.WEEGLOO_CMA_BASE || fromEnvFile('WEEGLOO_CMA_BASE') || 'https://cma.weegloo.com/v1';
const ANNOUNCEMENT_PATH = process.env.ANNOUNCEMENT_PATH || 'announcement.json';
const TOKEN = process.env.WEEGLOO_CMA_TOKEN;

if (!TOKEN) fail('WEEGLOO_CMA_TOKEN is not set');

const SPACE_ID = requiredSetting('WEEGLOO_SPACE_ID', 'the announcement Space id');
const CONTENT_TYPE_ID = requiredSetting('WEEGLOO_CONTENT_TYPE_ID', 'the announcement ContentType id');

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
