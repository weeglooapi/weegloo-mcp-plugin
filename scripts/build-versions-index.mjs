/**
 * Builds the cross-version index (`versions.json`) published to GitHub Pages.
 * The installer's version picker reads this ONE static file (Fastly CDN, no
 * api.github.com, no rate limit) to show `latest` + the most recent N versions.
 *
 * Input: the JSON array from
 *   gh release list --json tagName,createdAt,isLatest,isDraft,isPrerelease
 * Output (stdout): versions.json
 *   { "schemaVersion": 1, "latest": "v1.2.0",
 *     "versions": [ { "version": "v1.2.0", "date": "..." }, ... ] }
 *
 * Usage (CI):
 *   gh release list --json ... | node scripts/build-versions-index.mjs > public/versions.json
 */
import process from 'node:process';

/**
 * @param {Array<{tagName:string,createdAt:string,isLatest?:boolean,isDraft?:boolean,isPrerelease?:boolean}>} releases
 * @param {{ max?: number }} [opts]
 */
export function buildVersionsIndex(releases, { max = 50 } = {}) {
  const list = Array.isArray(releases) ? releases : [];
  const usable = list
    .filter((r) => r && r.tagName && !r.isDraft)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

  // Prefer GitHub's own "Latest" designation; else newest non-prerelease; else newest.
  const flagged = usable.find((r) => r.isLatest);
  const newestStable = usable.find((r) => !r.isPrerelease);
  const latest = (flagged || newestStable || usable[0])?.tagName ?? null;

  const versions = usable.slice(0, max).map((r) => ({
    version: r.tagName,
    date: r.createdAt,
    ...(r.isPrerelease ? { prerelease: true } : {}),
  }));

  return { schemaVersion: 1, latest, versions };
}

// Run as a CLI only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const max = Number(process.env.MAX_VERSIONS || 50);
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  let releases = [];
  try {
    releases = JSON.parse(raw || '[]');
  } catch {
    releases = [];
  }
  process.stdout.write(JSON.stringify(buildVersionsIndex(releases, { max }), null, 2) + '\n');
}
