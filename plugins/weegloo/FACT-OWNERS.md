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

**A `forbidden` pattern is only a guard if it has been watched failing.** One that matches nothing
passes the suite perfectly, forever, and reads identically to a row that was deleted — which is
what `scheduler-version-header` did for two phases, with the two halves of its pattern in the
opposite order to the sentence it was written against. `tests/fact-owners-control.mjs` runs every
pattern against a pinned commit whose corpus still holds that defect and fails the row if it stays
silent. Run it whenever a row is added or a pattern is edited; it is not in CI because it builds
git worktrees.

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
- **forbidden**: `updating (any|every|all) resource[^.\n]{0,80}x-weegloo-version` — the always-loaded rule required the header when "updating any resource" while the Scheduler skill correctly said a Scheduler takes none. Still present on `develop` (`weegloo-global-rules.mdc:159`), fixed during Phase 1. The first pattern written here (`x-weegloo-version[^.]{0,60}(any|every|all) resource`) had the two halves in the opposite order to the real sentence and so never matched the defect — an inert row scores exactly like a deleted one, which is why every row is now run against the commit that holds its defect.
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

### script-advanced-flag

- **fact**: A Script search's `advanced` flag picks which STORE the read runs on: `true` (the default) reads a synced copy that trails the writes by about a second; `false` reads the store the writes land in, which has no `fields.*` index. So a search that must see a row written moments ago takes `advanced: false` — **whoever wrote it**, including another Script, and **whatever the `where` touches**: the flag picks the store, not the index, so a filter on indexed `sys.*` axes is no exemption.
- **owner**: `skills/weegloo-script/references/queries-and-iteration.md`
- **mentions**: `advanced: (true|false)`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-script/SKILL.md`
  - `skills/weegloo-script/references/patterns.md`
  - `skills/weegloo-script/references/queries-and-iteration.md`
- **forbidden**: `see a just-written row[^.]{0,90}writes based on what it read` — scopes the exception to a row THIS execution wrote. The *Script A writes → Script B searches for it* case then reads as an ordinary query, stays on the default path, and answers **empty on a clean 200** — no error anywhere, and B looks innocent because B wrote nothing. Present at `da14b30`, fixed at `8a96493`.
- **why**: Four sites state the flag and only the owner states the mechanism (two stores, one lagging). If they diverge on *who* the write came from, every cross-Script and Webhook-triggered read silently loses its row while reading as correct.

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

### put-is-full-replacement

- **fact**: A `PUT` update is ALWAYS a full replacement on CMA and ACMA — a key left out is wiped on a 200. Partial edits go through `PATCH`.
- **owner**: `rules/weegloo-api-endpoints.mdc`
- **mentions**: `full replacement|FULL REPLACEMENT|Partial updates are not supported`
  - `rules/weegloo-api-endpoints.mdc`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-cma-json-patch/SKILL.md`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-scheduler/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
  - `skills/weegloo-service-login-client/references/native-apps.md`
  - `skills/weegloo-space-access-token/SKILL.md`
- **forbidden**: `PUT[^.\n]{0,140}([Pp]artial[^.\n]{0,60}contract|contract[^.\n]{0,60}[Pp]artial)` — the phrasing that was there: present in 2 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: The wrong side was an ALWAYS-loaded rule, so it sat in every session beside the rule it contradicted — and it sent the agent to Swagger to decide, where the `required` arrays (`metadata` and `displayField` omitted) appear to grant exactly the licence it promised. Settled against the OpenAPI specs: 32/39 body-carrying CMA PUTs and 2/2 ACMA PUTs state "Partial updates are not supported"; none states the opposite.

### acma-patch-content-only

- **fact**: PATCH applies to ContentType, Content and Media on CMA, but on ACMA to Content only — ACMA Media has no update endpoint and ContentType is not an ACMA resource.
- **owner**: `skills/weegloo-cma-json-patch/SKILL.md`
- **mentions**: `PATCH[^\n]{0,80}ACMA|ACMA[^\n]{0,80}PATCH`
  - `rules/weegloo-api-endpoints.mdc`
  - `skills/weegloo-cma-json-patch/SKILL.md`
