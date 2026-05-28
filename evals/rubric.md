# Scoring Rubric (v2)

Each prompt is scored on 4 dimensions, 0/1/2 each. **Max 8 points per prompt, 64 per run.**

Single human scorer. Same human across runs if possible — consistency matters more than absolute calibration.

When in doubt between two scores, **pick the lower one**. Honest baseline > optimistic baseline.

---

## D1 — Skill invocation

Did the agent autonomously invoke the correct Weegloo skill(s) on the first relevant turn?

| Score | Meaning |
|-------|---------|
| **0** | Did not invoke any relevant Weegloo skill. Worked entirely from ambient rules / pretrained knowledge. |
| **1** | Invoked a related but not ideal skill, OR invoked the right one but only after the user nudged ("did you check the create-content-type skill?"), OR invoked it but skipped applying its content. |
| **2** | Invoked the correct skill on the first try, without prompting, and applied its content visibly. |

**"Correct skill" is defined per prompt** in [prompts.md](./prompts.md) under "Expected trajectory". If the prompt expects two skills (e.g. `weegloo-create-content-type` + `weegloo-default-locale`), both must fire for a 2.

---

## D2 — API / architecture choice

Did the agent choose the right Weegloo surface for the task?

| Score | Meaning |
|-------|---------|
| **0** | Clearly wrong surface. Examples: ACMA for an anonymous public read; CMA from browser for end-user writes; one DeliveryAccessToken for member-private content; suggests inviting every end-user as Weegloo User. |
| **1** | Plausible but suboptimal. Examples: uses CMA where CDA would be more appropriate; uses a Weegloo User Bearer for browser delivery instead of DeliveryAccessToken; picks Long over Number for a numeric range field. |
| **2** | First answer matches what a senior Weegloo dev would recommend per [prompts.md](./prompts.md) expected trajectory. |

For prompts that don't have an API choice (e.g. ContentType modeling), score this on **modeling correctness** (right field types, right `localized`, right validations).

---

## D3 — First-shot correctness

How much did the human evaluator have to intervene to get the agent to a working answer?

| Score | Meaning |
|-------|---------|
| **0** | Two or more course corrections needed before the agent is on a viable path. Or the agent never got there. |
| **1** | One course correction needed. ("No, that's not right — use X instead" once, then it adapts.) |
| **2** | Zero course corrections. The agent's first complete answer was acceptable to ship. |

Course correction = the evaluator says something corrective, not a clarifying question the agent asks the user. Asking the user "should this be localized?" is not a deduction.

---

## D4 — Anti-pattern absence

Did the agent avoid the prompt-specific anti-patterns listed in [prompts.md](./prompts.md), plus the global anti-patterns below?

| Score | Meaning |
|-------|---------|
| **0** | One or more anti-patterns triggered. Score 0 even if only one fires — these are the patterns that cause real user pain. |
| **2** | None triggered. |

(No score of 1. This dimension is binary; the spectrum lives in D1-D3.)

### Global anti-patterns (always counted)

These apply to every prompt, on top of the prompt-specific list:

- Sends `Accept: application/json` to a Weegloo API (or sets it as default in a wrapper)
- Calls Weegloo HTTP API directly instead of using an MCP tool
- Uses Administrator on a DeliveryAccessToken
- Pushes a Personal Access Token into client-side code
- Forgets `x-weegloo-version` header on a known update
- Uses `skip` for pagination instead of `links.next`
- Mixes Service User tokens with CMA/CDA, or Weegloo User tokens with ACMA/ACDA
- Picks the first item from a SpaceRole / ServiceUserRole list without intent

---

## Per-prompt total

```
D1 (0-2) + D2 (0-2) + D3 (0-2) + D4 (0 or 2) = 0-8
```

## Per-run total

```
sum of 8 prompts = 0-64
```

If running 3 times per prompt, use the **mean** D1-D4 per prompt across the 3 runs, **floored to integer**, then sum. (Changed from median in v1 — mean-floor surfaces partial failures that median masks, e.g. P2's bimodal LongText trap.)

## Recording

Use the template in [runs/_template.md](./runs/_template.md). One file per run label.
Update [scoreboard.md](./scoreboard.md) with the final total.

---

## Calibration notes

- **Don't reward verbose output.** A wordy answer with the wrong API choice is still 0 on D2.
- **Don't penalize legitimate clarifying questions.** If the agent asks "should this be localized?", that's good — it's not a course correction by the human.
- **Don't grade on style.** This is correctness, not voice.
- **Stop at turn 5 or first commit.** Past that, the evaluator is co-designing, which contaminates the measurement.
