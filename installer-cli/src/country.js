/**
 * Country filtering — which skills/rules get installed for the client's country.
 * Design: docs/country-filter.md.
 *
 * A skill (in its SKILL.md) or a rule (in its .mdc) may carry ONE top-level frontmatter line:
 *
 *   country: KR            only these countries        (also KR, US, CA)
 *   country: -KR           every country but these     (also -KR, -JP)
 *   country: "*"           every country — quoted; omitting the key means exactly the same,
 *   country:               and so does the key with no code at all (empty, `""`, or only a comment)
 *
 * The manifest builder parses and validates that line, REMOVES it from the embedded body and
 * records it as the entry's structured `country` field (`{ include: [...] }` | `{ exclude: [...] }`,
 * absent = every country). The installer never parses frontmatter: it reads that field and filters
 * the CATALOG right after the manifest loads — the same place `applyTermsExclusion` works — so the
 * picker, core forcing, the install record and update pruning all follow with no further
 * conditionals.
 *
 * Why a dedicated key and not a `[KR] ` prefix on `description`: an unquoted YAML value that starts
 * with `[` is a flow sequence, so `description: [KR] Wire …` fails to parse and the harness loses the
 * skill's name AND description — silently, with no error anywhere. The dedicated key's value is a
 * plain YAML string (`KR, US` parses as the string "KR, US"), so it needs no brackets. A bare `*`
 * does NOT parse (`*` is YAML's alias indicator), which is why the builder refuses it unquoted: the
 * source file is also read directly by the Claude / Cursor plugin marketplaces, where no builder runs.
 *
 * Unknown country (the lookup failed, or answered something that is not a country) means NO
 * filtering — every skill/rule installs, exactly as before this feature existed. A filter that
 * cannot know the country must never make an install worse than no filter at all.
 */
import { applyOriginMapping } from './origins.js';

/**
 * Where the installer asks for the client's country. Public, unauthenticated, plain JSON:
 * `{ "country": "KR" }`. It lives on the `ai` origin next to `/v1/version`, so an origins mapping
 * (`{ "ai": "https://dev-ai.weegloo.com" }`) moves it with the rest of the stack; WEEGLOO_COUNTRY_URL
 * overrides it outright for staging / tests.
 */
export const COUNTRY_URL = process.env.WEEGLOO_COUNTRY_URL || 'https://ai.weegloo.com/v1/country';

/** ISO 3166-1 alpha-2, upper case — the only spelling the corpus and the manifest use. */
const CODE = /^[A-Z]{2}$/;

/**
 * Codes a geo-IP answer uses for "I don't know" (Cloudflare's `XX`, the user-assigned `ZZ`).
 * Treating them as a real country would install only the `-…`-tagged and untagged items — a
 * filter applied to a location nobody is in.
 */
const UNKNOWN_CODES = new Set(['XX', 'ZZ']);

/**
 * Normalizes a country code from a lookup response or a `--country` flag: trimmed, upper-cased,
 * two ASCII letters, not an "unknown" placeholder. Anything else → null (unknown).
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeCountryCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) && !UNKNOWN_CODES.has(code) ? code : null;
}

/** The mapped lookup URL for this install's environment. */
export function countryCheckUrl(origins = null) {
  return applyOriginMapping(COUNTRY_URL, origins);
}

const byteCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Parses the VALUE of a `country:` frontmatter line. Throws a message the author can act on for
 * anything that is not exactly one of the documented forms — a tag that is silently misread
 * installs a skill in the wrong countries with no error anywhere, so there is no lenient mode.
 *
 * @param {string} rawValue  the text after `country:` on that line
 * @returns {null | { include: string[] } | { exclude: string[] }}  null = every country (also an empty value)
 */
