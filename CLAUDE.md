# CLAUDE.md

This repository is the **Weegloo plugin**: the skills and rules that get installed into a coding
agent's context, plus the `npx` installer that puts them there.

That makes it unusual, and everything below follows from one fact:

> **The artifact is not code. It is the instructions another agent will obey.**
> A wrong line here does not crash — it produces a confident, plausible, wrong answer in somebody
> else's session, with no error anywhere.

So the question asked of every change is never "does it read well?" but **"does the agent behave
the same or better?"** — and that is measured, never asserted.

---

## 1. The corpus

### 1.1 What lives where

| Layer | Path | When it loads | Budget |
|---|---|---|---|
| **Rule** | `plugins/weegloo/rules/*.mdc` | **Every session, verbatim, always** | the whole file is a cost |
| **Skill `description`** | frontmatter of `plugins/weegloo/skills/*/SKILL.md` | **Every session** (all of them) | **≤ 700 B**, enforced |
| **Skill body** | rest of `SKILL.md` | only when that skill is invoked | free at rest |
| **Reference** | `plugins/weegloo/skills/*/references/*.md` | only when the spine points at it | free at rest |

The first two are the **always-loaded budget**. Adding a sentence to a rule taxes every future
session of every user, whether or not they touch Weegloo. Adding a sentence to a `references/` file
costs nothing until someone needs it.

**Depth is capped at three:** `rule` → `SKILL.md` → `references/`. No fourth level.

### 1.2 The one decision that governs placement

Ask: **"If this sentence is missing, does the agent produce a plausible-looking WRONG result, and
not know it?"**

