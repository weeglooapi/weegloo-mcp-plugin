---
name: weegloo-npm-publish
description: Publish the weegloo installer CLI (installer-cli/) to npm. A release script does all the deterministic work (auth, branch/version/dirty checks, tests, publish); this skill only drives the two human gates — choosing the version bump and confirming the publish. Use when the user wants to release/publish the weegloo npm package, ship a new installer CLI version, run `npm publish` for installer-cli, or "버전 올리고 배포".
---

# weegloo npm publish

Publishes the `weegloo` npm package from `installer-cli/` (no publish CI exists).

**Almost everything here is a script.** `installer-cli/scripts/release.mjs` absorbs every
deterministic step — config (read from `package.json`), npm auth (`NPM_TOKEN` + `.npmrc`),
branch/dirty checks, published-vs-current version comparison, tests, the actual `npm publish`,
and the final report. Run it from `installer-cli/`.

Your job is only the **two human gates** the script deliberately refuses to cross on its own:

1. **Which version bump?** — the script never guesses. On `NEEDS_BUMP` you ask the user.
2. **Actually publish?** — publishing is irreversible. The script stops and prints a plan
   unless you pass `--yes`, so you confirm with the user first.

Committing/pushing the branch is the user's job, done **beforehand** — this skill never commits or pushes.

## 1. Preflight (script) — read the verdict

```bash
cd installer-cli
node scripts/release.mjs preflight        # or: npm run preflight   (add --json to parse)
```

The script prints a status block and one **verdict**:

- **`BLOCKED`** → surface the listed blocker(s) to the user in Korean and stop. Common cases:
  - *no `NPM_TOKEN`* → tell them (Korean): "npm 토큰이 없습니다. https://www.npmjs.com/settings/weegloo/tokens 에서 publish 권한 토큰(**Granular Access Token** 또는 Automation)을 발급한 뒤 `.env` 에 `NPM_TOKEN=...` 로 넣어주세요." Then re-run preflight.
  - *`npm whoami` failed (401)* → token is wrong/expired; same fix as above.
  - *registry ahead (published > current)* → do **not** overwrite; the registry has a newer version. Surface it and stop.
- **`NEEDS_BUMP`** → published == current. Go to gate 1 below.
- **`READY`** → current > published (or first publish). Skip straight to gate 2.

Warnings (dirty tree, branch ≠ dist-tag) are shown but do **not** block — mention them and let the user decide whether to continue.

## 2. HUMAN GATE 1 — version bump (only when `NEEDS_BUMP`)

Ask the user which bump, showing the resulting number for each: `patch` / `minor` / `major` / a custom `x.y.z`.
Do **not** pick for them. The script applies it (`npm --no-git-tag-version version …`, package.json only — left uncommitted for the user).

## 3. HUMAN GATE 2 — confirm, then publish

Run `release` with the chosen bump but **without `--yes`** first — it runs tests and prints the exact publish plan without publishing:

```bash
node scripts/release.mjs release --bump <patch|minor|major|x.y.z>
```

(If the verdict was `READY`, omit `--bump`.) Show the plan to the user and get an explicit go-ahead. Then publish:

```bash
node scripts/release.mjs release --bump <…> --yes
```

The script runs tests, publishes `npm publish --access public --tag <distTag>`, and reports the version, tag, and `https://www.npmjs.com/package/weegloo`. If it bumped the version, remind the user that `package.json` has an **uncommitted** change to commit/push themselves.

## Notes

- **Secrets:** `NPM_TOKEN` comes only from the environment or a gitignored `.env` (repo root or `installer-cli/`). `installer-cli/.npmrc` resolves `${NPM_TOKEN}`. Both `.npmrc` and `.env` are gitignored — never commit or print the token. If publish demands an **OTP**, the token type is wrong; use a Granular/Automation token.
- **What ships:** the npm package is only `bin.js` + `src/` (`files` field) — `scripts/` is not published. Skills/rules are fetched at runtime from GitHub, so no manifest rebuild is needed before publishing.
- **`pluginRef`** in `package.json` maps the npm dist-tag ⇄ git **branch** (both `latest`). The installer fetches skills/rules from that branch, so the branch must hold the intended content before publishing. The script derives `distTag` from `pluginRef`; override with `--dist-tag` for a `beta` release.
- Flags: `--no-tests` skips `npm test`; `--json` makes preflight machine-readable.
