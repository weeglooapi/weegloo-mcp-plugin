---
name: announce
description: >
  Generate and publish a user-facing Weegloo plugin release announcement (10 languages)
  from recent skill/rule changes, then publish it to Weegloo CMA (create → publish).
  Human-triggered. Use when the user wants to announce / publish what changed in the
  weegloo skills or rules — e.g. "announce", "공지 올려줘", "릴리스 공지 발행",
  "변경사항 공지 만들어줘".
---

# Weegloo release announcement

This is a **human-triggered** flow (no CI). It turns recent skill/rule changes into a
10-language, user-facing announcement and publishes it to Weegloo CMA as a Content entry.

It reuses two existing pieces — do not reinvent them:
- **Agent**: `.claude/agents/weegloo-announce.md` — writes the announcement JSON.
- **Publisher**: `scripts/post-announcement.mjs` — create + publish to CMA.

## Steps

### 1. Determine the change range (release-anchored — do NOT pick arbitrary commits)
The announcement covers everything **since the last released version up to the current
tip of `latest`**. Releases in this repo are **version branches** (e.g. `1.0.25`), NOT
git tags — so:

```
base = the highest version branch        head = tip of `latest`
```

Resolve it like this, then confirm with the user before generating:
```bash
git fetch --all --quiet
# base: highest semver among version branches (number gaps exist, so sort, don't assume N-1)
VER=$(git branch -a | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -t. -k1,1n -k2,2n -k3,3n -u | tail -1)
# the version branch may live on upstream or origin — pick whichever resolves:
for r in "upstream/$VER" "origin/$VER" "$VER"; do git rev-parse --verify -q "$r" && BASE_REF=$r && break; done
# head: tip of latest (remote HEAD), falling back to upstream/local
for r in "origin/latest" "upstream/latest" "latest"; do git rev-parse --verify -q "$r" && HEAD_REF=$r && break; done
BASE_SHA=$(git rev-parse "$BASE_REF"); HEAD_SHA=$(git rev-parse "$HEAD_REF")
echo "range: $BASE_REF ($BASE_SHA) .. $HEAD_REF ($HEAD_SHA)"
git diff --name-status "$BASE_SHA" "$HEAD_SHA" -- plugins/weegloo/skills plugins/weegloo/rules
```
- Show the user the resolved `base..head` (with the version names) and the changed
  skill/rule files, and **confirm** before continuing.
- If no skill/rule changed in that range, tell the user there's nothing to announce and
  **STOP**.

### 2. Generate the announcement
Delegate to the **`weegloo-announce`** subagent with these inputs:
```
BASE_SHA=<resolved base>
HEAD_SHA=<resolved head>
OUTPUT_PATH=announcement.json
```
(If the subagent type isn't available, instead read `.claude/agents/weegloo-announce.md`
and follow it exactly yourself.)

- If it reports **no user-facing change** (`changed: []`), tell the user there's nothing
  to announce and **STOP** — do not publish.

### 2b. Show the Korean version and get approval (mandatory gate)
Before creating anything in CMA, show the user **only the Korean (`ko-KR`) version** of
the generated announcement — the full `title`, `summary`, AND `body` — so they can review
exactly how it reads. (Offer the other locales only if the user asks; ko-KR is the review
copy.)

- **Wait for explicit approval.** Do NOT proceed to create/publish until the user
  approves the Korean version.
- If the user wants changes, regenerate (step 2) — do not hand-edit `announcement.json` —
  and show the new Korean version again.
- Only after approval, continue to step 3.

### 3. Get the token (ask the user)
Ask the user for the **Weegloo CMA Bearer token** (production). 
- Take it as runtime input only. **Never** write it to a file, commit it, store it in
  memory, or echo it back in your response.
- The token is the ONLY thing to ask for. `WEEGLOO_CMA_BASE`, `WEEGLOO_SPACE_ID`, and
  `WEEGLOO_CONTENT_TYPE_ID` are fixed production defaults baked into the script — do NOT
  ask about them.

### 4. Create + publish
Optionally dry-run first to show the exact payload without sending:
```bash
DRY_RUN=1 WEEGLOO_CMA_TOKEN='<token>' node scripts/post-announcement.mjs
```
Then publish for real:
```bash
WEEGLOO_CMA_TOKEN='<token>' node scripts/post-announcement.mjs
```
The script creates the Content (POST) then publishes it (PUT), skips automatically if
`changed` is empty, and enforces the length limits. Report the created content id and the
publish status to the user.

## Guardrails
- `title`/`summary` ≤ 64 chars, `body` ≤ 204800 chars — enforced by both the agent's
  self-check and the publisher; if the publisher rejects a value, regenerate (step 2),
  don't hand-edit.
- `announcement.json` is gitignored — it is a throwaway build artifact, never commit it.
- The token is a secret — keep it out of files, commits, memory, and your replies.
