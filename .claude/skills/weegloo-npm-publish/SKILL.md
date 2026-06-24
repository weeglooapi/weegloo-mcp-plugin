---
name: weegloo-npm-publish
description: Publish the weegloo installer CLI (installer-cli/) to npm — preflight checks, version compare, bump prompt, tests, npm publish. Reads settings from a saved local config file, or asks for them and offers to save. Use when the user wants to release/publish the weegloo npm package, ship a new installer CLI version, run `npm publish` for installer-cli, or "버전 올리고 배포".
---

# weegloo npm publish

Manually publishes the `weegloo` npm package from `installer-cli/` (no publish CI exists).
Run every `npm` command below **from `packageDir`** (default `installer-cli`).
Committing/pushing the branch is the user's job, done **beforehand** — this skill never commits or pushes.

## 1. Load config

Config lives in `config.local.json` **next to this SKILL.md** — non-secret defaults for this repo, **committed to the repo** so the values are shared (the `.local` suffix is historical; no secrets ever go in this file — see below).

- If the file exists → load it and use those values.
- If missing → ask the user each field (offer the default), then ask **"이 설정을 파일로 저장할까요?"** — if yes, write the JSON; if no, use the answers for this run only.

```json
{
  "packageDir": "installer-cli",
  "packageName": "weegloo",
  "distTag": "latest",
  "runTests": true
}
```

**Never store secrets** in `config.local.json` — it is committed, so anything here lands in git history. The npm token comes only from `NPM_TOKEN` (env or a gitignored `.env`) — see step 2.

## 2. Preflight

### Auth (npm token via `NPM_TOKEN` — never `npm login`)

1. **Find the token** — look for `NPM_TOKEN` in the environment, then in a gitignored `.env` (project root or `installer-cli/`).
   - **No token found → STOP and tell the user (in Korean):**
     "npm 토큰이 없습니다. https://www.npmjs.com/settings/weegloo/tokens 에서 publish 권한 토큰(**Granular Access Token** 또는 Automation)을 발급한 뒤, `.env` 에 `NPM_TOKEN=...` 로 넣어주세요."
     Wait for the user, then re-check.
2. **Wire it** — ensure `installer-cli/.npmrc` (gitignored) contains exactly:
   ```
   //registry.npmjs.org/:_authToken=${NPM_TOKEN}
   ```
   and that both `.npmrc` and `.env` are in `installer-cli/.gitignore`. **Never commit `.npmrc`/`.env`, never print the token to chat.**
3. **Verify** — with `NPM_TOKEN` loaded, `npm whoami` should print the account. A **401** means the token is wrong/expired → back to step 1.

### Repo state

- Confirm the current git branch matches the `distTag` policy: dist-tag `latest` ⇄ branch `latest`, `beta` ⇄ `beta`. **Warn** on a mismatch and confirm before continuing.
- `git status --porcelain` — warn if the tree is dirty.

## 3. Version check (the key step)

- **Published**: `npm view <packageName> version`
- **Current**: `version` in `<packageDir>/package.json`

Then:
- **published == current** → ask which bump, showing the resulting number for each: `patch` / `minor` / `major` / custom. Apply with `npm --no-git-tag-version version <patch|minor|major>` (or set the custom value), which only edits `package.json` — leave that change uncommitted for the user to commit/push. Re-read the new version.
- **current > published** → confirm publishing the current version as-is.
- **current < published** → **STOP**: the registry is ahead; surface this instead of overwriting.

## 4. Test

If `runTests`, run `npm test`. Abort on any failure.

## 5. Publish

Load `NPM_TOKEN` into the environment **without printing it** — if it's only in `.env`, source it (`set -a; . <path>/.env; set +a`). Then show the command for confirmation and run:

```bash
npm publish --access public --tag <distTag>
```

`installer-cli/.npmrc` resolves `${NPM_TOKEN}` for auth (step 2). If publish errors demanding an **OTP**, the token type is wrong — recreate it as a Granular/Automation token (step 1), which publishes without OTP.

## 6. Report

State: published version, dist-tag, and `https://www.npmjs.com/package/<packageName>`.
If the skill bumped the version in step 3, remind the user that `package.json` has an **uncommitted** version change to commit/push themselves.

## Notes

- The npm package ships only `bin.js` + `src/` (`files` field). Skills/rules are fetched at runtime from GitHub by the installer, so **no manifest rebuild is needed before publishing**.
- `pluginRef` in `package.json` maps the npm dist-tag ⇄ git **branch** — keep it consistent with `distTag` (`"latest"` for latest releases). The installer fetches skills/rules from that branch at runtime, so the branch must hold the intended content before publishing.
