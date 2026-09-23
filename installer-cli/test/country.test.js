import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COUNTRY_URL,
  normalizeCountryCode,
  countryCheckUrl,
  parseCountryTag,
  extractCountryTag,
  normalizeCountrySpec,
  countryAllows,
  filterResourcesByCountry,
  resolveCountry,
  describeCountrySpec,
  countrySubset,
  findCountryReferenceGaps,
} from '../src/country.js';

// ── the tag grammar ─────────────────────────────────────────────────────────

test('parseCountryTag: the documented forms', () => {
  assert.deepEqual(parseCountryTag('KR'), { include: ['KR'] });
  assert.deepEqual(parseCountryTag('KR, US, CA'), { include: ['CA', 'KR', 'US'] }, 'sorted = canonical');
  assert.deepEqual(parseCountryTag('KR,US'), { include: ['KR', 'US'] }, 'spaces after commas are optional');
  assert.deepEqual(parseCountryTag(' KR ,  US '), { include: ['KR', 'US'] });
  assert.deepEqual(parseCountryTag('-KR'), { exclude: ['KR'] });
  assert.deepEqual(parseCountryTag('-KR, -JP'), { exclude: ['JP', 'KR'] });
  assert.equal(parseCountryTag('"*"'), null, 'quoted * = every country');
  assert.equal(parseCountryTag("'*'"), null);
  assert.deepEqual(parseCountryTag('"KR, US"'), { include: ['KR', 'US'] }, 'a quoted value is the same string');
  assert.deepEqual(parseCountryTag('KR, US  # Kakao only'), { include: ['KR', 'US'] }, 'trailing YAML comment');
});

test('parseCountryTag: the key with no code at all means every country, like omitting it', () => {
  for (const empty of ['', '   ', '""', "''", '" "', '# decide later', '  # decide later', '""  # none']) {
    assert.equal(parseCountryTag(empty), null, `${JSON.stringify(empty)} = every country`);
  }
});

test('parseCountryTag: bare * is refused — it is invalid YAML and would drop the whole frontmatter', () => {
  assert.throws(() => parseCountryTag('*'), /bare \* is invalid YAML/);
});

test('parseCountryTag: the old bracketed spelling is refused with the plain form to write', () => {
  assert.throws(() => parseCountryTag('[KR, US]'), /without brackets — country: KR, US/);
  assert.throws(() => parseCountryTag('[-KR]'), /without brackets — country: -KR/);
  assert.throws(() => parseCountryTag('"[*]"'), /without brackets — country: "\*"/, 'never suggests a bare *');
  assert.throws(() => parseCountryTag('[]'), /without brackets/);
});

test('parseCountryTag: everything else fails loudly (no lenient mode)', () => {
  const bad = [
    ['*, KR', /cannot be combined/],
    ['"*, KR"', /cannot be combined/],
    ['kr', /use upper case/],
    ['KOR', /ISO 3166-1 alpha-2/],
    ['K1', /ISO 3166-1 alpha-2/],
    ['- KR', /no space after '-': write -KR/],
    ['KR US', /separate codes with commas/],
    ['KR, -US', /mixes included and excluded/],
    ['KR, KR', /twice/],
    ['-KR, -KR', /twice/],
    ['KR,', /ISO 3166-1 alpha-2/],
    ['KR,,US', /ISO 3166-1 alpha-2/],
  ];
  for (const [value, pattern] of bad) {
    assert.throws(() => parseCountryTag(value), pattern, `should reject ${JSON.stringify(value)}`);
  }
});

// ── finding the tag in a file ───────────────────────────────────────────────

test('extractCountryTag: parses the frontmatter line and removes exactly that line', () => {
  const src = '---\nname: weegloo-x\ndescription: does x\ncountry: KR, US\n---\n\n# Body\n';
  const { country, text } = extractCountryTag(src, "skill 'weegloo-x'");
  assert.deepEqual(country, { include: ['KR', 'US'] });
  assert.equal(text, '---\nname: weegloo-x\ndescription: does x\n---\n\n# Body\n');
});

