/**
 * Plugin-version picker policy: version-string semantics + ordering/selection.
 *
 * Pure logic (no network / no IO) so the picker's "what shows, in what order" rule
 * lives in ONE place instead of being smeared across github.js and index.js.
 */

/** Literal MAJOR.MINOR.PATCH only — matches the repo's release branches (no `v`, no prerelease/build). */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Whether a branch name is a selectable plugin version (strict semver). */
export function isSemverBranch(name) {
  return SEMVER.test(name);
}

/** Parses a leading dotted version ("v1.0.12" → [1,0,12]); null if not version-like. */
function parseVersion(s) {
  const m = String(s).replace(/^v/, '').match(/^(\d+(?:\.\d+)*)/);
  if (!m) return null;
  return m[1].split('.').map(Number);
}

/** Orders two version-ish strings newest-first; ties fall back to locale order. */
function compareVersion(a, b) {
  const aVer = parseVersion(a);
  const bVer = parseVersion(b);
  for (let i = 0; i < Math.max(aVer?.length ?? 0, bVer?.length ?? 0); i++) {
    const x = aVer?.[i] ?? 0;
    const y = bVer?.[i] ?? 0;
    if (x !== y) return y - x;
  }
  return String(a).localeCompare(String(b));
}

/**
 * Sorts the strict-semver branches newest-first, capped at `limit`. This is the only
 * version-ordering responsibility — it knows nothing about latest/develop layout.
 *
 * @param {string[]} branches
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function sortVersionBranches(branches, { limit = 5 } = {}) {
  return branches.filter(isSemverBranch).sort(compareVersion).slice(0, limit);
}

/** Recommended default — pinned to the top of the picker (only if the branch exists). */
const PINNED_TOP = 'latest';
/** Internal mainline — shown only with `-a`, pinned to the very bottom (only if it exists). */
const INTERNAL_BRANCH = 'develop';

/**
 * Lays out the version picker (composition only — version sorting is sortVersionBranches' job):
 *   default      : `latest` → newest `limit` semver versions.
 *   showAll (-a) : `latest` → versions → other branches (alpha) → `develop`, last.
 * Pinned branches appear only when they actually exist in `branches`.
 *
 * @param {string[]} branches  all branch names from the repo
 * @param {{ limit?: number, showAll?: boolean }} [opts]
 * @returns {string[]}
 */
export function orderBranchesForPicker(branches, { limit = 5, showAll = false } = {}) {
  const has = (name) => branches.includes(name);
  const top = has(PINNED_TOP) ? [PINNED_TOP] : [];
  const versions = sortVersionBranches(branches, { limit });
  if (!showAll) return [...top, ...versions];
  const others = branches
    .filter((b) => b !== PINNED_TOP && b !== INTERNAL_BRANCH && !isSemverBranch(b))
    .sort((a, b) => a.localeCompare(b));
  const bottom = has(INTERNAL_BRANCH) ? [INTERNAL_BRANCH] : [];
  return [...top, ...versions, ...others, ...bottom];
}
