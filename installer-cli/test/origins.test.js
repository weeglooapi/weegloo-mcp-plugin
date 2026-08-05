import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAPPABLE_SERVICES,
  normalizeOrigins,
  loadOrigins,
  applyOriginMapping,
  applyOriginsToResources,
  applyTermsExclusion,
  originsEqual,
  TERMS_CONSENT_RULE_ID,
} from '../src/origins.js';
import { applySelfUpdateTemplate, SELF_UPDATE_RULE_ID } from '../src/self-update.js';
import { VERSION_URL } from '../src/github.js';

const ACME = { cma: 'https://cma.acme.com' };

// ── normalizeOrigins (validation) ───────────────────────────────────────────────

test('normalizeOrigins: null/empty → null (no mapping); partial mapping allowed', () => {
  assert.equal(normalizeOrigins(null), null);
  assert.equal(normalizeOrigins({}), null);
  assert.deepEqual(normalizeOrigins(ACME), ACME); // cda 등 나머지 키 없이 cma만 — 유효
});

test('normalizeOrigins: unknown key is an ERROR, not silently ignored (typo safety)', () => {
  assert.throws(() => normalizeOrigins({ cdx: 'https://x.acme.com' }), /Unknown origins key/);
  assert.throws(() => normalizeOrigins({ docs: 'https://d.acme.com' }), /Unknown origins key/);
});

test('normalizeOrigins: values must be https origins — no path/query/http; port allowed', () => {
  assert.throws(() => normalizeOrigins({ cma: 'https://cma.acme.com/v1' }), /https origin/);
  assert.throws(() => normalizeOrigins({ cma: 'http://cma.acme.com' }), /https origin/);
  assert.deepEqual(
    normalizeOrigins({ cma: 'https://weegloo.acme.internal:8443' }),
    { cma: 'https://weegloo.acme.internal:8443' }
  );
});

test('normalizeOrigins: trailing slashes trimmed; full-origin keys accepted and normalized to service names', () => {
  assert.deepEqual(normalizeOrigins({ cma: 'https://cma.acme.com/' }), { cma: 'https://cma.acme.com' });
  // 옛 문서/복붙 관용: 전체 origin 키도 서비스명으로 정규화 수용
  assert.deepEqual(
    normalizeOrigins({ 'https://cma.weegloo.com/': 'https://cma.acme.com' }),
    { cma: 'https://cma.acme.com' }
  );
});

test('normalizeOrigins: a value containing any weegloo source host is rejected (circular/overlap)', () => {
  assert.throws(
    () => normalizeOrigins({ cma: 'https://cda.weegloo.com' }),
    /circular\/overlapping/
  );
  assert.throws(
    () => normalizeOrigins({ cma: 'https://cma.weegloo.com.acme.com' }),
    /circular\/overlapping/
  );
});

test('normalizeOrigins: a host-boundary prefix on the same domain is allowed (dev-* environment split)', () => {
  // The collision check uses the same boundary rule as the substitution, so `dev-cma…` is not
  // "containing" `cma.weegloo.com` — a plain includes() rejected the whole dev stack.
  const dev = Object.fromEntries(
    ['cma', 'cda', 'acma', 'acda', 'upload', 'auth', 'console', 'ai']
      .map((s) => [s, `https://dev-${s}.weegloo.com`])
  );
  assert.deepEqual(normalizeOrigins(dev), dev);
  // …while an exact source host (a true no-op/circular mapping) stays rejected.
  assert.throws(() => normalizeOrigins({ cma: 'https://cma.weegloo.com' }), /circular\/overlapping/);
});

test('applyOriginMapping: dev-* same-domain mapping substitutes once, order-independently', () => {
  const dev = { cma: 'https://dev-cma.weegloo.com', acma: 'https://dev-acma.weegloo.com' };
  const out = applyOriginMapping(
    'https://cma.weegloo.com/v1 https://acma.weegloo.com/v1 bare cma.weegloo.com https://cda-weegloo.com',
    dev
  );
  assert.ok(out.includes('https://dev-cma.weegloo.com/v1'));
  assert.ok(out.includes('https://dev-acma.weegloo.com/v1'), 'acma not clobbered by the cma pattern');
  assert.ok(out.includes('bare dev-cma.weegloo.com'), 'bare mention rewritten too');
  assert.ok(!out.includes('dev-dev-'), 'no double substitution');
  assert.ok(out.includes('https://cda-weegloo.com'), 'wrong-example untouched');
});

