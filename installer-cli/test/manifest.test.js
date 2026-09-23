import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBranchesFromInfoRefs, loadResources } from '../src/github.js';
import { extractCountryTag } from '../src/country.js';
import { buildManifest, serializeManifest, countryReport } from '../../scripts/build-installer-manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Builds a fake git-upload-pack ref advertisement (pkt-line text). */
function advertise(refs) {
  let body = '0011# service=git-upload-pack\n0000';
  let first = true;
  for (const [sha, ref] of refs) {
    const caps = first ? '\0multi_ack symref=HEAD:refs/heads/latest' : '';
    body += `0000${sha} ${ref}${caps}\n`;
    first = false;
  }
  return `${body}0000`;
}

test('parseBranchesFromInfoRefs extracts heads, drops capabilities and tags', () => {
  const adv = advertise([
    ['a'.repeat(40), 'refs/heads/latest'],
    ['b'.repeat(40), 'refs/heads/1.0.12'],
    ['c'.repeat(40), 'refs/heads/develop'],
    ['d'.repeat(40), 'refs/tags/v1.0.0'],
  ]);
  // Parser preserves advertisement order + dedups; ordering is the caller's concern.
  assert.deepEqual(parseBranchesFromInfoRefs(adv), ['latest', '1.0.12', 'develop']);
});

test('parseBranchesFromInfoRefs returns [] on empty / non-advertisement input', () => {
  assert.deepEqual(parseBranchesFromInfoRefs(''), []);
  assert.deepEqual(parseBranchesFromInfoRefs('garbage without refs'), []);
});

test('buildManifest is deterministic and embeds skill/rule text + MCP urls', () => {
  const manifest = buildManifest({ rootDir: REPO_ROOT });

  assert.equal(manifest.schemaVersion, 1);
  // Content fingerprint: non-empty, and a pure function of content (verified by the
  // byte-identical re-build below) so the regenerate-on-push idempotence guard holds.
  assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0, 'has version');
  assert.equal(manifest.repoContentPrefix, 'plugins/weegloo');
  assert.ok(manifest.mcp.weeglooUrl.length > 0 && manifest.mcp.uploadApiUrl.length > 0);
  assert.ok(manifest.skills.length > 0, 'has skills');
  assert.ok(manifest.rules.length > 0, 'has rules');

  for (const skill of manifest.skills) {
    assert.ok(typeof skill.id === 'string' && skill.id.length > 0);
    assert.ok('SKILL.md' in skill.files, `${skill.id} embeds SKILL.md`);
    assert.ok(skill.files['SKILL.md'].length > 0);
  }
  for (const rule of manifest.rules) {
    assert.ok(typeof rule.content === 'string' && rule.content.length > 0);
  }

  // No volatile fields — required for the regenerate-on-push idempotence guard.
  assert.ok(!('generatedAt' in manifest) && !('commit' in manifest));

  // Same content -> byte-identical output.
  assert.equal(
    serializeManifest(buildManifest({ rootDir: REPO_ROOT })),
    serializeManifest(manifest)
  );
});