test('extractCountryTag: a quoted "*" or an empty value is removed too (nothing restricted, nothing left behind)', () => {
  for (const line of ['country: "*"', 'country:', 'country: ', 'country: ""', 'country: # decide later']) {
    const { country, text } = extractCountryTag(`---\n${line}\nname: x\n---\nbody`, 'x');
    assert.equal(country, null, line);
    assert.equal(text, '---\nname: x\n---\nbody', line);
  }
  // Empty as the LAST frontmatter line (nothing follows it inside the block).
  assert.deepEqual(extractCountryTag('---\nname: x\ncountry:\n---\nbody', 'x'), { country: null, text: '---\nname: x\n---\nbody' });
});

test('extractCountryTag: no frontmatter / no tag → text unchanged, every country', () => {
  for (const src of ['plain body\ncountry: KR\n', '---\nname: x\n---\ncountry: KR in the body\n', '---\nunterminated\ncountry: KR\n']) {
    const r = extractCountryTag(src, 'x');
    assert.equal(r.country, null);
    assert.equal(r.text, src);
  }
});

test('extractCountryTag: look-alike keys throw instead of silently meaning "every country"', () => {
  const lookalikes = [
    '---\nname: x\nmetadata:\n  country: KR\n---\n', // indented under metadata
    '---\nCountry: KR\n---\n',
    '---\ncountries: KR\n---\n',
  ];
  for (const src of lookalikes) {
    assert.throws(() => extractCountryTag(src, "skill 'x'"), /looks like a country tag/, src);
  }
});

test('extractCountryTag: two country lines throw; a bad value names the file', () => {
  assert.throws(() => extractCountryTag('---\ncountry: KR\ncountry: US\n---\n', "rule 'r'"), /more than one/);
  assert.throws(() => extractCountryTag('---\ncountry: *\n---\n', "rule 'weegloo-r'"), /rule 'weegloo-r': .*invalid YAML/);
});

test('extractCountryTag: a value continued on the next line is refused, not read as "every country"', () => {
  // YAML readers see KR in each of these; the builder reads only the key's own line, where an
  // empty value now means every country — so each would install everywhere with no error.
  const continued = [
    '---\ncountry:\n  - KR\n---\n', // block list
    '---\ncountry:\n- KR\n---\n', // block list at column 0 (valid YAML)
    '---\ncountry:\n  KR, US\n---\n', // value on the next line
    '---\ncountry: KR,\n  US\n---\n', // wrapped value
    '---\ncountry:\n\n  - KR\n---\n', // after a blank line
  ];
  for (const src of continued) {
    assert.throws(() => extractCountryTag(src, "skill 'x'"), /skill 'x': the 'country:' value continues on the next line/, src);
  }
  // An indented comment or the next top-level key is not a continuation.
  assert.equal(extractCountryTag('---\ncountry:\n  # decide later\nname: x\n---\n', 'x').country, null);
  assert.deepEqual(extractCountryTag('---\ncountry: KR\nname: x\n---\n', 'x').country, { include: ['KR'] });
});

// ── manifest field validation ───────────────────────────────────────────────

