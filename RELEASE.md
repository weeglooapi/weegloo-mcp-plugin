# Releasing the plugin bundle

Distribution follows the Helm `chart-releaser` pattern — content in GitHub
**Releases**, the version index on GitHub **Pages** — so none of the three
install-time touchpoints hits the rate-limited GitHub REST API, and none needs
a git client:

| Touchpoint | Source | Why it's safe |
| --- | --- | --- |
| **Version list** (latest + recent N) | `versions.json` on **GitHub Pages** | static file, our own contract, Fastly CDN, no `api.github.com` |
| **Skill/rule list** for a version | `releases/download/<tag>/manifest.json` | documented release-asset permalink, asset CDN |
| **File content** | `releases/download/<tag>/weegloo-bundle.zip` | one download, extracted in memory (fflate), no git |

> **How the CLI consumes a release (default path):**
> 1. **Picker** — `fetchVersionsIndex` reads `versions.json` from Pages → shows
>    `latest` (recommended) + the most recent versions. No `api.github.com`.
> 2. **Resolve** — the chosen version, or `versions.json.latest`, gives a
>    concrete tag (so the stale `releases/latest/download` CDN cache is avoided).
> 3. **List** — `fetchReleaseManifest` reads that tag's `manifest.json` asset.
> 4. **Install** — `prepareResourceSource` downloads that tag's
>    `weegloo-bundle.zip` once and extracts it in memory.
>
> Content versions are **decoupled from the CLI (npm) version**: editing skills
> and cutting a release does not require an npm publish, and `npx weegloo` keeps
> working regardless.
>
> **Fallbacks** (best-effort, never a hard dependency): Pages index unreachable
> → atom feed, then just `latest`; no release for a ref → Contents API + raw
> per-file (the pre-release path); `-a/--all-branches` → `branches` API
> (maintainer debug only, intentional).

## What gets published

On a `v*` tag, `release.yml` produces **two kinds of artifact from one run**:

**1. Per-version content → GitHub Release `<tag>`** (`scripts/build-bundle.mjs`
stages `plugins/weegloo/` into `dist/bundle/`, zipped to `weegloo-bundle.zip`):

| Release asset | Used for |
| --- | --- |
| `manifest.json` | the version's skill/rule list (one tiny fetch before the zip) |
| `weegloo-bundle.zip` | the actual files (`skills/<id>/...`, `rules/<id>.mdc`, `.mcp.json`) |

**2. Cross-version index → GitHub Pages** (`scripts/build-versions-index.mjs`
turns `gh release list` into `versions.json`, published to the `gh-pages`
branch):

```
{ "schemaVersion": 1, "latest": "v1.2.0",
  "versions": [ { "version": "v1.2.0", "date": "..." }, ... ] }
```

Served at `https://<owner>.github.io/<repo>/versions.json`. Regenerated from the
authoritative release list each publish, so it self-heals.

## Cutting a release

For a human, a release is essentially **"push a version tag"** — CI does the rest.

### Every time

1. **Land your skill/rule changes** in `plugins/weegloo/` on the canonical
   branch (normal PR/merge).
