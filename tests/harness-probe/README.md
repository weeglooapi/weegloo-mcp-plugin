# Harness capability probe — run this BEFORE moving any content

This probe answers four questions that the whole restructure depends on, and that **no
amount of reading this repo can settle**. Until they are answered with an observation,
moving rule content into skills is not a relocation — on some harnesses it may be a
deletion.

## Why this exists

The installer writes skills to a per-harness directory:

| harness | rules land in | skills land in |
|---|---|---|
| Claude Code | `~/.claude/rules/<id>.md` — auto-injected verbatim into the system prompt | `~/.claude/skills/<id>/` — description always loaded, body on invoke |
| Codex | marker sections inside a single `AGENTS.md` (`codex.js:403`) | `~/.agents/skills/<id>/` or `./.agents/skills/<id>/` (`codex.js:43-47`) |
| Antigravity | `GEMINI.md` markers (global) or `<rulesDir>/<id>.md` with an injected `trigger: always_on` (project) | `.agents/skills/<id>/` (`antigravity.js:250-252`) |

**Nothing in this repository tells Codex or Antigravity that the skills directory exists.**
`antigravity.js:56-72` (`RULE_LOADING_CONTENT`) is a bootstrap instruction, and it points
at `./.agents/rules/` and `~/.agents/rules/` only — skills are never mentioned.
`codex.js` upserts rule markers into `AGENTS.md` and nothing else.

So one of two things is true, and they lead to opposite plans:

- **The harness discovers skills natively** → the restructure proceeds as designed.
- **It does not** → skills are inert files on disk for those harnesses, and every byte of
  rule content moved into a skill silently disappears there. The fix is a bootstrap rule
  (the "목차" / table-of-contents entry point), which then becomes *mandatory*, not optional.

## The four questions

| # | Question | Blocks |
|---|---|---|
| Q1 | Does **Codex** load and act on a skill in `.agents/skills/`? | Phase 3, Phase 4 |
| Q2 | Does **Antigravity** load and act on a skill in `.agents/skills/`? | Phase 3, Phase 4 |
| Q3 | Will either follow a link from `SKILL.md` into `references/*.md`? | Phase 3 |
| Q4 | Does Antigravity's `RULE_LOADING` bootstrap actually fire (are rules loaded at all)? | Phase 4 |

## Method — canary strings

A canary is a fact that exists in exactly one file and nowhere else on the internet, so a
correct answer is proof the agent read that file. Do **not** probe with a real Weegloo
question — the model may know the answer from its training data or from another rule, and
you would score a false positive.

Canaries for this probe (keep them exactly as written):

| canary | placed in |
|---|---|
| `WGLPROBE-SKILL-QUETZAL-7731` | `<skills>/weegloo-probe/SKILL.md` body |
| `WGLPROBE-REF-MARMOSET-2209` | `<skills>/weegloo-probe/references/deep.md` |
| `WGLPROBE-RULE-OCELOT-5514` | a rule installed through the normal rule channel |

### Setup

1. Cut a throwaway branch from this one and add a `weegloo-probe` skill plus a
   `weegloo-probe` rule carrying the canaries above. The skill's `description` must say it
   answers probe questions; its body must contain the SKILL canary and one line pointing at
   `references/deep.md` for "the deep probe code".
2. Push, then run the manifest workflow for that branch
   (`.github/workflows/installer-manifest.yml`, `workflow_dispatch`) so the branch has a
   manifest to install from.
3. Install into a **scratch directory**, never your working machine's global scope:
   `npx weegloo@latest --agent codex --location project --branch <probe-branch>`
   (repeat with `--agent antigravity`, and `--agent claude` as the control).

### Run

In a fresh session of each harness, ask exactly these, one per session:

| ask | proves |
|---|---|
| `What is the weegloo probe skill code?` | Q1 / Q2 — skill body reached the agent |
| `What is the deep probe code?` | Q3 — the agent followed the link into `references/` |
| `What is the weegloo probe rule code?` | Q4 — the rule channel reached the agent |

Record the verbatim answer. A hedge ("I don't have that") is a **negative**, not an
inconclusive. An answer that names the file but not the code is also a negative.

### Record the result

Fill in `tests/harness-probe/RESULT.md` with one row per (harness, question), the date, the
harness version, and the verbatim answer. That file is the evidence Phase 3 and Phase 4 cite.

## What each outcome means

- **Q1/Q2 negative** → a bootstrap rule that names the skills directory becomes a
  prerequisite for those harnesses, and it ships **before** any content moves. This is the
  entry-point / 목차 idea, and on these harnesses it is load-bearing rather than an
  optimization.
- **Q3 negative** → `references/` splitting is Claude-Code-only. Every spine must then be
  self-sufficient for the single most common path on the other harnesses, or the split is
  silent content loss rather than a token trade.
- **Q4 negative** → gates are not firing on Antigravity *today*, which is a live bug that
  outranks the whole restructure.

## Known non-reproducible condition

Global and project installs load as a **union**. A single machine therefore cannot A/B two
corpora at once — only before/after on the same machine. Uninstall between runs
(`npx weegloo --uninstall`) or use separate scratch project directories.
