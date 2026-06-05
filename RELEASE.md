# Releasing the plugin bundle

The installer CLI downloads skills/rules as a **single GitHub Release asset**
rather than walking the GitHub Contents API per directory. This avoids two
constraints that bit us in production:

- **No GitHub REST API rate limit.** Listing skills/rules via
  `api.github.com/.../contents` is capped at 60 requests/hour for
  unauthenticated callers; release-asset downloads are not.
- **No git client required.** Assets are plain HTTPS downloads (served from
  GitHub's asset CDN), so users without `git` installed can still install.

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
