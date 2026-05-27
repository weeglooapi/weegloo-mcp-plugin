# Weegloo MCP Plugin Evals

A small, manual eval harness for measuring whether an AI coding agent (Claude Code, Cursor)
correctly guides users through building Weegloo-based services with this plugin installed.

## Why this exists

Plugin changes (rules, skills, descriptions, MCP tool surface) are easy to make and hard to
measure. "I rewrote the descriptions; the agent feels better" is vibes. This harness gives a
single number to track over time so changes can be defended with data.

## What it measures

Per-prompt, 4 dimensions on a 0/1/2 scale:

1. **Skill invocation** — did the agent call the right skill, on the first try?
2. **API / architecture choice** — did it pick the correct surface (CMA vs CDA vs ACMA vs ACDA, etc.)?
3. **First-shot correctness** — did the user have to intervene to course-correct?
4. **Anti-pattern absence** — did it avoid known bad patterns (Administrator token, all-LongText, `Accept: application/json`, etc.)?

Per prompt: 8 points max. With 8 prompts: 64 points max per run.

See [rubric.md](./rubric.md) for the scoring guide and [prompts.md](./prompts.md) for the prompts.

## How to run

1. **Open a clean session** — new Claude Code conversation or new Cursor window. No carryover context.
2. **Paste one prompt verbatim** from [prompts.md](./prompts.md). Do not pre-load skills; do not edit the prompt.
3. **Observe up to 5 turns** or until the agent has clearly committed to an approach. Stop and note:
   - Which skills it invoked (and in what order)
   - Which Weegloo MCP tools it called
   - Whether the user (you, the evaluator) had to correct it
   - Any anti-patterns triggered
4. **Score against the rubric** and write to a new file in [runs/](./runs/) using the [template](./runs/_template.md).
5. **Repeat 3 times per prompt** (LLM stochasticity). Record all 3 runs; use the median when computing totals.
6. **Update [scoreboard.md](./scoreboard.md)** with the run label, date, and total.

## Conventions

- One **run label** per measurement campaign (e.g. `baseline-2026-05-27`, `after-description-rewrite-2026-06-03`).
- Filename: `runs/YYYY-MM-DD-<label>.md`.
- Always note the **plugin commit SHA** the run was taken against, plus the agent (Claude Code version / Cursor version).
- Manual scoring by a single human, ideally the same human, to keep the rubric consistent.

## Current campaigns

See [scoreboard.md](./scoreboard.md).

## Not in scope (yet)

- Automated scoring. Manual is fine while N is small.
- Cross-model comparison. Add it when there are enough baselines to be worth it.
- Production telemetry. This is offline eval only.