- **forbidden**: `^(?![^\n]*\bCMA\b)[^\n]*\*\*ContentType\*\*, \*\*Content\*\* and \*\*Media\*\* support partial updates` — the phrasing that was there: present in 1 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: The rule listed all three under a section headed "CMA / ACMA" with no plane qualifier, so an ACMA Media PATCH returns 404/405 — which this corpus separately teaches to read as a wrong path or a missing row, sending the agent to debug the URL instead of the plane.

### locale-presence-scoped-by-required

- **fact**: Create-time locale presence is scoped by the field's `required` flag, not by whether the field is populated: a required field needs every non-optional locale, a non-required one has no requirement.
- **owner**: `rules/weegloo-default-locale.mdc`
- **mentions**: `non-optional locale|locale-presence|WGL400006`
  - `rules/weegloo-default-locale.mdc`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-default-locale/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
- **forbidden**: `default locale[^.]{0,60}(mandatory|required)[^.]{0,40}when[^.]{0,25}(the field is populated|you populate)` — the phrasing that was there: present in 1 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: Both halves fail silently in opposite directions — "just the default" is rejected when a second non-optional locale exists, and a valid optional-field payload carrying only `ko-KR` is refused by the agent that believes the default is always mandatory.

### read-fallback-is-opt-in

- **fact**: A delivery read falls back only through the requested locale's own `fallbackCode` chain. There is no automatic backfill from the space default; with no `fallbackCode` the value comes back empty.
- **owner**: `rules/weegloo-default-locale.mdc`
- **mentions**: `fallbackCode|default-locale fallback`
  - `rules/weegloo-default-locale.mdc`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-default-locale/SKILL.md`
  - `skills/weegloo-platform-integration/SKILL.md`
  - `skills/weegloo-resource-deletion/SKILL.md`
- **forbidden**: `(?:subject to|applies|applied|apply|relies on)[^.\n]{0,40}\bdefault[- ]locale fallback\b` — the phrasing that was there: present in 1 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: `cma_CreateLocale` does not require `fallbackCode`, so omitting it is the frictionless default. The page then ships with blank fields on every non-default locale, with no status code and no log line — and the wrong copy told the agent that fallback could not be the cause.

### media-file-url-shape

- **fact**: A Media file URL is flat `fields.file.url` on a default delivery read (CDA/ACDA), and a per-locale bucket `fields.file.{locale}.url` on management (CMA/ACMA) or with `locale=*`.
- **owner**: `skills/weegloo-default-locale/SKILL.md`
- **mentions**: `fields\.file\.url|fields\.file\[locale\]|shape depends on the plane`
  - `rules/weegloo-default-locale.mdc`
  - `skills/weegloo-api-query-optimization/references/master-detail-and-media.md`
  - `skills/weegloo-default-locale/SKILL.md`
- **forbidden**: `file URL from[^\n]{0,40}fields\.file\.\{locale\}` — the phrasing that was there: present in 1 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: Stated without its plane in the one file that owns the Refer→Media→URL pattern, it yields `undefined` on delivery — the page ships a broken img src and `undefined/style3` thumbnails, and the same file points onward at the Media lifecycle, which is the wrong trail.

### script-writes-default-bucket

- **fact**: A Content / Media write puts values in the space default-locale bucket for `localized: false` AND `localized: true` fields alike — a Script included; a required localized field additionally needs every other non-optional locale.
- **owner**: `rules/weegloo-default-locale.mdc`
- **mentions**: `default[- ]locale\*{0,2} bucket|fields\.text\.en-US`
  - `rules/weegloo-default-locale.mdc`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-default-locale/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
- **forbidden**: `default[- ]locale\*{0,2} bucket[\s\S]{0,80}unless[\s\S]{0,40}localized: ?true` — the phrasing that was there: present in 1 file(s) at `c6397c1`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit — a pattern matching nothing passes the suite exactly like a correct one.
- **why**: The skill carved out an exception for exactly the class where the default bucket is mandatory, and contradicted its own two cookbook examples. On a non-required field the create then SUCCEEDS and every delivery read returns empty.
