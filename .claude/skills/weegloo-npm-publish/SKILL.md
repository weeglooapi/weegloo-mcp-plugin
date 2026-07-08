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

Your job is only the **one decision** the script won't make on its own — **which bump**, when
one is needed (`NEEDS_BUMP`). When the version is already ahead (`READY`), there's nothing to
decide, so just publish. Either way the script never publishes without an explicit `--yes`.
After a successful publish you also **commit the version bump** so the repo doesn't fall behind
the registry.

Pushing stays the user's call — this skill commits the bump but never pushes.

## 1. Preflight (script) — read the verdict

```bash
cd installer-cli
node scripts/release.mjs preflight        # or: npm run preflight   (add --json to parse)
```

The script prints a status block and one **verdict**:

- **`BLOCKED`** → surface the listed blocker(s) to the user in Korean and stop. Common cases:
  - *no `NPM_TOKEN`* → the token itself is the only thing that must come from the user. Tell them (Korean) to create a **publish** token (Granular Access Token **or** Automation) at https://www.npmjs.com/settings/weegloo/tokens, then offer **two paths — do not pick for them**:
    - **(a) 붙여넣어 주시면 제가 파일에 기록** — the user pastes the token and you write it yourself. This is the recommended first option (mirrors the weegloo-upload token rule: edit the file for them rather than making them do it).
    - **(b) 직접 `.env` 에 `NPM_TOKEN=...` 로 넣기** — the user edits it themselves.
    - **Writing it for them (path a) — safely:**
      1. **Confirm `.env` is gitignored** before writing (`installer-cli/.gitignore` already ignores `.env`). Never write a token to a tracked file.
      2. Write/update `NPM_TOKEN=<value>` in **`installer-cli/.env`**. If the file exists, **replace an existing `NPM_TOKEN` line** rather than appending a duplicate, and leave other vars untouched; otherwise create the file.
      3. **Never echo the token back** to chat, never commit it, never print it in a command. When you must load it, source the file (`set -a; . installer-cli/.env; set +a`) — don't inline the value.
    - Then **re-run preflight** — `npm whoami` verifies the token actually works.
  - *`npm whoami` failed (401)* → the token is wrong/expired. Same two paths as above (paste-and-I'll-write, or edit yourself); replace the bad `NPM_TOKEN` value, then re-run preflight.
  - *registry ahead (published > current)* → do **not** overwrite; the registry has a newer version. Surface it and stop.
- **`NEEDS_BUMP`** → published == current. The status block lists the resolved numbers for each bump (`patch → x.y.z`, `minor`, `major`) — also in `nextVersions` under `--json`.
- **`READY`** → current > published (or first publish). No bump needed.

Warnings (dirty tree, branch ≠ dist-tag) are shown but do **not** block — mention them and let the user decide whether to continue.

## 2. Bump / publish — ask only when there's a real decision

The user invoked a **publish** skill, so shipping is the intent. Only ask when there's genuinely something to decide.

- **`NEEDS_BUMP`** (published == current) → there IS a decision: which bump. Ask one question, showing the resolved numbers from the status block:
  *"이번 릴리스로 배포할까요? patch → x.y.z / minor → … / major → … / custom"* — the user's pick is the publish approval. Do **not** pick for them.
- **`READY`** (local > published, or first publish) → **nothing to decide — just publish.** The version was already bumped deliberately and the invocation is the go-ahead, so don't add a redundant confirm. Announce what you're shipping (*"발행본 1.5.5보다 앞선 1.5.6을 latest로 배포합니다"*) and run it.
  - **One guard:** if there are **warnings** (dirty tree, or branch ≠ dist-tag), surface them and get a quick OK first — publishing `latest` from the wrong branch is a real footgun. No warnings → straight to publish.

Tests run inside `release` and abort before publish if they fail — nothing ships on a red build.

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
