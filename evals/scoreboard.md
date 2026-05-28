# Scoreboard

Tracks total scores across measurement campaigns. Update after each run is fully scored.

Max: **64 points** (8 prompts × 8 points). Each prompt scored 3 times; **mean-floor** per dim (rubric v2).

| Date | Run label | Plugin SHA | Agent | Rubric | Total / 64 | Notes |
|------|-----------|------------|-------|--------|------------|-------|
| 2026-05-28 | baseline | `9168757` | Claude Code 2.1.153 | v1 (median) | **62 / 64** | T0. P6 = 6/8. Median masks P2/P5/P8 partials. |
| 2026-05-28 | baseline (retro) | `9168757` | Claude Code 2.1.153 | v2 (mean-floor) | **57 / 64** | T0 retrocomputed. P1=8 P2=5 P3=8 P4=8 P5=7 P6=6 P7=8 P8=7. |

## How to add a row

1. Finish scoring all 8 prompts (3 runs each) in `runs/YYYY-MM-DD-<label>.md`
2. Compute mean per dimension per prompt (floored to integer); sum to total
3. Add a row above with date, label, plugin SHA (`git rev-parse --short HEAD`), agent (e.g. "Claude Code 1.x.x"), and total
4. Notes column: 1-line summary of what changed since the previous row

## Goal

Each intervention (description rewrite, ambient slimdown, plan-first tool, server-side lint) should bump the total. If a change doesn't move the score, the change isn't doing what we hoped.

**Decision rule:** if an intervention doesn't move the total by **+5/64** under mean-floor, reconsider before investing in the next lever. (Lowered from +10 with the switch to v2 rubric — mean-floor is a tighter scale.)
