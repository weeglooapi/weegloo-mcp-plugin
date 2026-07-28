import assert from 'node:assert/strict';
import test from 'node:test';

import { validateToken, cmaMeUrl } from '../src/validate-token.js';

test('cmaMeUrl derives the CMA /v1/me URL from the upload API URL (prod)', () => {
  assert.equal(
    cmaMeUrl({ uploadApiUrl: 'https://upload.weegloo.com/v1' }),
    'https://cma.weegloo.com/v1/me'
  );
});

test('cmaMeUrl tracks the environment prefix (dev-upload → dev-cma)', () => {
  assert.equal(
    cmaMeUrl({ uploadApiUrl: 'https://dev-upload.weegloo.com/v1' }),
    'https://dev-cma.weegloo.com/v1/me'
  );
});

test('cmaMeUrl falls back to production CMA when upload URL is missing/unexpected', () => {
  assert.equal(cmaMeUrl(undefined), 'https://cma.weegloo.com/v1/me');
  assert.equal(cmaMeUrl({}), 'https://cma.weegloo.com/v1/me');
  assert.equal(cmaMeUrl({ uploadApiUrl: 'https://example.com/v1' }), 'https://cma.weegloo.com/v1/me');
});

test('validateToken: 200 → ok, and sends Bearer auth via GET with no Accept header', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return new Response('{}', { status: 200 });
  };
  const result = await validateToken('PSNATC_good', {
    meUrl: 'https://cma.weegloo.com/v1/me',
    fetchImpl,
  });

  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(captured.url, 'https://cma.weegloo.com/v1/me');
  assert.equal(captured.opts.method, 'GET');
  assert.equal(captured.opts.headers.Authorization, 'Bearer PSNATC_good');
  // Must NOT negotiate application/json — Weegloo speaks a vendor media type.
  assert.equal('Accept' in captured.opts.headers, false);
  // A timeout abort signal is always wired.
  assert.ok(captured.opts.signal);
});

test('validateToken: 401 → not ok, status surfaced (definitive rejection, not a network error)', async () => {
  const fetchImpl = async () => new Response('unauthorized', { status: 401 });
  const result = await validateToken('PSNATC_bad', {
    meUrl: 'https://cma.weegloo.com/v1/me',
    fetchImpl,
  });
  assert.deepEqual(result, { ok: false, status: 401 });
});

test('validateToken: non-200 (e.g. 500) is treated as invalid, not verified', async () => {
  const fetchImpl = async () => new Response('server error', { status: 500 });
  const result = await validateToken('PSNATC_x', {
    meUrl: 'https://cma.weegloo.com/v1/me',
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

test('validateToken: a thrown fetch (connection failure/timeout abort) → networkError', async () => {
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND cma.weegloo.com');
  };
  const result = await validateToken('PSNATC_x', {
    meUrl: 'https://cma.weegloo.com/v1/me',
    fetchImpl,
  });
  assert.deepEqual(result, { ok: false, networkError: true });
});

// ── origins 매핑과 토큰 검증 URL ────────────────────────────────────────────

test('cmaMeUrl: origins가 있으면 명시적 — cma 매핑이면 고객 CMA, 아니면 프로덕션 (휴리스틱 미사용)', () => {
  // cma 매핑 → 고객 스택 PAT는 고객 CMA에 검증
  assert.equal(
    cmaMeUrl({ uploadApiUrl: 'https://upload-weegloo.neld.ai/v1' }, { cma: 'https://cma-weegloo.neld.ai' }),
    'https://cma-weegloo.neld.ai/v1/me'
  );
  // origins는 있지만 cma 미매핑 → CMA는 프로덕션이 맞음. 매핑된 upload 값에 휴리스틱을
  // 돌리면 안 됨('upload.acme.com' → 'cma.acme.com' 같은 존재하지 않는 호스트가 나옴).
  assert.equal(
    cmaMeUrl({ uploadApiUrl: 'https://upload.acme.com/v1' }, { upload: 'https://upload.acme.com' }),
    'https://cma.weegloo.com/v1/me'
  );
});

test('cmaMeUrl: origins 없음 → 기존 dev-manifest 휴리스틱 유지 (회귀)', () => {
  assert.equal(
    cmaMeUrl({ uploadApiUrl: 'https://dev-upload.weegloo.com/v1' }),
    'https://dev-cma.weegloo.com/v1/me'
  );
  assert.equal(cmaMeUrl(undefined), 'https://cma.weegloo.com/v1/me');
});
