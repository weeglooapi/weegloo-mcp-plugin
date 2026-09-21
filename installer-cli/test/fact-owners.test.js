/**
 * Enforces `plugins/weegloo/FACT-OWNERS.md`.
 *
 * GATE-INVENTORY asks "is this sentence still present?". It cannot ask "do the places that state
 * this fact agree?" — and drift raises no error: both copies parse, both read plausibly, and the
 * agent obeys whichever it loaded. Three such defects reached the corpus; the newest survived
 * until a behavioral fixture failed on it.
 *
 * Three independent checks, each with a different reach (the table in FACT-OWNERS.md states what
 * each one cannot do — none of them compares two statements for agreement, which only reading both
 * can do):
 *   canary     — a distinctive wording must appear EXACTLY once across the corpus
 *   mentions   — the set of files matching the fact's keywords must equal the registered list
 *   forbidden  — a phrasing known to be wrong must appear NOWHERE, forever
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = path.join(REPO_ROOT, 'plugins', 'weegloo');
const OWNERS = path.join(CORPUS, 'FACT-OWNERS.md');

/** The two registry files describe the corpus; they are not part of it and must not self-match. */
const NOT_CORPUS = new Set(['FACT-OWNERS.md', 'GATE-INVENTORY.md']);

function corpusFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdc)$/.test(e.name) && !NOT_CORPUS.has(e.name)) out.push(p);
    }
  })(CORPUS);
  return out.map((p) => ({ rel: path.relative(CORPUS, p).split(path.sep).join('/'), text: readFileSync(p, 'utf-8') }));
}

/**
 * Parses the `### id` blocks. Deliberately strict: an unparsed field is a row that silently
 * enforces nothing, which is the failure mode this whole file exists to prevent.
 */
function parseOwners(md) {
  const facts = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const id = lines[0].trim();
    // Plain string matching, not a regex: the field names are literals, and building a regex
    // around '**' needs escaping that does not survive every way this file gets written.
    const field = (name) => {
      const prefix = `- **${name}**: `;
      const hit = lines.find((l) => l.startsWith(prefix));
      return hit ? hit.slice(prefix.length).trim() : null;
    };
    const backticked = (name) => {
      const raw = field(name);
      if (!raw) return null;
      const m = raw.match(/^`(.+?)`(?:\s+—\s+(.*))?$/s);
      assert.ok(m, `${id}: '${name}' must start with a backticked value, got: ${raw}`);
      return { value: m[1], note: m[2] || '' };
    };
    const mentionsLine = field('mentions');
    let mentionFiles = null;
    if (mentionsLine) {
      const start = block.indexOf(mentionsLine) + mentionsLine.length;
      mentionFiles = [...block.slice(start).matchAll(/^\s+- `([^`]+)`$/gm)].map((m) => m[1]);
    }
    facts.push({
      id,
      owner: backticked('owner')?.value ?? null,
      canary: backticked('canary')?.value ?? null,
      mentions: mentionsLine ? mentionsLine.replace(/^`|`$/g, '') : null,
      mentionFiles,
      forbidden: backticked('forbidden'),
    });
  }
  return facts;
}

const skip = !existsSync(OWNERS);
const facts = skip ? [] : parseOwners(readFileSync(OWNERS, 'utf-8'));
const files = skip ? [] : corpusFiles();

test('FACT-OWNERS.md parses to at least one fact with an existing owner', { skip }, () => {
  assert.ok(facts.length > 0, 'parsed zero facts — check the `### id` / `- **field**:` format');
  for (const f of facts) {
    assert.ok(f.owner, `${f.id}: missing '- **owner**: \`path\`'`);
    assert.ok(files.some((x) => x.rel === f.owner), `${f.id}: owner not found in the corpus: ${f.owner}`);
  }
});

test('every canary phrase appears exactly once in the corpus', { skip }, () => {
  for (const f of facts.filter((x) => x.canary)) {
    // Substring, not regex: a canary is a literal wording, and `grep -F` is the contract.
    const hits = files.flatMap((x) => (x.text.includes(f.canary) ? [x.rel] : []));
    assert.equal(hits.length, 1,
      `${f.id}: canary must appear in exactly 1 file, found ${hits.length} [${hits.join(', ')}]\n  canary: ${f.canary}`);
    assert.equal(hits[0], f.owner, `${f.id}: canary lives in ${hits[0]}, but the owner is ${f.owner}`);
  }
});

test('the files discussing a fact are exactly the registered ones', { skip }, () => {
  for (const f of facts.filter((x) => x.mentions)) {
    const re = new RegExp(f.mentions);
    const actual = files.filter((x) => re.test(x.text)).map((x) => x.rel).sort();
    const declared = [...f.mentionFiles].sort();
    const added = actual.filter((a) => !declared.includes(a));
    const gone = declared.filter((d) => !actual.includes(d));
    assert.deepEqual(actual, declared,
      `${f.id}: the set of files stating this fact changed.\n` +
      (added.length ? `  NEW, unregistered: ${added.join(', ')}\n    → read it against the owner (${f.owner}); if it agrees, register it here; if it disagrees, that is drift.\n` : '') +
      (gone.length ? `  no longer matches: ${gone.join(', ')}\n    → if the fact was moved or removed, update this row deliberately.\n` : ''));
  }
});

test('no phrasing known to be wrong has come back', { skip }, () => {
  for (const f of facts.filter((x) => x.forbidden)) {
    const re = new RegExp(f.forbidden.value, 'm');
    const hits = files.flatMap((x) => {
      const m = x.text.match(re);
      return m ? [`${x.rel}: ${JSON.stringify(m[0].slice(0, 80))}`] : [];
    });
    assert.deepEqual(hits, [],
      `${f.id}: a known-wrong phrasing is back.\n  ${f.forbidden.note}\n  found in:\n    ${hits.join('\n    ')}`);
  }
});
