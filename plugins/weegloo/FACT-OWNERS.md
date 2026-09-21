# FACT-OWNERS

One fact, one owner. This file names the load-bearing facts that are stated in more than one
place, says which file owns each, and pins the ways the corpus is known to get them wrong.

**Why it exists.** `GATE-INVENTORY.md` asks "is this sentence still present?" — it cannot ask
"do the places that state it agree?" Drift produces no error: both copies parse, both read
plausibly, and the agent obeys whichever one it happened to load. Two such defects were found by
hand, and a third — the teardown order — survived until a behavioral fixture failed on it, because
nothing in CI compares two statements of one fact.

**What each column can and cannot catch.** Stated honestly, because a guard trusted past its reach
is worse than no guard:

| axis | catches | does NOT catch |
|---|---|---|
| `canary` — a phrase that must appear exactly **once** | a copy-paste of the canonical wording into a second file, which then diverges | a restatement in different words — the count stays 1 |
| `mentions` — the exact set of files allowed to discuss the fact | a **new** file starting to state the fact without registration, i.e. growth of the drift surface | a contradiction between two files that are both already registered |
| `forbidden` — phrasings known to be wrong | the specific error coming back, forever, in any file | a *new* way of being wrong that nobody has seen yet |

None of the three compares two statements for agreement — only reading both does, which in this
repo means `tests/fixtures/routing/` (that is what caught the teardown order). **`forbidden` is the
row that earns its keep**: every drift fixed here becomes a permanent regression guard, verified
against the commit where the defect existed. Checked by `installer-cli/test/fact-owners.test.js`.

---

### teardown-order

- **fact**: A teardown runs Content → Media → ContentType → Space; only WebHosting is independent.
- **owner**: `skills/weegloo-resource-deletion/SKILL.md`
- **mentions**: `WGL422024|teardown is bottom-up|Teardown order`
  - `rules/weegloo-global-rules.mdc`
  - `rules/weegloo-resource-deletion.mdc`
  - `skills/weegloo-resource-deletion/SKILL.md`
- **forbidden**: `Content *(→|->) *ContentType *(→|->) *Space` — drops Media from the chain. A Media blocks its ContentType exactly as a Content does, so a ContentType attempted before its Media is refused with `WGL422010`, and the agent then re-reads, re-pages and re-tries the Content list looking for a row that was never the problem. Present at `900812e`, fixed at `1971888`.
- **why**: The always-loaded rule is the copy that wins when they disagree, and it was the wrong one.

### scheduler-version-header

- **fact**: Not every resource is versioned — a Scheduler takes no `x-weegloo-version` header.
- **owner**: `skills/weegloo-scheduler/SKILL.md`
- **mentions**: `x-weegloo-version|X-Weegloo-Version`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-api-query-optimization/SKILL.md`
  - `skills/weegloo-cma-json-patch/SKILL.md`
  - `skills/weegloo-resource-deletion/SKILL.md`
  - `skills/weegloo-scheduler/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
- **forbidden**: `x-weegloo-version[^.]{0,60}(any|every|all) resource` — the always-loaded rule once required the header on "any resource" while the Scheduler skill correctly said a Scheduler takes none. Present at `3809087`, fixed during Phase 1.
- **why**: A header sent where it is not accepted, or omitted where it is required, fails at the call — but the agent debugs the payload rather than the header, because the rule told it the header was universal.

### accept-header-does-not-406

- **fact**: Sending `Accept: application/json` to a Weegloo host is a preference, not a failure — it does not 406.
- **owner**: `rules/weegloo-api-endpoints.mdc`
- **mentions**: `406`
  - `rules/weegloo-api-endpoints.mdc`
- **why**: A skill went on asserting the 406 after the rule retracted it, sending agents to debug a header that was never the cause. Now stated in exactly one place; `mentions` keeps it that way.

### deny-empty-array

- **fact**: `Allow: []` means no filter, but `Deny: []` is not its mirror — it denies everything of that kind.
- **owner**: `rules/weegloo-api-endpoints.mdc`
- **canary**: `an empty **`Deny: []`** is **NOT** its mirror`
- **mentions**: `Deny: \[\]`
  - `rules/weegloo-api-endpoints.mdc`
- **why**: An inverted permission that saves without error. The two halves are only correct together, so a second copy that keeps the `Allow` half and drops the `Deny` half reads as complete and teaches the opposite.

### advanced-search-header

- **fact**: Any `fields.*` filter or `order` needs `X-Weegloo-Advanced-Search: true`; without it the query is exact-match and unindexed.
- **owner**: `skills/weegloo-api-query-optimization/SKILL.md`
- **mentions**: `X-Weegloo-Advanced-Search`
  - `rules/weegloo-global-rules.mdc`
  - `rules/weegloo-minimal-load.mdc`
  - `skills/weegloo-api-query-optimization/SKILL.md`
- **why**: Its absence returns an empty list rather than an error, which the agent reports to the user as "no results". Three sites state it; they must not diverge on whether the header is optional.

### acma-contents-nested

- **fact**: On ACMA every Content operation is nested under its ContentType; the flat `/contents` path does not exist there. CMA, CDA and ACDA expose both forms.
- **owner**: `rules/weegloo-api-endpoints.mdc`
- **mentions**: `content-types/\{contentTypeId\}/contents`
  - `rules/weegloo-api-endpoints.mdc`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-api-query-optimization/SKILL.md`
  - `skills/weegloo-api-query-optimization/references/master-detail-and-media.md`
  - `skills/weegloo-default-locale/SKILL.md`
- **why**: The 404 reads as "the Content is missing" rather than "the path is wrong", so the agent goes looking for data that is there. Five sites state it, including a `references/` file that a spine reader may never open.
