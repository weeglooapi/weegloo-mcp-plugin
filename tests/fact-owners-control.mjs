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
 * Every value must be a PINNED SHA — never `HEAD`, never a branch name. A branch follows the fix:
 * the defect disappears from under the control and every row reads INERT, which is the same silent
 * success this file exists to catch, one level up. That includes the integration branch — `develop`
 * looks immutable from here only until this work merges into it, so it is written as the sha it
 * resolves to today. The check below refuses anything that resolves to a branch tip.
 *
 * Pick the sha of a commit whose corpus still HOLDS the defect: `3809087` is develop's tip before
 * this branch, and `900812e` / `c6397c1` are commits on it from before the respective fix.
 */
const DEFECT_AT = {
  'teardown-order': '8bd9c85',
  'scheduler-version-header': '3809087',
  'put-is-full-replacement': 'c6397c1',
  'acma-patch-content-only': 'c6397c1',
  'locale-presence-scoped-by-required': 'c6397c1',
  'read-fallback-is-opt-in': 'c6397c1',
  'media-file-url-shape': 'c6397c1',
  'script-writes-default-bucket': 'c6397c1',
  // `da14b30` is this branch's tip before the `advanced` two-store rewrite: its corpus still
  // scopes the exception to a row the same execution wrote.
  'script-advanced-flag': 'da14b30',
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
  // A ref that moves resolves to the FIXED corpus once the fix lands, and the control then reports
  // INERT for a row that is perfectly sound. Refuse every non-sha up front rather than let it read
  // as a finding — including `develop`, which stops being immutable the moment this work merges.
  const heads = new Set(
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes')
      .toString().trim().split(/\r?\n/).filter(Boolean),
  );
  for (const [id, ref] of Object.entries(DEFECT_AT)) {
    const bare = ref.replace(/[\^~]\d*$/, '');
    if (ref === 'HEAD' || heads.has(bare)) {
      throw new Error(`DEFECT_AT['${id}'] = '${ref}' follows a branch — pin it to a sha`);
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