test('normalizeCountrySpec: accepts only the builder output shape', () => {
  assert.deepEqual(normalizeCountrySpec({ include: ['KR'] }), { include: ['KR'] });
  assert.deepEqual(normalizeCountrySpec({ exclude: ['KR', 'US'] }), { exclude: ['KR', 'US'] });
  for (const bad of [
    null,
    'KR',
    ['KR'],
    {},
    { include: [] },
    { include: ['kr'] },
    { include: ['KR', 'KR'] },
    { include: ['KR'], exclude: ['US'] },
    { only: ['KR'] },
    { include: 'KR' },
    { include: [1] },
  ]) {
    assert.equal(normalizeCountrySpec(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

// ── deciding what installs ──────────────────────────────────────────────────

test('countryAllows: include / exclude / untagged / unknown country', () => {
  assert.equal(countryAllows({ include: ['KR'] }, 'KR'), true);
  assert.equal(countryAllows({ include: ['KR'] }, 'US'), false);
  assert.equal(countryAllows({ exclude: ['KR'] }, 'KR'), false);
  assert.equal(countryAllows({ exclude: ['KR'] }, 'US'), true);
  assert.equal(countryAllows(undefined, 'US'), true, 'untagged = every country');
  assert.equal(countryAllows({ include: ['KR'] }, null), true, 'unknown country = fail open');
});

const RESOURCES = {
  version: 'v1',
  mcp: { weeglooUrl: 'u', uploadApiUrl: 'v' },
  skills: [
    { id: 'weegloo-all', files: { 'SKILL.md': 'a' } },
    { id: 'weegloo-kr', country: { include: ['KR'] }, files: { 'SKILL.md': 'k' } },
    { id: 'weegloo-not-kr', country: { exclude: ['KR'] }, files: { 'SKILL.md': 'n' } },
  ],
  rules: [
    { id: 'weegloo-version', country: { include: ['KR'] }, content: 'v' }, // cannot happen via the builder
    { id: 'weegloo-r-us', country: { include: ['US'] }, content: 'r' },
    { id: 'weegloo-r-all', content: 'r' },
  ],
};

test('filterResourcesByCountry: drops what the country is not offered, keeps order, leaves the input alone', () => {
  const kr = filterResourcesByCountry(RESOURCES, 'KR', { exemptRuleIds: ['weegloo-version'] });
  assert.deepEqual(kr.resources.skills.map((s) => s.id), ['weegloo-all', 'weegloo-kr']);
  assert.deepEqual(kr.resources.rules.map((r) => r.id), ['weegloo-version', 'weegloo-r-all']);
  assert.deepEqual(kr.excludedSkills, ['weegloo-not-kr']);
  assert.deepEqual(kr.excludedRules, ['weegloo-r-us']);
  assert.equal(kr.resources.mcp, RESOURCES.mcp, 'mcp passes through');
  assert.equal(RESOURCES.skills.length, 3, 'input not mutated');

  const us = filterResourcesByCountry(RESOURCES, 'US', { exemptRuleIds: ['weegloo-version'] });
  assert.deepEqual(us.resources.skills.map((s) => s.id), ['weegloo-all', 'weegloo-not-kr']);
  assert.deepEqual(us.resources.rules.map((r) => r.id), ['weegloo-version', 'weegloo-r-us', 'weegloo-r-all'],
    'a core rule survives even a tag that excludes it');
});

test('filterResourcesByCountry: unknown country is a byte-identical passthrough', () => {
  const r = filterResourcesByCountry(RESOURCES, null);
  assert.equal(r.resources, RESOURCES);
  assert.deepEqual([r.excludedSkills, r.excludedRules], [[], []]);
});

// ── choosing the country ────────────────────────────────────────────────────

test('normalizeCountryCode: two letters, upper-cased; placeholders and junk are unknown', () => {
  assert.equal(normalizeCountryCode('KR'), 'KR');
  assert.equal(normalizeCountryCode(' kr '), 'KR');
  for (const junk of ['XX', 'ZZ', 'T1', 'KOR', '', null, undefined, 82, {}]) {
    assert.equal(normalizeCountryCode(junk), null, `should reject ${JSON.stringify(junk)}`);
  }
});

test('resolveCountry: flag > recorded > detected > unknown; detect is called only when needed', async () => {
  let calls = 0;
  const detect = async () => ((calls += 1), 'US');

  assert.deepEqual(await resolveCountry({ pinned: 'kr', recorded: 'JP', detect }), { country: 'KR', source: 'flag' });
  assert.deepEqual(await resolveCountry({ recorded: 'JP', detect }), { country: 'JP', source: 'recorded' });
  assert.equal(calls, 0, 'no lookup when an earlier source answered');
  assert.deepEqual(await resolveCountry({ detect }), { country: 'US', source: 'detected' });
  assert.equal(calls, 1);

  assert.deepEqual(await resolveCountry({ detect: async () => 'XX' }), { country: null, source: 'unknown' });
  assert.deepEqual(await resolveCountry({ detect: async () => { throw new Error('offline'); } }), { country: null, source: 'unknown' });
  assert.deepEqual(await resolveCountry({ recorded: 'garbage', detect: async () => null }), { country: null, source: 'unknown' });
});

test('countryCheckUrl: follows the ai origin mapping', () => {
  assert.equal(countryCheckUrl(null), COUNTRY_URL);
  if (COUNTRY_URL === 'https://ai.weegloo.com/v1/country') {
    assert.equal(countryCheckUrl({ ai: 'https://dev-ai.weegloo.com' }), 'https://dev-ai.weegloo.com/v1/country');
    assert.equal(countryCheckUrl({ cma: 'https://cma.acme.com' }), COUNTRY_URL, 'unrelated mapping leaves it alone');
  }
});

// ── reporting ───────────────────────────────────────────────────────────────

test('describeCountrySpec round-trips the author notation', () => {
  assert.equal(describeCountrySpec({ include: ['KR', 'US'] }), 'KR, US');
  assert.equal(describeCountrySpec({ exclude: ['KR', 'JP'] }), '-KR, -JP');
  assert.equal(describeCountrySpec(null), '*');
  for (const spec of [{ include: ['KR', 'US'] }, { exclude: ['JP', 'KR'] }]) {
    assert.deepEqual(parseCountryTag(describeCountrySpec(spec)), spec, 'what it prints is a valid tag');
  }
});

test('countrySubset: finite include sets vs co-finite exclude sets', () => {
  const inc = (...c) => ({ include: c });
  const exc = (...c) => ({ exclude: c });
  assert.equal(countrySubset(null, null), true);
  assert.equal(countrySubset(inc('KR'), null), true);
  assert.equal(countrySubset(null, inc('KR')), false);
  assert.equal(countrySubset(inc('KR'), inc('KR', 'US')), true);
  assert.equal(countrySubset(inc('KR', 'JP'), inc('KR')), false);
  assert.equal(countrySubset(inc('US'), exc('KR')), true);
  assert.equal(countrySubset(inc('KR'), exc('KR')), false);
  assert.equal(countrySubset(exc('KR'), inc('US')), false);
  assert.equal(countrySubset(exc('KR', 'JP'), exc('KR')), true);
  assert.equal(countrySubset(exc('KR'), exc('KR', 'JP')), false);
});

test('findCountryReferenceGaps: flags an entry that routes to a skill it outlives', () => {
  const gaps = findCountryReferenceGaps({
    skills: [
      { id: 'weegloo-router', files: { 'SKILL.md': 'address lookup → weegloo-address-search' } },
      { id: 'weegloo-address-search', country: { include: ['KR'] }, files: { 'SKILL.md': 'kakao' } },
      { id: 'weegloo-kr-only', country: { include: ['KR'] }, files: { 'SKILL.md': 'see weegloo-address-search' } },
      { id: 'weegloo-other', files: { 'SKILL.md': 'weegloo-address-search-v2 is a different id' } },
    ],
    rules: [{ id: 'weegloo-global-rules', content: 'use `weegloo-address-search` first' }],
  });
  assert.deepEqual(
    gaps.map((g) => `${g.from} → ${g.to} (${g.fromCountry} ⊄ ${g.toCountry})`),
    [
      'skill weegloo-router → skill weegloo-address-search (* ⊄ KR)',
      'rule weegloo-global-rules → skill weegloo-address-search (* ⊄ KR)',
    ],
    'a KR-only referrer is fine, and an id prefix is not a mention'
  );
});