export function parseCountryTag(rawValue) {
  const shown = JSON.stringify(String(rawValue ?? '').trim());
  let value = String(rawValue ?? '').trim();
  // A YAML comment: after the value (`country: KR  # Kakao only`) or instead of it (`country: # later`).
  value = value.replace(/(^|\s+)#.*$/, '');

  let quoted = false;
  const q = value.match(/^(["'])(.*)\1$/);
  if (q) {
    quoted = true;
    value = q[2].trim();
  }

  // No code at all — `country:`, `country: ""`, or only a comment — means every country, exactly
  // like omitting the key.
  if (value === '') return null;

  // The old bracketed spelling (`[KR, US]`) is valid YAML, so nothing else would catch it — refuse
  // it here so the corpus keeps ONE spelling of a tag.
  const bracketed = value.match(/^\[(.*)\]$/);
  if (bracketed) {
    const inner = bracketed[1].trim();
    const suggestion = inner === '*' ? '"*"' : inner || 'KR, US';
    throw new Error(`country tag ${shown}: write the codes without brackets — country: ${suggestion}`);
  }

  const items = value.split(',').map((s) => s.trim());

  if (items.includes('*')) {
    if (items.length > 1) {
      throw new Error(`country tag ${shown}: '*' (every country) cannot be combined with other codes`);
    }
    if (!quoted) {
      // `*` is YAML's alias indicator: every harness that parses this frontmatter (and the plugin
      // marketplaces, which read the source file directly) fails on it and drops the whole block.
      throw new Error(
        `country tag ${shown}: a bare * is invalid YAML ('*' is an alias) — write country: "*" or omit the key`
      );
    }
    return null;
  }

  for (const item of items) {
    if (!/^-?[A-Z]{2}$/.test(item)) {
      let hint = '';
      if (/^-?[A-Za-z]{2}$/.test(item)) hint = ' (use upper case)';
      // `- KR` is YAML's block-sequence indicator, not an exclusion — invalid on the key's line.
      else if (/^-\s+[A-Za-z]{2}$/.test(item)) hint = ` (no space after '-': write -${item.replace(/^-\s+/, '').toUpperCase()})`;
      else if (/^-?[A-Za-z]{2}(\s+-?[A-Za-z]{2})+$/.test(item)) hint = ' (separate codes with commas)';
      throw new Error(
        `country tag ${shown}: '${item}' is not an ISO 3166-1 alpha-2 code such as KR or -KR${hint}`
      );
    }
  }

  const negated = items.filter((i) => i.startsWith('-'));
  if (negated.length > 0 && negated.length < items.length) {
    throw new Error(
      `country tag ${shown} mixes included and excluded codes — use either KR, US (only these) or -KR, -US (all but these)`
    );
  }
  const codes = items.map((i) => i.replace(/^-/, ''));
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) throw new Error(`country tag ${shown} lists '${dup}' twice`);

  const sorted = [...codes].sort(byteCompare);
  return negated.length > 0 ? { exclude: sorted } : { include: sorted };
}

/** The exact top-level key, at column 0. */
const COUNTRY_LINE = /^country\s*:(.*)$/;
/** Anything that looks like an attempt at one — indented, capitalized, pluralized. */
const COUNTRY_LOOKALIKE = /^\s*countr(?:y|ies)\s*:/i;

/**
 * Finds the `country:` line in a file's frontmatter, parses it, and returns the body WITHOUT that
 * line. Only the frontmatter block counts (the first line is `---`, it ends at the next `---`
 * line); a `country:` line in the body is prose. `text` must already be LF-normalized.
 *
 * A look-alike line (`Country:`, `countries:`, or `country:` indented under `metadata:`) THROWS
 * instead of being ignored: ignoring it would install the file in every country while its author
 * believes it is restricted.
 *
 * @param {string} text
 * @param {string} label  names the file in error messages (e.g. `skill 'weegloo-foo'`)
 * @returns {{ country: null | { include: string[] } | { exclude: string[] }, text: string }}
 */
export function extractCountryTag(text, label) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { country: null, text };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { country: null, text };

  let found = -1;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (COUNTRY_LINE.test(line)) {
      if (found !== -1) throw new Error(`${label}: frontmatter has more than one 'country:' line`);
      found = i;
    } else if (COUNTRY_LOOKALIKE.test(line)) {
      throw new Error(
        `${label}: frontmatter line ${JSON.stringify(line)} looks like a country tag but is not the top-level 'country:' key`
      );
    }
  }
  if (found === -1) return { country: null, text };

  // Only this ONE line is read. A value that continues below it — a block list (`country:` then
  // `  - KR`) or a wrapped value (`  US`) — is what YAML readers see, while this line alone may be
  // empty, i.e. every country: the file would install everywhere with no error. Refuse it.
  let next = found + 1;
  while (next < end && lines[next].trim() === '') next++;
  if (next < end && /^(\s+[^\s#]|-(\s|$))/.test(lines[next])) {
    throw new Error(
      `${label}: the 'country:' value continues on the next line — write the codes on the same line, e.g. country: KR, US`
    );
  }

  let country;
  try {
    country = parseCountryTag(lines[found].match(COUNTRY_LINE)[1]);
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
  return { country, text: [...lines.slice(0, found), ...lines.slice(found + 1)].join('\n') };
}

/**
 * Validates a manifest entry's `country` field (the builder's output shape). Returns the value as a
 * fresh object, or null when it is malformed — the caller treats null as a corrupt manifest and
 * fails fast, like every other shape error in `normalizeManifest`. An ABSENT field is the caller's
 * business (it means every country) and never reaches here.
 *
 * @param {unknown} spec
 * @returns {{ include: string[] } | { exclude: string[] } | null}
 */
export function normalizeCountrySpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const keys = Object.keys(spec);
  if (keys.length !== 1 || (keys[0] !== 'include' && keys[0] !== 'exclude')) return null;
  const codes = spec[keys[0]];
  if (!Array.isArray(codes) || codes.length === 0) return null;
  if (!codes.every((c) => typeof c === 'string' && CODE.test(c))) return null;
  if (new Set(codes).size !== codes.length) return null;
  return { [keys[0]]: [...codes] };
}

/**
 * Whether an entry with `spec` is installed in `country`. No spec (every country) or no known
 * country (the fail-open case) → true.
 *
 * @param {{ include?: string[], exclude?: string[] } | null | undefined} spec
 * @param {string|null} country
 */
export function countryAllows(spec, country) {
  if (!spec || !country) return true;
  if (spec.include) return spec.include.includes(country);
  if (spec.exclude) return !spec.exclude.includes(country);
  return true;
}

/**
 * Drops the skills/rules not offered in `country` from the fetched resources — a new object, the
 * input untouched. `exemptRuleIds` are never dropped: the core rules (the update notifier and the
 * terms gate) are force-installed, and a country filter must not be a way to lose them. The
 * builder already refuses to tag them; this is the second lock.
 *
 * @param {{ skills: Array<{id:string, country?:object}>, rules: Array<{id:string, country?:object}> }} resources
 * @param {string|null} country
 * @param {{ exemptRuleIds?: string[] }} [opts]
 * @returns {{ resources: object, excludedSkills: string[], excludedRules: string[] }}
 */
export function filterResourcesByCountry(resources, country, { exemptRuleIds = [] } = {}) {
  if (!country) return { resources, excludedSkills: [], excludedRules: [] };
  const exempt = new Set(exemptRuleIds);
  const excludedSkills = [];
  const excludedRules = [];
  const skills = resources.skills.filter((s) => {
    const keep = countryAllows(s.country, country);
    if (!keep) excludedSkills.push(s.id);
    return keep;
  });
  const rules = resources.rules.filter((r) => {
    const keep = exempt.has(r.id) || countryAllows(r.country, country);
    if (!keep) excludedRules.push(r.id);
    return keep;
  });
  return { resources: { ...resources, skills, rules }, excludedSkills, excludedRules };
}

/**
 * Picks the country for a run. Precedence: a pinned value (`--country` / WEEGLOO_COUNTRY) > the
 * country this install recorded (update only — an update keeps the install's environment, like the
 * origins mapping) > a live lookup > unknown. `detect` is only called when nothing earlier
 * answered, so an update of an install that already knows its country makes no request.
 *
 * @param {{ pinned?: string|null, recorded?: string|null, detect: () => Promise<string|null> }} args
 * @returns {Promise<{ country: string|null, source: 'flag'|'recorded'|'detected'|'unknown' }>}
 */
export async function resolveCountry({ pinned = null, recorded = null, detect }) {
  const fromFlag = normalizeCountryCode(pinned);
  if (fromFlag) return { country: fromFlag, source: 'flag' };
  const fromRecord = normalizeCountryCode(recorded);
  if (fromRecord) return { country: fromRecord, source: 'recorded' };
  let detected = null;
  try {
    detected = normalizeCountryCode(await detect());
  } catch {
    detected = null;
  }
  return detected ? { country: detected, source: 'detected' } : { country: null, source: 'unknown' };
}

/** `{include:['KR','US']}` → `KR, US`, `{exclude:['KR']}` → `-KR`, none → `*` — the author notation. */
export function describeCountrySpec(spec) {
  if (spec?.include) return spec.include.join(', ');
  if (spec?.exclude) return spec.exclude.map((c) => `-${c}`).join(', ');
  return '*';
}

/**
 * Is every country in `a` also in `b`? null = every country. Include lists are finite sets and
 * exclude lists co-finite, which is all the case analysis needs.
 */
export function countrySubset(a, b) {
  if (!b) return true;
  if (!a) return false;
  if (a.include && b.include) return a.include.every((c) => b.include.includes(c));
  if (a.include && b.exclude) return a.include.every((c) => !b.exclude.includes(c));
  if (a.exclude && b.include) return false;
  return b.exclude.every((c) => a.exclude.includes(c));
}

/**
 * Cross-references a country filter can strand: an entry that NAMES a restricted skill/rule while
 * being installed in countries where that target is not. Deleting a whole skill for a country does
 * not delete the lines elsewhere that route to it — the router, `weegloo-global-rules` — so an agent
 * there is sent to a skill that is not on disk. That is survivable only if the pointing line is
 * actionable on its own (CLAUDE.md §1.3-4), which no test can judge — hence a report for the author,
 * not a build failure.
 *
 * Matching is by id with a host-style boundary. A skill and a rule can share an id
 * (`weegloo-default-locale`); a mention then counts against both, which over-reports but never
 * misses.
 *
 * @param {{ skills: Array<{id:string, country?:object, files:Record<string,string>}>, rules: Array<{id:string, country?:object, content:string}> }} manifest
 * @returns {Array<{ from: string, to: string, fromCountry: string, toCountry: string }>}
 */
export function findCountryReferenceGaps(manifest) {
  const entries = [
    ...manifest.skills.map((s) => ({ key: `skill ${s.id}`, id: s.id, country: s.country ?? null, text: Object.values(s.files).join('\n') })),
    ...manifest.rules.map((r) => ({ key: `rule ${r.id}`, id: r.id, country: r.country ?? null, text: r.content })),
  ];
  const gaps = [];
  for (const target of entries) {
    if (!target.country) continue;
    const escaped = target.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mention = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
    for (const from of entries) {
      if (from.key === target.key) continue;
      if (!mention.test(from.text)) continue;
      if (countrySubset(from.country, target.country)) continue;
      gaps.push({
        from: from.key,
        to: target.key,
        fromCountry: describeCountrySpec(from.country),
        toCountry: describeCountrySpec(target.country),
      });
    }
  }
  return gaps;
}
