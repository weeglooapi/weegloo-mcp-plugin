# CLAUDE_HANDOFF

Working state of the **skill/rule restructure** on `refactor/skill-rule-tree`. Written for a fresh
session with no memory of the work. Read this before touching `plugins/weegloo/`.

Plan of record: [`docs/restructure/PLAN.md`](docs/restructure/PLAN.md). This file is the *status*;
the plan is the *design*.

---

## The one rule that governs everything here

> **The agent must not get worse.** That is a claim about behaviour, so it is measured as
> behaviour — never asserted.

Every byte-counting check is satisfied **identically** by "we deleted a duplicate" and by "we
deleted a gate". Bytes cannot tell those apart; `tests/run-fixtures.mjs` can. Nothing in
`plugins/weegloo/` ships without a fixture run that compares per-assert against the baseline.

A corollary that cost this project three separate bugs: **never convert "could not measure" into
"fine."** An errored retry, a truncated reply, a fixture that was not in the run — each of those
used to be scored as evidence, and each produced a confident wrong conclusion. See *Lessons* below.

---

## Status

| Phase | What | State |
|---|---|---|
| 0a | Behavioural fixtures + harness probe | done |
| 0b | Installer: nested `references/` in the manifest, path validation, single write helper | done |
| 1 | Rule duplication compressed to Verdict lines; 2 live drifts fixed | verified, 59/59 |
| 2 | Every skill `description` capped at 700 B, Korean triggers added | verified, 69/69 |
| 4 | Rules compressed in place, 110 gates inventoried | verified, 69/69 |
| 3 | Router + `weegloo-script` split into spine + `references/` | verified, 68/69 (1 flaky) |
| 3b | Remaining 7 skills over 18 KB | verified, 68/69 (1 flaky) |
| 5 | 7 provider OAuth skills folded into the spine's `references/` | done |

Phases were done out of numeric order: 4 before 3, because 4 held the large always-loaded saving
and 3 was blocked on the harness probe.

**Always-loaded budget: 145,606 B → 84,694 B (−60,912 B, ≈ −42%, ~18.5k tokens every session).**
`rules` 71,141 B + 23 skill `description`s 13,553 B. Per-invoke: the router 53,118 → 22,291 B
(−58%), `weegloo-script` 60,517 → 28,085 B (−54%); 18 `references/` files load only when their
spine points at them.

---

## The drift hunt (done)

A hunt over the whole corpus produced **8 candidates**. Two were adjudicated **not-real** (the
hunters over-report; a dropped scope qualifier is the usual false positive). The other **6 were
verified against the OpenAPI specs and all fixed**, each now a registered `forbidden` row:

| row | the defect |
|---|---|
| `put-is-full-replacement` | `api-endpoints` said PUT may take "a partial body where the OpenAPI contract allows" while `global-rules` said updates are FULL REPLACEMENT — **both always loaded**. 32/39 body-carrying CMA PUTs and 2/2 ACMA PUTs state *"Partial updates are not supported"*; none states the opposite. The failure is a 200 that silently erases fields. |
| `acma-patch-content-only` | PATCH listed for ContentType/Content/Media under a heading reading "CMA / ACMA", with no plane qualifier. On ACMA only Content has it. |
| `locale-presence-scoped-by-required` | create-time locale presence was tied to whether a field is *populated*, not to its `required` flag — wrong in both directions. |
| `read-fallback-is-opt-in` | a non-default locale was described as falling back to the space default; it falls back only through its own `fallbackCode` chain, else empty. |
| `media-file-url-shape` | the expanded-Media file URL was stated without its plane, so `fields.file.{locale}.url` on delivery yields `undefined`. |
| `script-writes-default-bucket` | the Script skill carved out an exception for `localized: true`, the exact class where the default bucket is mandatory — and contradicted its own two examples. |

Every one fires against `c6397c1` (the commit that still holds it) and is silent now; the leftover
candidates and their adjudications are in `<scratchpad>/drift-todo.json`.

---

