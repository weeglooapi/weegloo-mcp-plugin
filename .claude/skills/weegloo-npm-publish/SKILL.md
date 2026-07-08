---
name: weegloo-npm-publish
description: Publish the weegloo installer CLI (installer-cli/) to npm. A release script does all the deterministic work (auth, branch/version/dirty checks, tests, publish); this skill only drives the single human decision — picking the release (which doubles as publish approval) — and commits the version bump afterward. Use when the user wants to release/publish the weegloo npm package, ship a new installer CLI version, run `npm publish` for installer-cli, or "버전 올리고 배포".
---

# weegloo npm publish

Publishes the `weegloo` npm package from `installer-cli/` (no publish CI exists).

**Almost everything here is a script.** `installer-cli/scripts/release.mjs` absorbs every
deterministic step — config (read from `package.json`), npm auth (`NPM_TOKEN` + `.npmrc`),
branch/dirty checks, published-vs-current version comparison, tests, the actual `npm publish`,
and the final report. Run it from `installer-cli/`.

Your job is only the **one human decision** the script refuses to make on its own — **which
release to ship**, which doubles as the publish approval (the script never publishes without an
explicit `--bump`+`--yes`). After a successful publish you also **commit the version bump** so
the repo doesn't fall behind the registry.

Pushing stays the user's call — this skill commits the bump but never pushes.

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
- **`NEEDS_BUMP`** → published == current. The status block lists the resolved numbers for each bump (`patch → x.y.z`, `minor`, `major`) — also in `nextVersions` under `--json`.
- **`READY`** → current > published (or first publish). No bump needed.

Warnings (dirty tree, branch ≠ dist-tag) are shown but do **not** block — mention them and let the user decide whether to continue.

## 2. THE HUMAN GATE — one question that is both bump AND publish approval

There is a single human decision. **Choosing the release IS the go-ahead to publish** — don't split it into two turns.

- **`NEEDS_BUMP`** → ask one question, showing the resolved numbers from the status block:
  *"이번 릴리스로 배포할까요? patch → x.y.z / minor → … / major → … / custom"* — the user's pick is the publish approval. Do **not** pick for them.
- **`READY`** → no bump to choose; just confirm *"현재 버전 x.y.z 그대로 배포할까요?"* once.

The user sees the exact resulting version **before** answering, so the choice is informed consent. Tests run inside `release` and abort before publish if they fail — nothing ships on a red build, so no second confirmation is needed.

Then publish in one shot:

```bash
node scripts/release.mjs release --bump <patch|minor|major|x.y.z> --yes   # NEEDS_BUMP
node scripts/release.mjs release --yes                                    # READY (no bump)
```

`--bump` and `--yes` are two **safety flags** the script requires together (it never publishes without both) — but that is one *human* turn, not two. Without `--yes` the script only prints a plan; use that for a dry run if asked. The script bumps `package.json`, runs `npm test`, publishes `npm publish --access public --tag <distTag>`, and reports the version, tag, and `https://www.npmjs.com/package/weegloo`.

## 3. Commit the bump (after publish succeeds)

If a bump happened, the published version MUST be committed — otherwise the repo's `package.json` falls behind the registry (the "registry ahead" drift). The script deliberately does **not** touch git; **you (the skill) commit** it here:

```bash
git add installer-cli/package.json installer-cli/package-lock.json
git commit -m "chore(release): weegloo@<version>"
```

Commit only — **do not push**; pushing stays the user's call (verify the branch/remote first). Tell the user the commit was made and that they should push it. For a real release this should land on the branch matching the dist-tag (`latest`), so confirm the branch before committing if it doesn't match.

## Notes

- **Secrets:** `NPM_TOKEN` comes only from the environment or a gitignored `.env` (repo root or `installer-cli/`). `installer-cli/.npmrc` resolves `${NPM_TOKEN}`. Both `.npmrc` and `.env` are gitignored — never commit or print the token. If publish demands an **OTP**, the token type is wrong; use a Granular/Automation token.
- **What ships:** the npm package is only `bin.js` + `src/` (`files` field) — `scripts/` is not published. Skills/rules are fetched at runtime from GitHub, so no manifest rebuild is needed before publishing.
- **`pluginRef`** in `package.json` maps the npm dist-tag ⇄ git **branch** (both `latest`). The installer fetches skills/rules from that branch, so the branch must hold the intended content before publishing. The script derives `distTag` from `pluginRef`; override with `--dist-tag` for a `beta` release.
- Flags: `--no-tests` skips `npm test`; `--json` makes preflight machine-readable.