test('loadOrigins: inline JSON and file path both work; bad file/JSON produce friendly errors', () => {
  assert.deepEqual(loadOrigins(JSON.stringify(ACME)), ACME);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weegloo-origins-'));
  try {
    const file = path.join(dir, 'origins.json');
    fs.writeFileSync(file, JSON.stringify(ACME), 'utf-8');
    assert.deepEqual(loadOrigins(file), ACME);
    assert.throws(() => loadOrigins(path.join(dir, 'missing.json')), /Could not read origins file/);
    fs.writeFileSync(file, '{ not json', 'utf-8');
    assert.throws(() => loadOrigins(file), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── applyOriginMapping (host-level substitution) ────────────────────────────────

test('applyOriginMapping: rewrites scheme URLs (path preserved) AND bare prose mentions', () => {
  const input = [
    'Base URL: `https://cma.weegloo.com`',
    'GET https://cma.weegloo.com/v1/spaces/{spaceId}/contents?limit=10',
    'the `cma.weegloo.com` host handles management calls', // bare mention (실측 52곳 케이스)
  ].join('\n');
  const out = applyOriginMapping(input, ACME);
  assert.ok(!out.includes('cma.weegloo.com'));
  assert.ok(out.includes('https://cma.acme.com/v1/spaces/{spaceId}/contents?limit=10'), 'path/query preserved');
  assert.ok(out.includes('the `cma.acme.com` host'));
});

test('applyOriginMapping: the deliberate wrong-example host and unmapped hosts stay untouched', () => {
  const input = 'Wrong: `https://cda-weegloo.com` — docs at https://docs.weegloo.com/llms.txt, cda at https://cda.weegloo.com';
  const out = applyOriginMapping(input, ACME); // cma만 매핑
  assert.ok(out.includes('https://cda-weegloo.com'), 'wrong-example untouched (dash ≠ dot)');
  assert.ok(out.includes('https://docs.weegloo.com/llms.txt'), 'public-fixed host untouched');
  assert.ok(out.includes('https://cda.weegloo.com'), 'unmapped origin untouched (partial mapping)');
});

test('applyOriginMapping: null mapping is a byte-identical passthrough', () => {
  const input = 'https://cma.weegloo.com and cma.weegloo.com';
  assert.equal(applyOriginMapping(input, null), input);
});

// ── applyOriginsToResources / applyTermsExclusion ───────────────────────────────

const RESOURCES = {
  version: 'v9',
  mcp: { weeglooUrl: 'https://ai.weegloo.com/mcp', uploadApiUrl: 'https://upload.weegloo.com/v1' },
  skills: [{ id: 'weegloo-a', files: { 'SKILL.md': 'call https://cma.weegloo.com/v1/x' } }],
  rules: [
    { id: 'weegloo-global-rules', content: 'use cma.weegloo.com for management' },
    { id: TERMS_CONSENT_RULE_ID, content: 'terms at https://cma.weegloo.com/v1/policy/terms' },
  ],
};

test('applyOriginsToResources: skills + rules + MCP URLs all rewritten; original object untouched', () => {
  const origins = { ...ACME, ai: 'https://ai.acme.com', upload: 'https://upload.acme.com' };
  const out = applyOriginsToResources(RESOURCES, origins);
  assert.equal(out.mcp.weeglooUrl, 'https://ai.acme.com/mcp');
  assert.equal(out.mcp.uploadApiUrl, 'https://upload.acme.com/v1');
  assert.equal(out.skills[0].files['SKILL.md'], 'call https://cma.acme.com/v1/x');
  assert.equal(out.rules[0].content, 'use cma.acme.com for management');
  // 원본 불변 (매번 원본에서 새로 치환 — 이중 치환 없음의 전제)
  assert.equal(RESOURCES.skills[0].files['SKILL.md'], 'call https://cma.weegloo.com/v1/x');
  assert.equal(RESOURCES.mcp.weeglooUrl, 'https://ai.weegloo.com/mcp');
});

test('applyTermsExclusion: ANY origins mapping → terms-consent leaves the catalog; no mapping → untouched', () => {
  // origins 사용 자체가 표준 스택 바깥(스테이징/B2B) — cma 여부와 무관하게 제외 (조건 단순화).
  const excluded = applyTermsExclusion(RESOURCES, ACME);
  assert.deepEqual(excluded.rules.map((r) => r.id), ['weegloo-global-rules']);
  const cdaOnly = applyTermsExclusion(RESOURCES, { cda: 'https://cda.acme.com' });
  assert.deepEqual(cdaOnly.rules.map((r) => r.id), ['weegloo-global-rules'], 'cma 없이도 제외');
  assert.deepEqual(applyTermsExclusion(RESOURCES, null).rules.length, 2, '매핑 없음 → 그대로');
});

// ── 버전 룰 굽기 순서: 템플릿이 삽입하는 체크 URL도 매핑을 타야 함 ─────────────

test('applySelfUpdateTemplate: the baked version-check URL goes through the origins mapping', () => {
  const rule = { id: SELF_UPDATE_RULE_ID, content: 'GET {{WEEGLOO_VERSION_URL}}' };
  const origins = { ai: 'https://ai.acme.com' };
  const [out] = applySelfUpdateTemplate([rule], { agent: 'claude', ref: 'latest', scope: 'global', origins });
  assert.ok(out.content.includes('https://ai.acme.com/v1/version?branch=latest'));
  assert.ok(!out.content.includes('ai.weegloo.com'));
  // 매핑 없음 → 프로덕션 URL 그대로 (회귀)
  const [plain] = applySelfUpdateTemplate([rule], { agent: 'claude', ref: 'latest', scope: 'global' });
  assert.ok(plain.content.includes(`${VERSION_URL}?branch=latest`));
});

// ── originsEqual (공유 스토어 충돌 감지용) ──────────────────────────────────────

test('originsEqual: order-insensitive equality, null ≡ empty', () => {
  const a = { cma: 'https://cma.acme.com', cda: 'https://cda.acme.com' };
  const b = { cda: 'https://cda.acme.com', cma: 'https://cma.acme.com' };
  assert.equal(originsEqual(a, b), true);
  assert.equal(originsEqual(null, {}), true);
  assert.equal(originsEqual(a, null), false);
  assert.equal(originsEqual(a, { ...a, cma: 'https://other.acme.com' }), false);
});

test('MAPPABLE_SERVICES: exactly the 8 decided services', () => {
  assert.deepEqual(Object.keys(MAPPABLE_SERVICES), ['cma', 'cda', 'acma', 'acda', 'upload', 'auth', 'console', 'ai']);
});

// acma ⊃ cma, acda ⊃ cda — 8개 호스트는 상호 비중첩이 아니어서 단순 replaceAll이면
// cma 매핑이 acma까지 오염시킨다. 경계 검사(hostPattern)가 그걸 막는지가 이 테스트.
test('applyOriginMapping: boundary guard — mapping cma must NOT bleed into acma (and cda into acda)', () => {
  const input = 'acma.weegloo.com and cma.weegloo.com; https://acda.weegloo.com/v1 vs https://cda.weegloo.com/v1';
  const cmaOnly = applyOriginMapping(input, { cma: 'https://cma.acme.com' });
  assert.equal(
    cmaOnly,
    'acma.weegloo.com and cma.acme.com; https://acda.weegloo.com/v1 vs https://cda.weegloo.com/v1'
  );
  // 넷 다 매핑 — 순서 무관하게 각자 정확히
  const all = applyOriginMapping(input, {
    acma: 'https://acma.acme.com',
    cma: 'https://cma.acme.com',
    acda: 'https://acda.acme.com',
    cda: 'https://cda.acme.com',
  });
  assert.equal(
    all,
    'acma.acme.com and cma.acme.com; https://acda.acme.com/v1 vs https://cda.acme.com/v1'
  );
});

test('applyOriginMapping: sentence-final dot and backticks still map; suffix-alike tokens do not', () => {
  const out = applyOriginMapping('see `cma.weegloo.com`, then cma.weegloo.com. Also cma.weegloo.company stays.', {
    cma: 'https://cma.acme.com',
  });
  assert.equal(out, 'see `cma.acme.com`, then cma.acme.com. Also cma.weegloo.company stays.');
});
