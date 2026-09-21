# tests/ — the instrumentation for the skill/rule restructure

Two instruments, for two different questions.

## `run-fixtures.mjs` — "did the agent get worse?"

The restructure's one hard requirement is that **the agent must not make more mistakes than
it does today**. That is a claim about behavior, so bytes cannot verify it: a byte budget is
satisfied identically by "we deleted a duplicate" and by "we deleted a gate".

This runner puts a real prompt in front of a real agent and asserts on what the agent
**decides**. 23 fixtures / 69 asserts today, 17 Korean and 6 English — the corpus is written
in the languages users actually write in, because a routing trigger that only fires in
English is a gate that does not fire.

```bash
# 1. record the baseline BEFORE deleting anything
node tests/run-fixtures.mjs --out tests/baseline.develop.json

# 2. on every restructure PR
node tests/run-fixtures.mjs --out tests/run.json --compare tests/baseline.develop.json
```

Exit code 1 means an assert that **passed on the baseline now fails** — a regression. The
comparison is per-assert, not on the total, so a PR cannot hide a lost gate behind a gain
somewhere else.

- Fixtures are **plan-only**: every prompt is wrapped with an instruction not to call MCP
  tools or create resources, so a run never touches a real Space.
- Each fixture is a `.mjs` module (regex literals, no escaping pain) with
  `{id, lang, prompt, asserts:[{id, kind, pattern, why}]}`. `kind` is `must_match` or
  `must_not_match`.
- Every assert carries a `why` that states **what breaks in production if this regresses**.
  An assert without a failure story is noise and should be deleted.
- The scorecard records the git ref, sha, dirty flag and corpus byte totals. A score with no
  provenance is meaningless — the whole point is a before/after on the same corpus.

`--dry-run` lists the corpus without spending anything. `--agent-cmd` (or
`WEEGLOO_FIXTURE_AGENT_CMD`) overrides the agent invocation; the default is `claude -p`.

### What the fixtures cover

Weighted toward **silent failures** — the cases where a missing rule produces a
plausible-looking wrong answer rather than an error, because those are the ones an agent
never knows to go look up:

`createdBy :self` (every member can delete every other member's rows) · the
Advanced-Search header (an empty array, reported to the user as "no results") · the CDA
flattened-vs-bucket read shape (`undefined`) · a browser token bound to Administrator ·
publish-after-create (a blank site) · the default-locale bucket on create · Media readiness
before a `Refer` (an image that never loads) · UTC cron · and the anti-question policies
(Maps key, PG choice, SMTP vendor, Kakao postcode key) whose failure mode is a stall.

One fixture — `05-scheduler-version-header` — encodes a **live drift** found during the
survey: `rules/weegloo-global-rules.mdc:159` requires `x-weegloo-version` on "any resource",
while `skills/weegloo-scheduler/SKILL.md:61-62` correctly says a Scheduler takes none. The
always-loaded copy is the wrong one.

## `harness-probe/` — "does this harness load skills at all?"

See [harness-probe/README.md](harness-probe/README.md). It answers four questions about
Codex and Antigravity that decide whether rule content can move into skills at all. **Run it
before Phase 3.**
