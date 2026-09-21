# Harness probe — results

Run 2026-09-21. Protocol: [README.md](README.md).

## What was actually tested

Canary files were placed **by hand at the exact paths the installer writes** (verified against
`installer-cli/src/claude.js:44-51` and `codex.js:43-47`), in a scratch project directory, and each
harness was asked for the canary in a fresh non-interactive session.

This tests **harness capability** — can the agent see a skill body, follow a link into
`references/`, and receive a rule at these locations — which is the question Phase 3 is blocked on.
It deliberately does **not** exercise the installer: no branch was pushed, no manifest generated,
nothing installed globally. A capability answer and an install answer are different claims; only
the first is made here.

Scope was **project**, not global. The installer supports both.

## Results

| # | Question | Claude Code | Codex | Antigravity |
|---|---|---|---|---|
| Q1 | Does the harness load a skill from the skills directory? | **YES** | not run | not run |
| Q3 | Does it follow a link from `SKILL.md` into `references/*.md`? | **YES** | not run | not run |
| Q4 | Does the rule channel reach the agent? | **YES** | not run | not run |

### Claude Code — verbatim answers

```
Q: What is the weegloo probe skill code?
A: The weegloo probe skill code is **WGLPROBE-SKILL-QUETZAL-7731**.

Q: What is the deep probe code?
A: WGLPROBE-REF-MARMOSET-2209

Q: What is the weegloo probe rule code?
A: WGLPROBE-RULE-OCELOT-5514
```

`WGLPROBE-REF-MARMOSET-2209` exists in exactly one file — `references/deep.md`, which nothing but
the spine's one-line pointer names. Returning it is proof the agent opened that file on its own.

### Codex — blocked, not negative

`codex exec` refused before reaching the model:

```
Error: Your access token could not be refreshed. Please log out and sign in again.
```

This is an authentication state, **not** a probe result. It must not be recorded as "Codex does not
load skills" — nothing was measured. Re-run after `codex login`:

```bash
cd <this repo>/tests/harness-probe && codex login
```

then the three questions from a directory containing `.agents/skills/weegloo-probe/` and an
`AGENTS.md` carrying the rule marker (the scratch fixture is reproducible from the README).

### Antigravity — not automatable here

Antigravity is a GUI IDE with no CLI on this machine (`command -v antigravity` → not found), so the
probe has to be driven by hand in the application. Until someone does, its three answers are
**unknown**, and an unknown is not a pass.

## What this means for Phase 3

- **Claude Code: Phase 3 is unblocked.** The spine + `references/` split works — the agent follows
  the pointer and reads the page.
- **Codex and Antigravity: still unknown.** Phase 3's rule (c) therefore stands unchanged — every
  spine must be self-sufficient for the single most common path, or a split is silent content loss
  on any harness that reads only `SKILL.md`. Do not relax that until this table has two more YESes.
- Nothing here changes Phase 4's conclusion. Rules are always-loaded on every harness; that was
  never in question.

## Caveat worth keeping in view

Q1/Q3 passing on Claude Code says the harness *can* reach those files. It does not say the agent
*will* reach them under load, when a spine's pointer competes with everything else in context. That
is a behavioural question, and the fixture suite (`tests/`) is where it gets answered — a Phase 3
split is verified the same way Phases 1, 2 and 4 were: install the branch, run the fixtures,
compare per-assert against the baseline.