test('loadResources normalizes a manifest fetched from raw', async () => {
  const manifest = {
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: { weeglooUrl: 'https://dev-ai.weegloo.com/mcp', uploadApiUrl: 'https://dev-upload.weegloo.com/v1' },
    skills: [{ id: 'a', files: { 'SKILL.md': 'hi', 'metadata.json': '{}' } }],
    rules: [{ id: 'r', content: 'rule body' }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response('not found', { status: 404 });
  try {
    const r = await loadResources('dev-latest');
    assert.equal(r.source, 'manifest');
    assert.equal(r.mcp.weeglooUrl, 'https://dev-ai.weegloo.com/mcp');
    assert.deepEqual(r.skills, [{ id: 'a', files: { 'SKILL.md': 'hi', 'metadata.json': '{}' } }]);
    assert.deepEqual(r.rules, [{ id: 'r', content: 'rule body' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadResources returns null when no manifest is reachable (caller fails fast)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  try {
    assert.equal(await loadResources('missing-branch'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildManifest throws when an existing .mcp.json is malformed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-mcp-bad-'));
  try {
    const contentRoot = path.join(root, 'plugins', 'weegloo');
    mkdirSync(path.join(contentRoot, 'skills', 's1'), { recursive: true });
    writeFileSync(path.join(contentRoot, 'skills', 's1', 'SKILL.md'), 'body');
    writeFileSync(path.join(contentRoot, '.mcp.json'), '{ not valid json ]');
    assert.throws(() => buildManifest({ rootDir: root }), /invalid JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadResources returns null for an unsupported manifest schemaVersion', async () => {
  const v2 = {
    schemaVersion: 2,
    repoContentPrefix: 'plugins/weegloo',
    mcp: {},
    skills: [{ id: 'a', files: { 'SKILL.md': 'x' } }],
    rules: [],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(v2), { status: 200 })
      : new Response('not found', { status: 404 });
  try {
    assert.equal(await loadResources('latest'), null); // v2 rejected -> no usable manifest
  } finally {
    globalThis.fetch = realFetch;
  }
});

function stubManifest(manifest) {
  globalThis.fetch = async (url) =>
    String(url).includes('installer-manifest.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response('x', { status: 404 });
}

test('loadResources returns null for a malformed entry (strict — no silent drop)', async () => {
  const realFetch = globalThis.fetch;
  stubManifest({
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: { weeglooUrl: 'https://ai.weegloo.com/mcp', uploadApiUrl: 'https://upload.weegloo.com/v1' },
    skills: [
      { id: 'good', files: { 'SKILL.md': 'x' } },
      { id: 'bad', files: { 'SKILL.md': 123 } }, // non-string content → reject whole manifest
    ],
    rules: [{ id: 'r1', content: 'body' }],
  });
  try {
    assert.equal(await loadResources('latest'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loadResources returns null when mcp URLs are missing (defaults belong to the producer)', async () => {
  const realFetch = globalThis.fetch;
  stubManifest({
    schemaVersion: 1,
    repoContentPrefix: 'plugins/weegloo',
    mcp: {}, // no weeglooUrl/uploadApiUrl → reject (no consumer-side default)
    skills: [{ id: 'a', files: { 'SKILL.md': 'x' } }],
    rules: [{ id: 'r', content: 'body' }],
  });
  try {
    assert.equal(await loadResources('latest'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── Nested skill files (spine + references/) ────────────────────────────────────────────
//
// The manifest builder used to list a skill directory NON-recursively, so a `references/`
// subdirectory was dropped with no warning: byte-identical manifest, green CI, and an
// install whose SKILL.md pointed at files that were never written to disk. These tests are
// the tripwire — without them a regression to a flat walk passes everything else.

test('buildManifest walks skill subdirectories and emits slash-joined keys', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-nested-'));
  try {
    const skillDir = path.join(root, 'plugins', 'weegloo', 'skills', 'demo');
    mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'spine');
    writeFileSync(path.join(skillDir, 'references', 'deep.md'), 'page');
    writeFileSync(path.join(skillDir, 'references', 'other.md'), 'page2');

    const manifest = buildManifest({ rootDir: root });
    const files = manifest.skills.find((s) => s.id === 'demo').files;

    assert.deepEqual(Object.keys(files).sort(), ['SKILL.md', 'references/deep.md', 'references/other.md']);
    assert.equal(files['references/deep.md'], 'page');
    // Keys must be POSIX even when built on Windows, or a Windows-built manifest installs
    // to different paths than a CI-built one.
    const BACKSLASH = String.fromCharCode(92);
    assert.ok(!Object.keys(files).some((k) => k.includes(BACKSLASH)), 'keys must not contain backslashes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildManifest normalizes CRLF so output does not depend on the checkout platform', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-crlf-'));
  try {
    const skillDir = path.join(root, 'plugins', 'weegloo', 'skills', 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'line one\r\nline two\r\n');

    const files = buildManifest({ rootDir: root }).skills[0].files;
    assert.equal(files['SKILL.md'], 'line one\nline two\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildManifest rejects a skill file key that is not a safe relative path', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-unsafe-'));
  try {
    const skillDir = path.join(root, 'plugins', 'weegloo', 'skills', 'demo');
    // A directory literally named `..` cannot be created, so the build-time guard is
    // exercised through a segment the pattern rejects for the same reason: it is not a
    // plain name + optional extension.
    mkdirSync(path.join(skillDir, 'refs dir'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'spine');
    writeFileSync(path.join(skillDir, 'refs dir', 'page.md'), 'page');
    assert.throws(() => buildManifest({ rootDir: root }), /not a safe relative path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Country tags (`country:` frontmatter → structured `country` field) ──────────────────
//
// The builder is the ONLY place a tag is parsed: it validates the line, strips it from the
// embedded body and records `{include}` / `{exclude}` on the entry. The installer filters on
// that field alone, so a tag the builder misreads — or silently ignores — installs a file in
// the wrong countries with no error anywhere. Grammar details live in country.test.js; these
// tests pin what the BUILD does with a tag.

/**
 * A throwaway repo root. `skills` maps an id to `{ '<relative key>': text }`, `rules` maps an id
 * to its `.mdc` text. Runs `fn(root)` and always removes the directory.
 */
function withCorpus({ skills = {}, rules = {} }, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'weegloo-country-'));
  try {
    const contentRoot = path.join(root, 'plugins', 'weegloo');
    for (const [id, files] of Object.entries(skills)) {
      for (const [key, text] of Object.entries(files)) {
        const full = path.join(contentRoot, 'skills', id, ...key.split('/'));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, text);
      }
    }
    mkdirSync(path.join(contentRoot, 'rules'), { recursive: true });
    for (const [id, text] of Object.entries(rules)) {
      writeFileSync(path.join(contentRoot, 'rules', `${id}.mdc`), text);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A SKILL.md whose frontmatter carries `tagLine` (or nothing) between name and description. */
const skillMd = (tagLine) =>
  ['---', 'name: demo', ...(tagLine ? [tagLine] : []), 'description: Demo skill.', '---', '', '# Demo', ''].join('\n');

/** A rule whose frontmatter carries `tagLine` (or nothing). */
const ruleMdc = (tagLine) =>
  ['---', 'id: r', ...(tagLine ? [tagLine] : []), 'type: rule', '---', '', 'rules: []', ''].join('\n');

test('buildManifest turns a SKILL.md country tag into a field and strips only that line', () => {
  const tagged = [
    '---',
    'name: demo',
    'country: KR',
    'description: Demo skill.',
    '---',
    '',
    // Body text is prose, even at column 0 — only the frontmatter block is read.
    'country: US appears in the body and must stay.',
    '',
  ].join('\n');
  withCorpus(
    { skills: { demo: { 'SKILL.md': tagged, 'references/page.md': '# Page\n', 'metadata.json': '{}' } } },
    (root) => {
      const skill = buildManifest({ rootDir: root }).skills[0];
      assert.deepEqual(skill.country, { include: ['KR'] });
      // Key order is part of the byte-identical-manifest contract.
      assert.deepEqual(Object.keys(skill), ['id', 'country', 'files']);
      assert.equal(
        skill.files['SKILL.md'],
        ['---', 'name: demo', 'description: Demo skill.', '---', '', 'country: US appears in the body and must stay.', ''].join('\n')
      );
      assert.equal(skill.files['references/page.md'], '# Page\n');
      assert.equal(skill.files['metadata.json'], '{}');
    }
  );
});

test('buildManifest reads a country tag from a CRLF checkout (Windows working tree)', () => {
  withCorpus({ skills: { demo: { 'SKILL.md': skillMd('country: KR').replace(/\n/g, '\r\n') } } }, (root) => {
    const skill = buildManifest({ rootDir: root }).skills[0];
    assert.deepEqual(skill.country, { include: ['KR'] });
    assert.equal(skill.files['SKILL.md'], skillMd());
  });
});

test('buildManifest records an excluding rule tag and strips it from the embedded content', () => {
  withCorpus({ rules: { 'weegloo-demo': ruleMdc('country: -KR') } }, (root) => {
    const rule = buildManifest({ rootDir: root }).rules[0];
    assert.deepEqual(rule.country, { exclude: ['KR'] });
    assert.deepEqual(Object.keys(rule), ['id', 'country', 'content']);
    assert.equal(rule.content, ruleMdc());
  });
});

test('buildManifest sorts the codes of a tag', () => {
  withCorpus(
    { skills: { demo: { 'SKILL.md': skillMd('country: US, KR') } }, rules: { r: ruleMdc('country: -US, -KR') } },
    (root) => {
      const manifest = buildManifest({ rootDir: root });
      assert.deepEqual(manifest.skills[0].country, { include: ['KR', 'US'] });
      assert.deepEqual(manifest.rules[0].country, { exclude: ['KR', 'US'] });
    }
  );
});

test('buildManifest treats a quoted "*" or an empty value exactly like no tag: no field, line stripped, same bytes', () => {
  const build = (tagLine) =>
    withCorpus({ skills: { demo: { 'SKILL.md': skillMd(tagLine) } }, rules: { r: ruleMdc(tagLine) } }, (root) =>
      buildManifest({ rootDir: root })
    );
  const untagged = serializeManifest(build(null));
  for (const tagLine of ['country: "*"', 'country:', 'country: ""']) {
    const all = build(tagLine);
    assert.ok(!('country' in all.skills[0]), `${tagLine}: no country field on the skill`);
    assert.ok(!('country' in all.rules[0]), `${tagLine}: no country field on the rule`);
    assert.equal(all.skills[0].files['SKILL.md'], skillMd());
    assert.equal(all.rules[0].content, ruleMdc());
    // Byte-identical to the untagged corpus — the whole point of omitting the field.
    assert.equal(serializeManifest(all), untagged, tagLine);
  }
});

test('buildManifest refuses a bare * (invalid YAML: * is an alias)', () => {
  withCorpus({ skills: { demo: { 'SKILL.md': skillMd('country: *') } } }, (root) => {
    assert.throws(() => buildManifest({ rootDir: root }), /skill 'demo'.*bare \*/);
  });
  withCorpus({ rules: { r: ruleMdc('country: *') } }, (root) => {
    assert.throws(() => buildManifest({ rootDir: root }), /rule 'r'.*bare \*/);
  });
});

test('buildManifest refuses the old bracketed spelling (one spelling of a tag in the corpus)', () => {
  withCorpus({ skills: { demo: { 'SKILL.md': skillMd('country: [KR, US]') } } }, (root) => {
    assert.throws(() => buildManifest({ rootDir: root }), /skill 'demo'.*without brackets — country: KR, US/);
  });
});

test('buildManifest refuses to country-restrict a core (force-installed) rule', () => {
  for (const id of ['weegloo-version', 'weegloo-terms-consent']) {
    for (const tag of ['country: KR', 'country: -KR']) {
      withCorpus({ rules: { [id]: ruleMdc(tag) } }, (root) => {
        assert.throws(
          () => buildManifest({ rootDir: root }),
          new RegExp(`core rule '${id}' is force-installed and cannot be country-restricted`)
        );
      });
    }
    // "*" restricts nothing, so it is not a promise the installer breaks: allowed, and stripped.
    withCorpus({ rules: { [id]: ruleMdc('country: "*"') } }, (root) => {
      const rule = buildManifest({ rootDir: root }).rules[0];
      assert.ok(!('country' in rule));
      assert.equal(rule.content, ruleMdc());
    });
  }
});

test('buildManifest refuses a look-alike country key instead of ignoring it', () => {
  for (const line of ['Country: KR', 'countries: KR', '  country: KR']) {
    withCorpus({ skills: { demo: { 'SKILL.md': skillMd(line) } } }, (root) => {
      assert.throws(() => buildManifest({ rootDir: root }), /skill 'demo'.*looks like a country tag/, line);
    });
    withCorpus({ rules: { r: ruleMdc(line) } }, (root) => {
      assert.throws(() => buildManifest({ rootDir: root }), /rule 'r'.*looks like a country tag/, line);
    });
  }
});

test('buildManifest refuses a country tag outside SKILL.md (it would never be read)', () => {
  const page = (tagLine) => ['---', tagLine, '---', '', '# Page', ''].join('\n');
  // A valid tag, a no-op "*", and a broken one: all three are in the wrong file.
  for (const tagLine of ['country: KR', 'country: "*"', 'country: [KR]']) {
    withCorpus({ skills: { demo: { 'SKILL.md': skillMd(), 'references/x.md': page(tagLine) } } }, (root) => {
      assert.throws(
        () => buildManifest({ rootDir: root }),
        /skill 'demo' file 'references\/x\.md': 'country:' belongs in SKILL\.md frontmatter/,
        tagLine
      );
    });
  }
  // A `country:` line in a reference page's BODY is prose, as it is in SKILL.md.
  withCorpus(
    { skills: { demo: { 'SKILL.md': skillMd(), 'references/x.md': '# Page\n\ncountry: KR is prose\n' } } },
    (root) => {
      const skill = buildManifest({ rootDir: root }).skills[0];
      assert.ok(!('country' in skill));
      assert.equal(skill.files['references/x.md'], '# Page\n\ncountry: KR is prose\n');
    }
  );
});

test('buildManifest still refuses an empty rule', () => {
  withCorpus({ rules: { r: '' } }, (root) => {
    assert.throws(() => buildManifest({ rootDir: root }), /rule 'r' is empty/);
  });
});

test('changing only a country tag moves manifest.version', () => {
  const version = (tagLine) =>
    withCorpus({ skills: { demo: { 'SKILL.md': skillMd(tagLine) } } }, (root) => buildManifest({ rootDir: root }).version);
  const untagged = version(null);
  const kr = version('country: KR');
  const us = version('country: US');
  const notKr = version('country: -KR');
  assert.equal(new Set([untagged, kr, us, notKr]).size, 4, 'every distinct tag is a distinct version');
  assert.equal(version('country: KR'), kr, 'and the same tag is the same version');
});

test('countryReport is silent for an untagged corpus and flags a reference into a restricted entry', () => {
  withCorpus(
    { skills: { 'weegloo-demo': { 'SKILL.md': skillMd() } }, rules: { r: ruleMdc() } },
    (root) => assert.deepEqual(countryReport(buildManifest({ rootDir: root })), [])
  );
  withCorpus(
    {
      skills: { 'weegloo-kr-only': { 'SKILL.md': skillMd('country: KR') } },
      // Untagged (every country), yet routes to a skill that exists only in KR.
      rules: { 'weegloo-router': `${ruleMdc()}See weegloo-kr-only for postcodes.\n` },
    },
    (root) => {
      const lines = countryReport(buildManifest({ rootDir: root }));
      assert.equal(lines[0], 'country-restricted: 1 skill(s), 0 rule(s)');
      assert.match(lines[1], /^WARNING: 1 reference/);
      assert.equal(
        lines[2],
        '  rule weegloo-router names skill weegloo-kr-only, but is installed where skill weegloo-kr-only is not (* ⊄ KR)'
      );
      assert.match(lines[3], /actionable without its target.*§1\.3-4/);
      assert.equal(lines.length, 4);
    }
  );
});

test('the real repo build embeds no country: line in any SKILL.md or rule frontmatter', () => {
  const manifest = buildManifest({ rootDir: REPO_ROOT });
  const bodies = [
    ...manifest.skills.map((s) => [`skill '${s.id}'`, s.files['SKILL.md']]),
    ...manifest.rules.map((r) => [`rule '${r.id}'`, r.content]),
  ];
  for (const [label, body] of bodies) {
    const found = extractCountryTag(body, label);
    // `text` unchanged means no `country:` line at all — stricter than `country === null`,
    // which a leftover `"*"` line would also satisfy.
    assert.equal(found.country, null, `${label}: embedded body still parses as tagged`);
    assert.equal(found.text, body, `${label}: embedded body still carries a country: line`);
  }
});
