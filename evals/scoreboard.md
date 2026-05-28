# Scoreboard

Tracks total scores across measurement campaigns. Update after each run is fully scored.

Max: **64 points** (8 prompts × 8 points). Each prompt scored 3 times, median used.

| Date | Run label | Plugin SHA | Agent | Total / 64 | Notes |
|------|-----------|------------|-------|------------|-------|
| 2026-05-28 | baseline | `9168757` | Claude Code 2.1.153 | **62 / 64** | T0. P6 = 6/8 (default-locale skill 33% trigger). All other prompts at ceiling via median, but P2/P5/P8 hide partial failures masked by median rubric. See [run file](./runs/2026-05-28-baseline.md). |

## How to add a row

1. Finish scoring all 8 prompts (3 runs each) in `runs/YYYY-MM-DD-<label>.md`
2. Compute median per dimension per prompt; sum to total
3. Add a row above with date, label, plugin SHA (`git rev-parse --short HEAD`), agent (e.g. "Claude Code 1.x.x"), and total
4. Notes column: 1-line summary of what changed since the previous row

## Goal

Each intervention (description rewrite, ambient slimdown, plan-first tool, server-side lint) should bump the total. If a change doesn't move the score, the change isn't doing what we hoped.

**Decision rule:** if an intervention doesn't move the total by **+10/64** (about 15%), reconsider before investing in the next lever.
