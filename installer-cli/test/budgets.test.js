import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES_DIR = path.join(REPO_ROOT, 'plugins', 'weegloo', 'rules');
const SKILLS_DIR = path.join(REPO_ROOT, 'plugins', 'weegloo', 'skills');
const INVENTORY = path.join(REPO_ROOT, 'plugins', 'weegloo', 'GATE-INVENTORY.md');

/** LF-normalized UTF-8 bytes — the working tree is CRLF on Windows and LF in CI. */
const bytes = (p) => Buffer.byteLength(readFileSync(p, 'utf-8').replace(/\r\n/g, '\n'), 'utf-8');
const read = (p) => readFileSync(p, 'utf-8').replace(/\r\n/g, '\n');

/**
 * Per-file byte caps for the always-loaded rules.
 *
 * These are per FILE and deliberately not a single total. A total lets one file grow into another
 * file's headroom, which is exactly how weegloo-global-rules reached 44 KB and how the router skill
 * reached 54 KB while calling itself a router. A cap that only bites in aggregate never bites.
 *
 * Raising a number here is allowed — it is a decision, and it should appear in a diff as one.
 *
 * These six are the Phase 4 compression result plus ~4% headroom, NOT the Phase 4 plan. The plan
 * projected 14,000 / 22,000 / 4,500 / 3,400 / 3,400 / 3,100; the compression came in above four of
 * those because reaching them meant demoting a sentence from GATE-INVENTORY, which is a defect and
 * a missed target is not. The plan's numbers were an estimate made before anything was classified;
 * these are measured. Do not re-lower them without deleting a gate on purpose.
 */
const RULE_CAPS = {
  'weegloo-api-endpoints': 16_900,
  'weegloo-global-rules': 27_300,
  'weegloo-minimal-load': 6_300,
  'weegloo-version': 3_600,
  'weegloo-resource-deletion': 4_100,
  'weegloo-media-lifecycle': 3_000,
  // Deliberately untouched by the compression pass: near-100% silent-failure content.
  'weegloo-terms-consent': 6_800,
  'weegloo-web-hosting-rules': 3_300,
  'weegloo-default-locale': 3_200,
};

/** Every session pays for these whether or not the skill is used. */
const DESCRIPTION_CAP = 700;

function descriptionOf(skillMd) {
  const fm = read(skillMd).match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^description:\s*([\s\S]*?)(?=\n[A-Za-z_-]+:|$)/m);
  return m ? m[1].trim() : null;
}

test('every rule file stays under its own byte cap', () => {
  const over = [];
  for (const [id, cap] of Object.entries(RULE_CAPS)) {
    const p = path.join(RULES_DIR, `${id}.mdc`);
    if (!existsSync(p)) continue; // a rule may legitimately not exist on a branch
    const n = bytes(p);
    if (n > cap) over.push(`${id}: ${n} B > ${cap} B`);
  }
  assert.deepEqual(over, [], `rule file(s) over cap:\n  ${over.join('\n  ')}`);
});

test('no rule file is missing from the cap table', () => {
  const onDisk = readdirSync(RULES_DIR).filter((f) => f.endsWith('.mdc')).map((f) => f.replace(/\.mdc$/, ''));
  const uncapped = onDisk.filter((id) => !(id in RULE_CAPS));
  // A new rule with no cap would be free to grow without limit, which defeats the whole table.
  assert.deepEqual(uncapped, [], `rule(s) with no byte cap: ${uncapped.join(', ')}`);
});

test('every skill description stays under the cap', () => {
  const over = [];
  for (const id of readdirSync(SKILLS_DIR)) {
    const p = path.join(SKILLS_DIR, id, 'SKILL.md');
    if (!existsSync(p)) continue;
    const desc = descriptionOf(p);
    assert.ok(desc, `${id}: SKILL.md has no frontmatter description`);
    const n = Buffer.byteLength(desc, 'utf-8');
    if (n > DESCRIPTION_CAP) over.push(`${id}: ${n} B > ${DESCRIPTION_CAP} B`);
  }
  assert.deepEqual(over, [], `description(s) over cap:\n  ${over.join('\n  ')}`);
});

/**
 * GATE-INVENTORY.md enumerates the sentences that must remain in the always-loaded rules — the
 * ones whose absence produces a plausible-but-wrong answer instead of an error.
 *
 * Bytes cannot tell "we deleted a duplicate" from "we deleted a gate"; both satisfy a cap equally.
 * This test is the difference. A compression PR is acceptable when every line of the inventory is
 * still found, verbatim, in the file that owns it.
 *
 * Format (parsed below): `## <rule-id>` headings, then list items whose gate fragment is the first
 * backtick-quoted span on the line.
 */
/** Drops markdown emphasis/code delimiters and collapses whitespace, so only the words compare. */
const normalize = (s) => s.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

function parseInventory(md) {
  const out = [];
  let current = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+([a-z0-9-]+)\s*$/i);
    if (h) { current = h[1]; continue; }
    if (!current) continue;
    const item = line.match(/^\s*[-*]\s+`([^`]+)`/);
    if (item) out.push({ rule: current, fragment: item[1] });
  }
  return out;
}

test('every GATE-INVENTORY sentence is still present in its rule', { skip: !existsSync(INVENTORY) }, () => {
  const entries = parseInventory(read(INVENTORY));
  assert.ok(entries.length > 0, 'GATE-INVENTORY.md parsed to zero entries — check the heading/list format');

  const cache = new Map();
  const missing = [];
  for (const { rule, fragment } of entries) {
    const p = path.join(RULES_DIR, `${rule}.mdc`);
    if (!existsSync(p)) { missing.push(`${rule}: rule file does not exist (gate: ${fragment})`); continue; }
    if (!cache.has(rule)) cache.set(rule, read(p));
    // Markdown emphasis and whitespace are normalized away on BOTH sides: a gate that gets
    // re-bolded or reflowed has not been lost, and treating that as a loss would train people to
    // ignore this test. The words themselves must still match.
    if (!cache.has(`${rule}:norm`)) cache.set(`${rule}:norm`, normalize(cache.get(rule)));
    if (!cache.get(`${rule}:norm`).includes(normalize(fragment))) missing.push(`${rule}: ${fragment}`);
  }
  assert.deepEqual(missing, [], `gate sentence(s) missing from the always-loaded rules:\n  ${missing.join('\n  ')}`);
});
