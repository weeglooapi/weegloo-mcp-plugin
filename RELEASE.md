# Releasing the plugin bundle

The installer CLI resolves the **install picker** from a GitHub Release
**`manifest.json`** asset instead of walking the GitHub Contents API per
directory. This avoids two constraints that bit us in production:

- **No GitHub REST API rate limit.** Listing skills/rules via
  `api.github.com/.../contents` is capped at 60 requests/hour for
  unauthenticated callers; release-asset downloads are not.
- **No git client required.** Assets are plain HTTPS downloads (served from
  GitHub's asset CDN), so users without `git` installed can still install.

> **How the CLI consumes a release:**
> - **Listing** — `fetchResourceLists` reads the skill/rule list from
>   `manifest.json` (one CDN fetch, no `api.github.com`).
> - **File content** — `prepareResourceSource` downloads `weegloo-bundle.zip`
>   once from the asset CDN and extracts it in memory (fflate), then installs
>   files from that map — **no `raw.githubusercontent.com`, no git client**.
> - **Fallback** — when a ref has no published release (e.g. a feature branch),
>   the CLI degrades gracefully: listing falls back to the Contents API and file
>   content to per-file raw fetches. So the installer keeps working before the
>   first release exists, and switches to the bundle automatically once it does.

## What gets published

`scripts/build-bundle.mjs` stages `plugins/weegloo/` into `dist/bundle/`:

```
manifest.json        # enumerates every skill + rule (the picker reads this)
skills/<id>/...       # SKILL.md, metadata.json, ...
rules/<id>.mdc
.mcp.json
```

The `.github/workflows/release.yml` workflow zips that into
`weegloo-bundle.zip` and uploads **two** assets to the release:

| Asset | Used for |
| --- | --- |
| `manifest.json` | Populate the install picker (list skills/rules) — one tiny fetch |
| `weegloo-bundle.zip` | The actual skill/rule files to install |

## Cutting a release

Either push a tag:

```bash
git tag v1.0.13
git push origin v1.0.13
```

…or run the **Release plugin bundle** workflow manually (Actions tab →
`workflow_dispatch`) with the tag name as input — it will create the tag if it
does not exist.

The workflow needs no secrets beyond the default `GITHUB_TOKEN` (it has
`contents: write`).

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
| Version picker | `api.github.com/repos/<repo>/branches` — REST, **60/hr** | `github.com/<repo>/releases.atom` (+ `tags.atom` fallback) and a synthetic `latest` — **not REST** |
| Resolve `latest` | (n/a — was a `latest` branch) | `github.com/<repo>/releases/latest` (manual redirect, `no-cache`) → concrete tag — not REST |
| Skill/rule **listing** | `api.github.com/repos/<repo>/contents/.../skills?ref=` + `.../rules?ref=` — REST, **60/hr** (this caused the 2+2 fallback) | `github.com/<repo>/releases/download/<tag>/manifest.json` — asset CDN |
| File **content** (~35 reqs) | `raw.githubusercontent.com/.../skills/<id>/<file>` ×N — raw bucket | `github.com/<repo>/releases/download/<tag>/weegloo-bundle.zip` **once** → extract in memory — asset CDN |
| MCP config | `raw.githubusercontent.com/.../.mcp.json` — raw | **unchanged** (still raw) |

- **`api.github.com`** is the REST API with the unauthenticated **60/hour** shared bucket — the old picker and listing depended on it; the default path no longer does (the `-a` debug flag still uses `branches` intentionally).
- **`github.com`** atom feeds / `releases/latest` redirect / `releases/.../download/*` are **not** the REST API and do not draw from that bucket.
- **`raw.githubusercontent.com`** is a separate, looser bucket (can 429 under heavy automated load); file content moved to the zip, leaving only `.mcp.json` on raw (a future follow-up can fold it into the bundle).

## Why these endpoints are safe to depend on (no REST rate limit)

The documented **60 req/hour** unauthenticated cap is a **REST API** primary rate
limit, scoped to `api.github.com` only ([GitHub Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
The endpoints the installer now uses live on `github.com` (atom feeds, the
`releases/latest` redirect, and release-asset downloads served from the asset
CDN), which are a different, non-REST surface.

Empirically verified (2026-06-05, public repo, unauthenticated):

- 40× `releases.atom` + 40× a release asset (redirect-followed) = **80 requests → all HTTP 200, zero 429**.
- `api.github.com` core `remaining` was **unchanged** across those 80 requests (58 → 58) — i.e. they draw from a **different bucket**, not the REST 60/hour.
- Those responses carry **no `x-ratelimit-*` headers** (REST responses do), confirming they are not REST-rate-limited.

Honest caveat: GitHub may apply **undocumented secondary/abuse limits** to
extreme automated volume. A normal install makes only a handful of requests
(atom + `latest` redirect + manifest + zip ≈ 4), far below any such threshold,
and needs **no token** for a public repo. Atom feeds (`commits.atom`,
`tags.atom`, `releases.atom`) are a long-standing public GitHub feature.

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