## How to measure (you will need this before any content change)

The fixtures run against the **installed** corpus under `~/.claude/`, **not** the repo. Editing a
file changes nothing until the installer runs.

```bash
npx weegloo@latest --agent claude --location global --branch refactor/skill-rule-tree --update
node tests/run-fixtures.mjs --out tests/run.<name>.json --compare tests/baseline.develop.json
npx weegloo@latest --agent claude --location global --branch develop --update   # restore afterwards
```

`baseline.develop.json` is 23 fixtures / 69 asserts measured on `develop` @ `2b949e0ac300`. Exit 1
means a regression, an unverified assert, or an unconfirmed one — read which, they are reported
separately. `--only a,b,c` + `--merge <scorecard>` re-runs part of a suite (for a rate limit) and
folds it back in.

**Traps that have already bitten, in this exact order:**

1. **Installing is not free of side effects.** `--update` **reuses the origins mapping recorded at
   install**. If the machine was last set up against a dev environment, every host in the corpus is
   rewritten to `dev-*` and `weegloo-terms-consent` is dropped from the catalogue
   ([`origins.js:189`](installer-cli/src/origins.js)) — by design, but it means you are measuring a
   third corpus that is neither the baseline nor the branch. `--origins` is refused with `--update`;
   changing environments needs a **reinstall**. Check
   `~/.weegloo/claude/installed.json` → `origins` is null before trusting a run.
2. **The scorecard records both `gitSha` and `installedRef`/`installedVersion`.** Only the second
   describes what was measured. A `--merge` across two different installed versions warns, and that
   warning means the merged card describes no single corpus — re-run the whole suite.
3. **A judge assert is stochastic.** A single failure is not a regression: the runner re-runs the
   fixture (`--confirm-retries`, default 4) and takes the majority, reporting a split as FLAKY.
4. **Do not pipe the runner.** `run-fixtures.mjs … | tail -60` hands you `tail`'s exit status, so
   the one signal the runner exists to produce — non-zero for "this cannot support a no-regression
   claim" — is thrown away, and the shell reports success. Run it bare, or `set -o pipefail`. The
   run of 2026-09-21 hit the account's session limit on **all 23** fixtures, measured nothing, and
   came back exit 0 for exactly this reason; the prose verdict was right there in the output.
5. **A session limit wipes a run silently-ish.** Every fixture fails with a 55-character reply
   (`MIN_RESPONSE_CHARS` catches it as an ERROR, not a score — that guard works). Check the clock
   against the reset time before starting; a full suite is 23 fixtures plus up to 4 confirm-retries
   each. Delete the scorecard such a run writes — a file named `run.<name>.json` that measured
   nothing will be read later as evidence that it did.

---

## Guardrails (CI) — what each one can and cannot catch

`installer-cli/test/` — 242 tests, all passing.

