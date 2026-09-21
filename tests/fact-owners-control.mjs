#!/usr/bin/env node
/**
 * "Does this `forbidden` pattern still REJECT the defect it was written for?"
 *
 * WHY THIS EXISTS
 * ---------------
 * `fact-owners.test.js` asserts that no forbidden phrasing is present. A pattern that matches
 * NOTHING passes that assertion perfectly, forever — a row that guards nothing scores exactly
 * like a row that was deleted, and the green CI reads the same either way. Byte checks cannot
 * see it; neither can the behavioral fixtures, which never look at this file.
 *
 * WHAT IT COST TO LEARN THIS
 * --------------------------
 * `scheduler-version-header` shipped with the pattern
 *   `x-weegloo-version[^.]{0,60}(any|every|all) resource`
 * while the sentence it was written against reads
 *   "When updating any resource, always include the `x-weegloo-version` header"
 * — the two halves in the opposite order. It never matched the defect, on any commit, and it sat
 * in a passing suite for two phases. It was only found by running it against the commit that
 * still held the defect, which is what this file does.
 *
 * HOW IT WORKS
 * ------------
 * Every row that carries a `forbidden` pattern must name, in DEFECT_AT, a git ref whose corpus
 * still contains the defect. The pattern must FIRE there and be SILENT in the working tree.
 * Failing either way is an error: silent-at-the-defect means the row is inert, and firing in the
 * working tree means the defect is back.
 *
 * NOT WIRED INTO CI: it builds throwaway worktrees, so it needs a full clone, not a shallow one.
 * Run it by hand whenever a row is added or a forbidden pattern is edited.
 *   node tests/fact-owners-control.mjs
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * row id -> a ref whose corpus STILL HOLDS the defect.
 *
 * Every value here must be IMMUTABLE — a pinned sha, or `develop` because this branch never
 * commits there. Never `HEAD` or a branch name that this work advances: the ref would follow the
 * fix, the defect would vanish from under the control, and all it would report is INERT. That is
 * the same silent-success this file exists to catch, one level up.
 *
 * `develop` is the integration baseline this branch departs from, so it is the right ref for a
 * defect this branch fixed in a commit of its own; a `<sha>` / `<sha>^` for one this branch both
 * introduced and fixed, or one fixed in a working tree whose last commit was that sha.
 */
const DEFECT_AT = {
  'teardown-order': '1971888^',
  'scheduler-version-header': 'develop',
  'put-is-full-replacement': 'c6397c1',
  'acma-patch-content-only': 'c6397c1',
  'locale-presence-scoped-by-required': 'c6397c1',
  'read-fallback-is-opt-in': 'c6397c1',
  'media-file-url-shape': 'c6397c1',
  'script-writes-default-bucket': 'c6397c1',
};

const NOT_CORPUS = new Set(['FACT-OWNERS.md', 'GATE-INVENTORY.md']);

function corpusOf(root) {
  const dir0 = path.join(root, 'plugins', 'weegloo');
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdc)$/.test(e.name) && !NOT_CORPUS.has(e.name)) out.push(p);
    }
  })(dir0);
  return out.map((p) => ({
    rel: path.relative(dir0, p).split(path.sep).join('/'),
    text: readFileSync(p, 'utf-8'),
  }));
}

/** Files in which the pattern appears — the same unit `fact-owners.test.js` reports. */
function hitFiles(files, src) {
  const re = new RegExp(src, 'm');
  return files.filter((f) => re.test(f.text)).map((f) => f.rel);
}

function forbiddenRows(md) {
  const bt = String.fromCharCode(96);
  const rows = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const id = lines[0].trim();
    const prefix = `- **forbidden**: `;
    const line = lines.find((l) => l.startsWith(prefix));
    if (!line) continue;
    const m = line.slice(prefix.length).trim().match(new RegExp(`^${bt}(.+?)${bt}`, 's'));
    if (!m) throw new Error(`${id}: forbidden value is not backticked`);
    rows.push({ id, src: m[1] });
  }
  return rows;
}

const rows = forbiddenRows(readFileSync(path.join(REPO, 'plugins/weegloo/FACT-OWNERS.md'), 'utf-8'));
const now = corpusOf(REPO);

// One worktree per distinct ref, reused across the rows that name it.
const refs = [...new Set(Object.values(DEFECT_AT))];
const base = path.join(os.tmpdir(), `fact-owners-control-${process.pid}`);
const worktrees = new Map();
const git = (...a) => execFileSync('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });

let failures = 0;
try {
  // A ref that moves with this work resolves to the FIXED corpus once the fix lands, and the
  // control then reports INERT for a row that is perfectly sound. Refuse it up front rather than
  // let it read as a finding.
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').toString().trim();
  for (const [id, ref] of Object.entries(DEFECT_AT)) {
    if (ref === 'HEAD' || ref.replace(/\^+$/, '') === branch) {
      throw new Error(`DEFECT_AT['${id}'] = '${ref}' moves with this branch — pin it to a sha`);
    }
  }

  for (const ref of refs) {
    const dir = path.join(base, ref.replace(/[^A-Za-z0-9]/g, '_'));
    git('worktree', 'add', '--detach', dir, ref);
    worktrees.set(ref, corpusOf(dir));
  }

  for (const r of rows) {
    const ref = DEFECT_AT[r.id];
    if (!ref) {
      console.log(`UNCONTROLLED  ${r.id} — add a ref to DEFECT_AT naming a corpus that holds the defect`);
      failures++;
      continue;
    }
    const before = hitFiles(worktrees.get(ref), r.src);
    const after = hitFiles(now, r.src);
    if (!before.length) {
      console.log(`INERT         ${r.id} — silent at ${ref}; the pattern does not match its own defect`);
      failures++;
    } else if (after.length) {
      console.log(`DEFECT BACK   ${r.id} — present in the working tree: ${after.join(', ')}`);
      failures++;
    } else {
      console.log(`FIRES         ${r.id} — ${before.length} file(s) at ${ref}, 0 now`);
    }
  }
} finally {
  for (const ref of worktrees.keys()) {
    const dir = path.join(base, ref.replace(/[^A-Za-z0-9]/g, '_'));
    try { git('worktree', 'remove', '--force', dir); } catch { /* best effort */ }
  }
  try { rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
}

const controlled = rows.filter((r) => DEFECT_AT[r.id]).length;
console.log(`\n${rows.length} forbidden row(s), ${controlled} controlled, ${failures} failing`);
process.exit(failures ? 1 : 0);