- **Yes → it is a gate. It must be always-loaded** (a rule, or the skill's `description`).
  The agent cannot look up what it does not know it is missing, so a link will never be followed.
  Record it in [`plugins/weegloo/GATE-INVENTORY.md`](plugins/weegloo/GATE-INVENTORY.md).
- **No → it is detail. It goes in a skill body, or a `references/` file.**
  The agent arrives knowing it needs this, so a pointer works.

Worked example. *"CDA serves only published resources"* is a **gate** — without it the agent reads
an empty list and tells the user the data is missing. *"The exact `mimeGroups` enum values"* is
**detail** — the agent knows it needs the list and will go read it.

### 1.3 Tree, not graph

Four constraints, so the corpus can be navigated like a table of contents rather than crawled:

1. **Single owner.** One fact, one authoritative file. Every other mention is a Verdict line that
   *agrees* with it and points at it.
2. **Parent → child links only. No sibling links.** A skill must not point into another skill's
   `references/` — that is a deeper coupling than the one being removed. If two skills need the
   same table, it belongs in the parent both already read, or duplicated deliberately and
   registered in `FACT-OWNERS.md`.
3. **Depth ≤ 3** (§1.1).
4. **Verdict-first.** A table row, or a line that carries a link, must be **actionable without
   opening the link**. A link buys precision; it never buys correctness.

> Constraint 4 is the expensive one. A phase of this project replaced a concrete deletion-order
> list with *"codes and order: the …rule"*. The detail was still in another **always-loaded** rule
> — and the behavioural score for that question fell from 100% to 40%. Restoring the four words
> `Content → Media → ContentType → Space` fixed it.

### 1.4 Rules get cheaper by DELETION, never by structure

Do not split a rule into more files to "organize" it.

- On **Codex** every rule is concatenated into one `AGENTS.md` — the saving is exactly zero.
- On **Claude Code** the injected bytes are unchanged.

The only thing that reduces an always-loaded rule is removing words from it, or moving a
non-gate sentence into a skill.

**Do not add a table-of-contents entry point.** Three always-loaded indexes already exist (the
skill `description`s, the `weegloo-platform-integration` router, and the routing section of
`weegloo-global-rules`). A fourth does not stop the others loading — it *adds* bytes.

---

## 2. Adding or changing a skill

### 2.1 Anatomy

```
plugins/weegloo/skills/<skill-id>/
├── SKILL.md            # frontmatter (name, description) + the spine
├── metadata.json       # {name, version, author, license}
└── references/         # optional; one file per branch the spine does not take
    └── <topic>.md      # no frontmatter; "# Title" then one line on when to read it
```

### 2.2 The `description` is a routing trigger, not a summary

It is always loaded, so every byte competes with every other skill's. Write it as **the words a
user will actually say**, not as a description of the file.

- **≤ 700 B**, enforced by `installer-cli/test/budgets.test.js`.
- **Include Korean trigger phrases.** This repo's users write Korean; a trigger that only fires in
  English is a gate that does not fire. End with a comma-separated Korean run: `결제, 카드결제,
  체크아웃, 환불`.
- Name the **distinctive** thing. If two skills' descriptions are interchangeable, the router opens
  the wrong one and nothing errors.
- Say what it is **not** for, when a neighbouring skill exists.

### 2.3 When to split into `references/`

Split when the spine exceeds roughly **18 KB**, or when a large section serves a branch most
readers never take (a native-app path, a callback receiver, a per-provider console walkthrough).

**The spine must remain self-sufficient for the single most common path through the skill.**
A harness that reads only `SKILL.md` must still finish the ordinary case. Verify this by walking
the spine with `references/` withheld and asking whether the common task completes.

Why the constraint stands: Claude Code was measured following `references/`. **Codex and
Antigravity were not measurable on the test machine.** An unknown is not a pass.

### 2.4 Restructuring is a MOVE, not a rewrite

When moving content between files, preserve the wording that carries meaning — exact console menu
names, field names, URLs, the emphasis. Only remove text the destination's parent **already
states**, and verify that by reading the parent rather than assuming.

> Measured cost of ignoring this: a restructuring pass replaced two Google console steps with
> forward pointers ("the client-type note below") — *inside the block the file tells the agent to
> paste to the user*, where "below" resolves to nothing. A user building an Android app would have
> picked Google's *Android* client type, which issues no client secret, and the integration would
> stall on a blocking input the source file had already answered. The same pass invented launch
> advice the original deliberately omitted. **Only a verifier holding the original open caught it.**

So: **keep the originals until a read-back against them passes**, and have something other than the
author do that read-back.

---

## 3. Adding or changing a rule

A rule is the most expensive place to put a sentence. Before adding one:

1. **Is it a gate (§1.2)?** If not, it belongs in a skill.
2. **Does it already exist somewhere?** Search first. If another file states it, either point at
   that file or register the duplication in `FACT-OWNERS.md` (§4.2) — never leave two unregistered
   copies to drift apart.
3. **Is it a Verdict?** A rule line states the conclusion and the consequence, not the reasoning.
   The reasoning goes in the skill.
4. **Per-file byte cap.** `budgets.test.js` caps each rule individually. Caps are per-**file** on
   purpose: a single total lets one file grow into another's headroom, which is how one rule
   reached 44 KB.

**Never rename or delete a rule id.** `installer-cli/src/self-update.js` force-installs
`weegloo-version` and `weegloo-terms-consent`, and `weegloo-version.mdc` carries `{{WEEGLOO_*}}`
placeholders the installer substitutes — moving that body behind a link makes the substitution a
silent no-op and breaks the update path for every installed user, which is the channel this work
ships through.

---

## 4. The guardrails, and what each one cannot do

`installer-cli/test/` — run with `npm test` in `installer-cli/`.

| File | Catches | Blind to |
|---|---|---|
| `budgets.test.js` | per-file byte caps; `description` ≤ 700 B; every `GATE-INVENTORY.md` sentence still present | whether the words still mean the right thing |
| `fact-owners.test.js` | the three drift axes (§4.2) | a contradiction between two files that are both already registered |
| `manifest.test.js` | a skill subdirectory produces nested manifest keys | — |
| `tests/fixtures/routing/` | **behaviour** — the only thing that can (§5) | anything no fixture asks about |

### 4.1 `GATE-INVENTORY.md`

Sentences whose absence yields a plausible-but-wrong answer. They cannot be demoted to a skill or
put behind a link (§1.2). **Deleting a line from this file is a decision and must show up in a
diff** — the test fails until the inventory is edited too.

### 4.2 `FACT-OWNERS.md` — one fact, one owner

For a load-bearing fact stated in more than one place. Each row names the owner and three axes:

| axis | catches | does NOT catch |
|---|---|---|
| `canary` — a phrase appearing exactly **once** | a copy-paste that later diverges | a restatement in different words |
| `mentions` — the exact file set allowed to discuss it | a **new** file joining the conversation | a contradiction between two registered files |
| `forbidden` — a phrasing known to be wrong | that specific error returning, forever | a *new* way of being wrong |

**`forbidden` is the row that earns its keep.** Every drift fixed becomes a permanent guard.

**A `forbidden` pattern is only a guard if it has been watched failing.** One that matches nothing
passes the suite forever and reads exactly like a deleted row. `tests/fact-owners-control.mjs`
replays every pattern against a **pinned commit** whose corpus still holds that defect and fails
the row if it stays silent. Add a `DEFECT_AT` entry with a **sha** — never a branch name, which
would follow the fix and report every row INERT.

> It found one immediately: `scheduler-version-header` had its pattern's two halves in the opposite
> order to the real sentence, matched nothing on any commit, and sat in a green suite for two
> phases.

---

## 5. Measurement — the gate every content change passes

**Every byte-counting check is satisfied identically by "we deleted a duplicate" and by "we deleted
a gate."** Bytes cannot tell those apart. `tests/run-fixtures.mjs` can.

The fixtures ask a real agent 23 realistic questions and score 69 asserts against a baseline taken
on `develop`. Nothing in `plugins/weegloo/` merges without a run that compares **per assert**.

### 5.1 How to run it

The fixtures measure the **installed** corpus under `~/.claude/`, not the repo. Editing a file
changes nothing until the installer runs.

```bash
npx weegloo@latest --agent claude --location global --branch <your-branch> --update
node tests/run-fixtures.mjs --out tests/run.<name>.json --compare tests/baseline.develop.json --concurrency 8
npx weegloo@latest --agent claude --location global --branch develop --update   # restore afterwards
```

### 5.2 Never convert "could not measure" into "fine"

This cost three separate wrong conclusions. An errored retry, a truncated reply, a fixture not in
the run — each was once scored as evidence.

| Trap | What happens | What to do |
|---|---|---|
| **Piping the runner** | `… \| tail -60` gives you `tail`'s exit status; the runner's one signal is discarded and the shell reports success | run it bare, or `set -o pipefail` |
| **Session limit** | every fixture returns a ~55-char refusal; `MIN_RESPONSE_CHARS` catches it as ERROR | check the reset time first; **delete the scorecard** — a `run.<name>.json` that measured nothing is later read as evidence that it did |
| **Origins mapping** | `--update` reuses the mapping recorded at install; a dev-environment install rewrites every host and drops a rule, so you measure a **third** corpus | check `~/.weegloo/claude/installed.json` → `origins` is null |
| **Merging across versions** | a `--merge` of two different `installedVersion`s describes no single corpus | re-run the whole suite |
| **A stochastic judge** | one failure is not a regression | the runner re-runs (`--confirm-retries`, default 4) and reports a split as FLAKY |

### 5.3 Batching

Measure **per change** when the change touches an **always-loaded rule** — that is where the one
real regression of this project came from, and bisecting it across a batch costs far more than the
run. Skill bodies and `references/` edits may be batched and measured once.

### 5.4 A passing test proves nothing until you have watched it fail

Two controls, neither in CI (each costs something CI does not have):

- `tests/negative-control.mjs` — does a **judge assert** still reject a wrong answer? One sample
  **per failure mode**: a rewrite once accepted the very defect it exists to catch and still passed
  a control, because that control's wrong answer was wrong in a *different* way.
- `tests/fact-owners-control.mjs` — does a **`forbidden` pattern** still match its own defect (§4.2)?

---

## 6. Shipping

### 6.1 Order of operations for any corpus change

1. Read §1.2 and decide **where** the content belongs.
2. Write it. Keep originals until the read-back passes (§2.4).
3. `node scripts/build-installer-manifest.mjs` — **the manifest embeds verbatim copies**; a change
   that skips this ships the old text to every `npx` user.
4. `cd installer-cli && npm test`.
5. Install the branch, run the fixtures, compare, restore `develop` (§5.1).
6. Commit. If measurement was genuinely blocked, **say so in the commit message** rather than
   implying it passed.

### 6.2 Git

- **PRs target `develop`.** Never `latest` or `main`. `gh pr create --base develop`.
  (See [`.claude/rules/git-workflow.md`](.claude/rules/git-workflow.md).)
- Commit messages in this repo are Korean and explain **why**, including what was measured and what
  was not.

### 6.3 Environment notes

- **`perl -i` writes a `.bak` on Windows.** Those files are picked up as skill files and the
  manifest builder rejects them (`skill file key is not a safe relative path`). Prefer the Edit tool
  or a Node script.
- Heredocs in this shell eat backslashes; write a script file instead of inlining a regex.

---

## 7. Where the working state lives

- [`docs/restructure/PLAN.md`](docs/restructure/PLAN.md) — the design this structure came from.
  It is a **plan**, written before the work: where it and this file disagree, this file measured it
  and the plan predicted it. (It claims `grep` uniqueness would have caught both known drifts; §4.2
  is the corrected account.)
- `plugins/weegloo/GATE-INVENTORY.md`, `plugins/weegloo/FACT-OWNERS.md` — the registries of §4.
