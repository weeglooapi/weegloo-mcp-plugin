# Scoreboard

Tracks total scores across measurement campaigns. Update after each run is fully scored.

Max: **64 points** (8 prompts × 8 points). Each prompt scored 3 times, median used.

| Date | Run label | Plugin SHA | Agent | Total / 64 | Notes |
|------|-----------|------------|-------|------------|-------|
| _–_  | _baseline-pending_ | _–_ | _–_ | _–_ | First run pending |

## How to add a row

1. Finish scoring all 8 prompts (3 runs each) in `runs/YYYY-MM-DD-<label>.md`
2. Compute median per dimension per prompt; sum to total
3. Add a row above with date, label, plugin SHA (`git rev-parse --short HEAD`), agent (e.g. "Claude Code 1.x.x"), and total
4. Notes column: 1-line summary of what changed since the previous row

## Goal

Each intervention (description rewrite, ambient slimdown, plan-first tool, server-side lint) should bump the total. If a change doesn't move the score, the change isn't doing what we hoped.

**Decision rule:** if an intervention doesn't move the total by **+10/64** (about 15%), reconsider before investing in the next lever.
