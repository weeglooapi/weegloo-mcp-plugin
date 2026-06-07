/**
 * Plugin-version picker policy: version-string semantics + ordering/selection.
 *
 * Pure logic (no network / no IO) so the picker's "what shows, in what order" rule
 * lives in ONE place instead of being smeared across github.js and index.js.
 */

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
 * Orders branch names for the version picker:
 *   `latest` first → the newest `limit` version branches (desc) → other branches (alpha).
 *
 * @param {string[]} branches  distributable branch names (hidden refs already filtered upstream)
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function orderBranchesForPicker(branches, { limit = 5 } = {}) {
  const latestOnly = branches.filter((b) => b === 'latest');
  const versionBranches = branches
    .filter((b) => b !== 'latest' && parseVersion(b))
    .sort(compareVersion)
    .slice(0, limit);
  const rest = branches
    .filter((b) => b !== 'latest' && !parseVersion(b))
    .sort((a, b) => a.localeCompare(b));
  return [...latestOnly, ...versionBranches, ...rest];
}