2. **Tag a version and push it** (must match `v*`, semver recommended):
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
   …or, from the **Actions tab → "Release plugin bundle" → Run workflow**, enter
   the tag as input (`workflow_dispatch` creates the tag if it doesn't exist).
3. **Done.** `release.yml` then automatically:
   - builds the bundle and creates **GitHub Release `v1.2.0`** with
     `manifest.json` + `weegloo-bundle.zip`;
   - regenerates `versions.json` and publishes it to **`gh-pages`** (the Pages
     index);
   - GitHub marks `v1.2.0` as **Latest**, so the installer's `latest` resolves
     to it.

The workflow needs no secrets beyond the default `GITHUB_TOKEN` (`contents: write`).

### Verify (optional)

```bash
gh release view v1.2.0 --repo weeglooapi/weegloo-mcp-plugin --json assets --jq '.assets[].name'
curl -s https://weeglooapi.github.io/weegloo-mcp-plugin/versions.json | head
# or just run `npx weegloo` — the picker should show `latest` + v1.2.0
```

### Notes

- **No `npm publish` for content.** Skills/rules are decoupled from the CLI (npm)
  version — a content release is just a tag push. Publish to npm only when the
  CLI program itself changes.
- **`latest` lag ~10 min** — the Pages index has a CDN cache TTL. Need it
  immediately? Pick `v1.2.0` explicitly in the picker (per-tag assets are exact).
- **No separate "latest" release/tag** — GitHub designates it automatically and
  re-points it on the next tag.
- **Prereleases:** the current workflow publishes every `v*` as a normal (Latest)
  release. A beta channel would need a `prerelease` branch in the workflow (not
  yet wired).

### Fixing a bad release

- Cleanest: **push a newer tag** (`v1.2.1`) — the workflow re-runs and
  regenerates `versions.json` too.
- Deleting a release alone does **not** update `versions.json` (it's rebuilt only
  on a workflow run) — re-run the workflow (`workflow_dispatch`) to refresh the
  index.

### One-time setup (enabling the Pages index)

Only needed once per repo. Create an empty `gh-pages` branch and point Pages at it:

```bash
git switch --orphan gh-pages
printf '' > .nojekyll
git add .nojekyll && git commit -m "init gh-pages" && git push -u origin gh-pages
git switch -   # back to your working branch
```

Then in repo **Settings → Pages**, set the source to the `gh-pages` branch
(root). The release workflow writes `versions.json` there on every release.

## Downloading the assets (no git, no API)

The installer can fetch the latest assets without knowing the tag and without
touching `api.github.com`:

```
https://github.com/weeglooapi/weegloo-mcp-plugin/releases/latest/download/manifest.json
https://github.com/weeglooapi/weegloo-mcp-plugin/releases/latest/download/weegloo-bundle.zip
```

`releases/latest/download/<asset>` 302-redirects to the asset CDN. To resolve a
specific tag's assets, swap `latest` for `download/<tag>`.

> ⚠️ Do **not** resolve "latest" through `api.github.com/repos/.../releases/latest`
> — that is the rate-limited REST API. Use the `github.com` web path above (or
> follow the redirect from `github.com/<repo>/releases/latest`) instead.

## Building locally

```bash
BUNDLE_REF=v1.0.13 node scripts/build-bundle.mjs   # → dist/bundle/
```

`dist/` is gitignored; the bundle is a build artifact, never committed.

## GitHub calls at install time — before vs. after

| Purpose | Before (depended on) | After (this design) |
| --- | --- | --- |
| Version picker | `api.github.com/repos/<repo>/branches` — REST, **60/hr** | `<owner>.github.io/<repo>/versions.json` (GitHub **Pages**) — static CDN, **not REST** |
| Resolve `latest` | (n/a — was a `latest` branch) | `versions.json.latest` → concrete tag (Pages); fallback `releases/latest` redirect — not REST |
| Skill/rule **listing** | `api.github.com/repos/<repo>/contents/.../skills?ref=` + `.../rules?ref=` — REST, **60/hr** (this caused the 2+2 fallback) | `github.com/<repo>/releases/download/<tag>/manifest.json` — asset CDN |
| File **content** (~35 reqs) | `raw.githubusercontent.com/.../skills/<id>/<file>` ×N — raw bucket | `github.com/<repo>/releases/download/<tag>/weegloo-bundle.zip` **once** → extract in memory — asset CDN |
| MCP config | `raw.githubusercontent.com/.../.mcp.json` — raw | **unchanged** (still raw) |

- **`api.github.com`** is the REST API with the unauthenticated **60/hour** shared bucket — the old picker and listing depended on it; the default path no longer does (the `-a` debug flag still uses `branches` intentionally; the release CI uses it authenticated).
- **`github.com` Pages / `releases/.../download/*`** are **not** the REST API and do not draw from that bucket.
- **`raw.githubusercontent.com`** is a separate, looser bucket (can 429 under heavy automated load); file content moved to the zip, leaving only `.mcp.json` on raw (a future follow-up can fold it into the bundle).

## Why these endpoints are safe to depend on (no REST rate limit)

The documented **60 req/hour** unauthenticated cap is a **REST API** primary rate
limit, scoped to `api.github.com` only ([GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
The endpoints the installer now uses live on `github.com` (GitHub Pages and
release-asset downloads served from the asset CDN), a different, non-REST
surface. Pages `versions.json` is additionally **our own contract** — its shape
cannot be broken by a GitHub API change, only by us.

Empirically verified (2026-06-05, public repo, unauthenticated):

- 40× a github.com feed + 40× a release asset (redirect-followed) = **80 requests → all HTTP 200, zero 429**.
- `api.github.com` core `remaining` was **unchanged** across those 80 requests (58 → 58) — i.e. they draw from a **different bucket**, not the REST 60/hour.
- Those responses carry **no `x-ratelimit-*` headers** (REST responses do), confirming they are not REST-rate-limited.

Honest caveat: GitHub may apply **undocumented secondary/abuse limits** to
extreme automated volume. A normal install makes only a handful of requests
(`versions.json` + manifest + zip ≈ 3), far below any such threshold, and needs
**no token** for a public repo. (The `.atom` feed remains only as a best-effort
picker fallback if Pages is unavailable.)

## Verifying on a fork (no upstream impact)

You can exercise the entire release → install chain on your own fork without
touching the upstream repo. **Prereqs:** `gh` authenticated to github.com, the
branch pushed to your fork, and Actions enabled on the fork (Settings → Actions).

```bash
FORK=<your-user>/weegloo-mcp-plugin          # e.g. tbonelee/weegloo-mcp-plugin
FORK_REMOTE=fork                              # your git remote pointing at the fork

# 1) Cut a test release on the fork (tag push triggers release.yml)
git push "$FORK_REMOTE" ci/release-skills-bundle
git tag v0.0.1-test && git push "$FORK_REMOTE" v0.0.1-test
RUN=$(gh run list --repo "$FORK" --workflow release.yml -L1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --repo "$FORK" --exit-status
gh release view v0.0.1-test --repo "$FORK" --json assets --jq '.assets[].name'
#   expect: manifest.json  /  weegloo-bundle.zip

# 2) Confirm the no-git / no-API download (and that the REST bucket is untouched)
curl -s https://api.github.com/rate_limit | grep -m1 remaining           # note the number
curl -sL -o /dev/null -w '%{http_code}\n' "https://github.com/$FORK/releases/latest/download/manifest.json"  # 200
curl -s https://api.github.com/rate_limit | grep -m1 remaining           # unchanged

# 3) Run the REAL CLI against the fork. The CLI hardcodes the weeglooapi repo,
#    so redirect GitHub requests to your fork with a tiny preload:
cat > /tmp/wg-fork-patch.mjs <<EOF
const real = globalThis.fetch;
globalThis.fetch = (u, o) =>
  real(String(u).replace('weeglooapi/weegloo-mcp-plugin', '$FORK'), o);
EOF
mkdir -p /tmp/wg-try && cd /tmp/wg-try
node --import /tmp/wg-fork-patch.mjs <path-to-repo>/installer-cli/bin.js
#   picker shows: latest (recommended), v0.0.1-test, ...
#   choose Claude Code → skip MCP → install Skills/Rules
find /tmp/wg-try/.claude -type f      # installed files
```

To prove the list is **dynamic** (reflects the repo, not a hardcoded set),
reduce `plugins/weegloo` to one skill + one rule on a throwaway branch, release
it, and confirm the picker/listing shows exactly 1/1 while an older tag still
lists its original set.

Optional cleanup:

```bash
gh release delete v0.0.1-test --repo "$FORK" --yes --cleanup-tag
git push "$FORK_REMOTE" --delete v0.0.1-test
```
