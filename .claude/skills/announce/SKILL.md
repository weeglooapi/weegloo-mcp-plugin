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

### 1. Determine the change range (the USER chooses; you propose a default — never silently auto-resolve)
The announcement covers the changes **between two refs the user picks**: `base..head`.
Releases in this repo are **version branches** (e.g. `1.0.25`), NOT git tags. Do **not**
silently auto-pick and diff a range — that is how the diff once came out reversed (a stale
fork's `latest` was diffed against an upstream version branch). Instead: **list the
candidate branches, propose a sensible default, and let the user confirm or override.**

The default range is **previous version → latest version** (this release's changes):
`base = second-highest version branch`, `head = highest version branch`.

#### 1a. List candidates from ONE remote and propose the default
```bash
git fetch --all --quiet
# Pick a single remote and resolve EVERYTHING from it — never mix remotes (origin is usually
# your fork and may be stale/behind; upstream is canonical). Prefer upstream when present.
git rev-parse --verify -q upstream/latest >/dev/null && REMOTE=upstream || REMOTE=origin
echo "remote: $REMOTE"
# version branches on that remote, ascending semver:
VERS=$(git branch -r | sed -n "s#^[ *]*$REMOTE/##p" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n -u)
echo "--- candidate version branches ($REMOTE), with tip date ---"
# while-read (not `for v in $VERS`) so it works in zsh too, which doesn't word-split unquoted vars:
echo "$VERS" | while read -r v; do [ -z "$v" ] && continue; printf "  %-10s %s  %s\n" "$v" "$(git rev-parse --short "$REMOTE/$v")" "$(git show -s --format=%ci "$REMOTE/$v")"; done
printf "  %-10s %s  %s\n" "latest" "$(git rev-parse --short "$REMOTE/latest")" "$(git show -s --format=%ci "$REMOTE/latest")"
# proposed default: prev version (base) .. highest version (head)
HEADVER=$(echo "$VERS" | tail -1); BASEVER=$(echo "$VERS" | tail -2 | head -1)
echo "proposed default range: $BASEVER .. $HEADVER   (override by giving any base..head)"
```
- **Show the user** the candidate list and the proposed default, and **ask them to pick**:
  accept the default, or name any `base..head` (version branches, `latest`, tags, or SHAs).
  If the user already passed an explicit range to `/announce` (e.g. `1.0.26..1.0.27`), use
  that and skip the prompt — but still run the guard in 1b.
- **Do not proceed until the user has chosen.** This is the human-in-the-loop range gate.

#### 1b. Resolve the chosen range on that ONE remote, then run the orientation guard
Set `BASE_REF`/`HEAD_REF` to what the user chose (prefix bare version names with
`$REMOTE/`, e.g. `upstream/1.0.26`). Then:
```bash
# Example after the user accepts the default — substitute the user's actual choice:
BASE_REF="$REMOTE/$BASEVER"; HEAD_REF="$REMOTE/$HEADVER"
BASE_SHA=$(git rev-parse "$BASE_REF"); HEAD_SHA=$(git rev-parse "$HEAD_REF")
echo "range: $BASE_REF ($BASE_SHA) .. $HEAD_REF ($HEAD_SHA)"

# --- ORIENTATION GUARD (mandatory) — the diff is only meaningful if head is truly ahead of base ---
AHEAD=$(git rev-list --count "$BASE_SHA".."$HEAD_SHA")   # commits in head not in base
BEHIND=$(git rev-list --count "$HEAD_SHA".."$BASE_SHA")  # commits in base not in head
NFILES=$(git diff --name-status "$BASE_SHA" "$HEAD_SHA" -- plugins/weegloo/skills plugins/weegloo/rules | grep -c .)
echo "orientation: head is $AHEAD commit(s) ahead of base, $BEHIND behind; $NFILES skill/rule files differ"
git merge-base --is-ancestor "$BASE_SHA" "$HEAD_SHA" || echo "WARN: base is NOT an ancestor of head — branches DIVERGED"
echo -n "base tip date: "; git show -s --format=%ci "$BASE_SHA"
echo -n "head tip date: "; git show -s --format=%ci "$HEAD_SHA"
if [ "$BEHIND" -gt "$AHEAD" ]; then
  echo "ABORT: head ($HEAD_REF) is BEHIND base ($BASE_REF). The diff would be REVERSED (adds/deletes flipped)."
  echo "       The newest line is base, not head — do NOT announce this range. Ask the user to swap base/head."
fi

git diff --name-status "$BASE_SHA" "$HEAD_SHA" -- plugins/weegloo/skills plugins/weegloo/rules
git log --oneline "$BASE_SHA".."$HEAD_SHA" -- plugins/weegloo/skills plugins/weegloo/rules
```
- **Read the orientation guard output before anything else.** If it prints `ABORT`, if
  `BEHIND > AHEAD`, if the branches diverged, or if the head tip is *older* than the base
  tip — **STOP** and ask the user to swap/fix the range. Even though the user picked it,
  they may have ordered it backwards; do NOT generate from a reversed range.
- **Sanity-check commit count vs file count.** If `git log base..head` has ~0–1 commits but
  the diff shows many changed files, the range is almost certainly inverted — STOP and ask.
- Show the user the resolved `base..head`, the changed skill/rule files, **and the one-line
  commit log for the range**, and **confirm** before continuing.
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
- **Cross-check each announced item against the range's commit log before showing it.**
  A fluent, plausible-sounding announcement can still be exactly backwards (an inverted
  range reads perfectly). For every item — especially any "removed / dropped / now X-only"
  — confirm a real commit in `base..head` supports it. If an item has no matching commit,
  or a commit message says the opposite, do NOT show it as approved-ready: STOP and
  re-examine the range orientation (step 1). Review the *grounding*, not just the prose.
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