| File | Catches |
|---|---|
| `budgets.test.js` | per-**file** byte caps (never a total — a total lets one file grow into another's headroom, which is how `global-rules` reached 44 KB); `description` ≤ 700 B; every `GATE-INVENTORY.md` sentence still present |
| `fact-owners.test.js` | the three drift axes below |
| `manifest.test.js` | a skill subdirectory produces nested manifest keys — without it a flat builder passes with a byte-identical manifest and a green CI, and every `npx` user gets a spine pointing at files that were never written |

**`plugins/weegloo/GATE-INVENTORY.md`** — 110 sentences whose absence yields a plausible-but-wrong
answer (an empty list, an `undefined`, data exposed with no error). They cannot be demoted to a
skill or behind a link: the agent does not know it does not know, so it never triggers the lookup.
Deleting a line from this file is a decision and must show up in a diff.

**`plugins/weegloo/FACT-OWNERS.md`** — one fact, one owner, three axes. Read its own table before
adding a row; it states honestly what each axis misses. In short: `canary` (a phrase appearing
exactly once) catches copy-paste drift but **not** a restatement in different words; `mentions`
catches a new file joining the conversation but **not** a contradiction between two files already
registered; **`forbidden` is the row that earns its keep** — every drift fixed becomes a permanent
regression guard, verified against the commit where the defect existed.

> The plan claimed grep-uniqueness "would have caught both known drifts". It would not. Measured:
> 28 sentences appear verbatim in 2+ files and **none** span an always-loaded rule and anywhere
> else, yet three real drifts existed. Paraphrased contradictions keep the count at 1. Only reading
> both statements catches those, which in this repo means the behavioural fixtures.

**Controls — a passing test proves nothing until you have watched it fail.** There is one per
guard kind, and neither is in CI (both cost something CI does not have: agent calls, a full clone).

- `tests/negative-control.mjs` — does a **judge assert** still reject a wrong answer? One sample
  **per failure mode**: an intermediate rewrite of `bottom-up-order` once accepted the very defect
  it exists to catch and still passed a control, because that control's wrong answer was wrong in a
  *different* way.
- `tests/fact-owners-control.mjs` — does a **`forbidden` pattern** still match its own defect? It
  rebuilds each pinned commit as a worktree and fails a row that stays silent there.
  `scheduler-version-header` shipped with its pattern's two halves in the opposite order to the
  real sentence, matched nothing on any commit, and passed the suite for two phases. The refs in
  `DEFECT_AT` must be immutable — a ref that moves with the branch follows the fix and every row
  reads INERT, which is the same silent success one level up; the script refuses `HEAD` outright.

---

## Lessons the instrument paid for

Each of these produced a confident wrong answer before it was found. They are the reason the
measurement discipline above is written the way it is.

- **A mangled prompt still scores.** Windows needs `shell: true` for the `claude` shim, and the
  shell re-parsed the prompt down to the single character `"I"` — the agent answered *that*, and the
  reply scored 1/2. Prompts now go in on **stdin**; a reply under `MIN_RESPONSE_CHARS` is an ERROR,
  never a score.
- **A regex cannot tell "did it recommend X" from "does the word X appear."** An assert forbidding
  `/Administrator.*(바인딩|사용)/` failed on *"Administrator 바인딩은 어떤 경우에도 하지 않습니다"* —
  the correct warning. 9 of 61 asserts failed that way. Every prose judgement is now a `judge`
  assert; regex is for structural facts only (`select=`, a literal header name).
- **The harness can punish the behaviour under test.** The plan-only wrapper told the agent not to
  ask the user anything, while `weegloo-resource-deletion` requires confirmation before deleting
  what the user did not name. Destructive confirmation is now an explicit exception in the wrapper.
- **A pointer is not a Verdict.** Phase 4 replaced a concrete deletion-order enumeration in
  `global-rules` with "a parent is refused while a dependant exists (codes and order: the …rule)".
  The detail was still in another **always-loaded** rule, and the fixture still fell from 100% to
  40%. Restoring `Content → Media → ContentType → Space` fixed it. A table row must be actionable
  on its own; a link buys precision, never correctness.
- **An agent told to "restructure, not rewrite" will rewrite.** Folding the provider skills, one
  normalizer replaced two console steps with forward pointers ("the client-type note below") —
  inside the very block the file tells the agent to paste to the user, where "below" resolves to
  nothing. A user building an Android app would have picked Google's *Android* client type, which
  issues no client secret, and the integration would stall on a blocking input the source file had
  already answered. The same agent also invented launch advice the original deliberately omitted.
  Nothing about the output looked wrong; it read *better*. Only the verifier holding the ORIGINAL
  open caught it — so never run a restructuring pass without one, and keep the originals on disk
  until it has.
- **`perl -i` writes a `.bak` on this machine.** Four accumulated silently across edits. The
  manifest builder's path validation is what surfaced them (`skill file key is not a safe relative
  path: 'SKILL.md.bak'`) — they would otherwise have shipped to every `npx` user as fake skill
  files. Prefer the Edit tool or a Node script; if you must use perl, `-i''` and then check.
- **Splitting a skill breaks the pointers aimed at it.** Moving the `SETTING_*` table into
  `references/` left four sibling skills pointing at a section that no longer existed. The table
  went back into the spine rather than retargeting the siblings — a skill pointing into another
  skill's `references/` is a deeper coupling than the one being removed.

---

## Harness support (decides how far a split may go)

`tests/harness-probe/RESULT.md`. Canaries were placed at the exact paths the installer writes, then
each harness was asked for them.

| | skill body | follows `references/` | rule channel |
|---|---|---|---|
| Claude Code | yes | **yes** | yes |
| Codex | not measured — `codex exec` refused on an expired token | | |
| Antigravity | not measured — no CLI on this machine | | |

An unknown is not a pass, so the split rule stands: **every spine must be self-sufficient for the
single most common path through its skill.** A harness reading only `SKILL.md` must still finish
the ordinary case. Both Phase 3 audits verified this by walking the spines with `references/`
withheld. If Codex and Antigravity are ever confirmed, that constraint can relax and the spines can
shrink further.

Codex needs `codex login` before its half of the probe can run.

---

## What is left

1. **Re-run the fixtures against the drift fixes — this is the one thing blocking the PR.**
   Attempted 2026-09-21 and **measured nothing**: the account's session limit errored all 23
   fixtures (traps 4 and 5 above). The six edits are content changes and nothing content-shaped
   ships unmeasured (*How to measure*, above). They correct always-loaded rules, so a regression is
   unlikely but not excluded — the Phase 4 one was also "obviously safe". The install was restored
   to `develop` afterwards, so the branch must be installed again before the re-run.
2. **Open the PR.** Target **`develop`** — never `latest`/`main`
   ([`.claude/rules/git-workflow.md`](.claude/rules/git-workflow.md)). 24 commits are pushed and
   unmerged.
3. **Optional, not started.** An errors reference carrying only what `docs.weegloo.com` does
   **not** have: the wrong repair an agent reaches for first.

   *Phase 5 is done* — and it corrected two claims this file used to make. The provider bodies were
   **19.3%** shared (9,221 B of 47,775 B), not 54%, and since only one provider body ever loads the
   saving from consolidating them was ~1.3 KB per invoke — nothing. The cost was entirely in the 7
   always-loaded `description`s. The `SUCCEEDED_BY` worry does not apply to a **deletion**: it
   guards a *rename*, and folding into an id users already have introduces no new id, so
   [`update.js:97`](installer-cli/src/update.js:97) auto-adds nothing and
   [`update.js:17`](installer-cli/src/update.js:17) prunes the seven. A rename still needs the map.
4. **Not done, worth knowing:** 8 skill descriptions still contain zero Korean
   (`cda-publish`, `cma-json-patch`, `default-locale`, `delivery-access-token`, `list-pagination`,
   `service-architecture`, `upload-api`, `web-hosting`), and several have 200–400 B of headroom. A
   Korean-only pass would be cheap. This repo's users write Korean; a trigger that only fires in
   English is a gate that does not fire.

## Do not

- Do not split a rule into more files. On Codex every rule is concatenated into one `AGENTS.md`, so
  the saving is exactly zero; on Claude Code the injected bytes are unchanged. Rules get cheaper by
  **deletion**, never by structure.
- Do not add a table-of-links entry point. Three always-loaded indexes already exist (30 skill
  descriptions, the router skill, the routing section of `global-rules`); a fourth does not stop
  the others loading, so it **adds** bytes.
- Do not rename or delete a rule id. `self-update.js:51` force-installs `weegloo-version` and
  `weegloo-terms-consent`; `weegloo-version.mdc` carries four `{{WEEGLOO_*}}` placeholders the
  installer substitutes, and moving that body behind a link makes the substitution a silent no-op —
  breaking the update path for every installed user, which is the channel this work ships through.
- Do not commit a content change you have not measured. If measurement is blocked, say so in the
  commit message; one commit here (`4e4cf83`) shipped that way and was verified later by `900812e`.
