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

- **fact**: A teardown runs Content → ContentType → Space; Media and WebHosting block only the Space and are independent of the ContentType.
- **owner**: `skills/weegloo-resource-deletion/SKILL.md`
- **mentions**: `WGL422024|teardown is bottom-up|Teardown order`
  - `rules/weegloo-global-rules.mdc`
  - `rules/weegloo-resource-deletion.mdc`
  - `skills/weegloo-resource-deletion/SKILL.md`
  - `skills/weegloo-resource-deletion/references/space-reset.md`
- **forbidden**: `(Media.{0,60}blocks its ContentType|blocks its Space and its ContentType|Content *(→|->) *Media *(→|->) *ContentType|Media.{0,3}before.{0,3}ContentType)` — puts Media in the ContentType dependency chain. `ContentTypeService.deleteContentType` checks `contentRepo.existsBySpaceAndContentType` and nothing else, and `core/model/Media.kt` carries no `contentType` field at all, so a Media never blocks a ContentType. The claim sends the agent hunting Media rows that were never the blocker. Present at `8bd9c85`.
- **why**: This error arrived AS a fix — the previous row forbade the correct chain, and `08-space-teardown` had been rewritten to grade the wrong order as required, so every instrument in the repo agreed with it. Only the server source settles it.

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
- **forbidden**: `updating (any|every|all) resource[^.\n]{0,80}x-weegloo-version` — the always-loaded rule required the header when "updating any resource" while the Scheduler skill correctly said a Scheduler takes none. Present at `3809087` (`weegloo-global-rules`, *Resource Updates*), fixed during Phase 1. The first pattern written here (`x-weegloo-version[^.]{0,60}(any|every|all) resource`) had the two halves in the opposite order to the real sentence and so never matched the defect — an inert row scores exactly like a deleted one, which is why every row is now run against the commit that holds its defect.
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
- **forbidden**: `see a just-written row[^.]{0,90}writes based on what it read` — scopes the exception to a row THIS execution wrote. The *Script A writes → Script B searches for it* case then reads as an ordinary query, stays on the default path, and answers **empty on a clean 200** — no error anywhere, and B looks innocent because B wrote nothing. Present at `0366a88`, fixed at `8a96493`.
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

### shorttext-64-cap

- **fact**: A `ShortText` value stops at **64** characters and a `size` validation can only narrow that — so a length you cannot verify or predict (a provider id, token, URL or hash) is never a `ShortText`, whatever its name suggests; it goes to `LongText` if anything searches or queries it, else `RichText`.
- **owner**: `skills/weegloo-create-content-type/SKILL.md`
- **canary**: `A length you cannot verify or predict is not a `ShortText`.`
- **mentions**: `ShortText[^\n]{0,70}\b64\b|\b64\b[^\n]{0,70}ShortText`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-payment/SKILL.md`
  - `skills/weegloo-payment/variants/kr/SKILL.md`
  - `skills/weegloo-payment/variants/kr/references/stripe.md`
- **why**: No `forbidden` pattern — the corpus has never stated the cap wrongly, and a pattern matching nothing scores exactly like a deleted row (see the header). The drift risk is a second site that keeps the "identifier-like strings → ShortText" half without the "whose length you control" half; that teaches the choice that shipped a broken checkout. `weegloo-address-search` is deliberately **not** listed: it names only the `maxlength` consequence, which is what a non-owner mention should look like.

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

### media-patch-metadata-only

- **fact**: A Media PATCH edits only `title` / `description`, never the file (`/fields/file/…` is `400 WEB400011`); a file is replaced by a PUT whose `file.{locale}.upload` points at a new Upload, which keeps the Media's `sys.id`.
- **owner**: `skills/weegloo-cma-json-patch/SKILL.md`
- **canary**: `PATCH edits metadata only, never the file`
- **mentions**: `only .title. / .description.`
  - `rules/weegloo-api-endpoints.mdc`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-cma-json-patch/SKILL.md`
- **why**: The always-loaded rules sent every partial Media edit to PATCH without qualification, so a file swap was PATCHed onto `/fields/file/{locale}` and refused `WEB400011` *Invalid patch request* — an error that names no cause. Settled against the CMA Media reference: PATCH edits metadata "without reattaching the file", and PUT reattaches it only with an `upload` reference to a new Upload.

### patch-no-test-op

- **fact**: A Weegloo PATCH takes the JSON Patch ops `add` / `remove` / `replace` / `move` / `copy` only; `test` is refused `400 WEB400019` (`details.op: Not supported operation`) on every resource, MCP tool or HTTP alike. A precondition is a read plus `X-Weegloo-Version`, not a `test` op.
- **owner**: `rules/weegloo-global-rules.mdc`
- **canary**: `refused on EVERY Weegloo PATCH`
- **mentions**: `WEB400019|never the .test. op`
  - `rules/weegloo-api-endpoints.mdc`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-cma-json-patch/SKILL.md`
- **forbidden**: `RFC 6902 JSON Patch\*\*(?![^\n]{0,40}\btest\b)` — the always-loaded phrasing with no exception beside it: present in 1 file(s) at `3f1c697`, 0 after the fix. `tests/fact-owners-control.mjs` re-checks that it still fires on that commit.
- **why**: The exception lived only in the skill spine, while both always-loaded rules said "RFC 6902 JSON Patch" with nothing beside it — which licenses every op the RFC defines. An agent PATCHing a ContentType over MCP added a `test` op and got `400 WEB400019` whose only detail is `op: Not supported operation`.

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

### parallel-call-batching

- **fact**: Independent Weegloo MCP calls go out in one parallel batch; only an id dependency, a platform precondition, or two writes to the same resource force a sequential wave.
- **owner**: `rules/weegloo-global-rules.mdc`
- **canary**: `Order the waves, parallelize inside one`
- **mentions**: `in PARALLEL|parallel batch|parallel-batch|parallelize inside one`
  - `rules/weegloo-global-rules.mdc`
  - `skills/weegloo-platform-integration/SKILL.md`
- **why**: The two halves fail in opposite directions and neither announces itself. Serialising costs only wall-clock, so nothing ever flags it; batching a wave that has an ordering constraint fails at the call — or, for two writes to one resource, succeeds and drops the loser's fields, since `PUT` is a full replacement. The router states the bootstrap instance (which ContentTypes and rows depend on which); if a third file starts stating the policy itself, read it against the rule before registering it. No `forbidden` row: no drift has been observed yet, and an unwatched pattern scores exactly like a deleted one.

### locale-param-scope

- **fact**: The `locale` query parameter exists only on `Content` and `Media` reads, and is optional there (omitted ⇒ space default). No other endpoint takes it — `…/locales` and `…/content-types` included — and the CDA/ACDA OpenAPI marking it `required: true` does not license a client-wide helper that appends it to every delivery call.
- **owner**: `skills/weegloo-default-locale/SKILL.md`
- **canary**: `Two resource kinds take`
- **mentions**: `resource kinds take .locale., and nothing else|belongs to .Content. / .Media. reads only|belongs to CONTENT and MEDIA reads only|exists only on CONTENT and MEDIA reads`
  - `rules/weegloo-api-endpoints.mdc`
  - `rules/weegloo-default-locale.mdc`
  - `skills/weegloo-default-locale/SKILL.md`
  - `skills/weegloo-platform-integration/SKILL.md`
- **why**: The owner documented the three *modes* of `locale` and never its *scope*, so the parameter generalised from "a delivery read" to every delivery read — landing most often on `…/locales`, the one URL the router hands the agent verbatim. An ignored query parameter raises nothing, so the wrong URL survives into the product and teaches the call after it. **The skill-only fix did not hold, and the reason is the second half of this fact:** the CDA/ACDA OpenAPI — which `weegloo-api-endpoints.mdc` hands over as canonical for query parameters — declares `locale` `required: true` on the Content and Media reads, so an agent builds one delivery helper that appends it everywhere and `…/locales?limit=20&locale=ja-JP` falls out with the parameter trailing the caller's own `limit`. That inference happens with only the always-loaded rules in context, which is why both rules now carry the verdict and why the scope must be stated as a resource kind, never as a plane. First-party prose was never wrong (`docs.weegloo.com/api/reference/cda/locale.md` says a Locale takes no `locale` parameter); the spec was the sole dissenting artifact. No `forbidden` row: the corpus never stated the scope wrongly, it stated nothing at all, and a pattern matching nothing scores exactly like a deleted one (see the header).

### locale-switcher-runtime-list

- **fact**: A language switcher is built from the Space's `Locale` list read at runtime; when that read fails the fallback is the locale set actually provisioned in that Space, and no path may reduce the switcher below it.
- **owner**: `skills/weegloo-default-locale/SKILL.md`
- **canary**: `degraded mode, not a success`
- **mentions**: `must never shrink the switcher|must not shrink it|actually provisioned in THIS Space`
  - `skills/weegloo-default-locale/SKILL.md`
  - `skills/weegloo-platform-integration/SKILL.md`
- **why**: The router owns "build it from the Locale list at runtime" and the owner states what happens when that read fails — two halves of one instruction. A `catch` returning `[]` or one hard-coded code satisfies the router's half while deleting the feature, and the deletion is silent by construction: nothing throws, no status reaches the page, and the page is indistinguishable from a Space that was never given a second `Locale`. No `forbidden` row yet — no drift has been observed, and an unwatched pattern scores exactly like a deleted one.

### toss-deposit-secret-never-stored

- **fact**: Toss's per-payment 가상계좌 `secret` (it arrives in the Payment object that the confirm and 결제 조회 return) is never stored on any row and never returned to the page; the deposit receiver takes `DEPOSIT_CALLBACK` as a trigger only and asks Toss's 결제 조회 API (`GET /v1/payments/{paymentKey}`) whether the payment is `DONE`.
- **owner**: `skills/weegloo-payment/variants/kr/SKILL.md`
- **canary**: `Never store the Payment object's `secret`, and never `Return` `{ /payment/body }``
- **mentions**: `DEPOSIT_CALLBACK|가상계좌 .secret.`
  - `skills/weegloo-payment/variants/kr/SKILL.md`
  - `skills/weegloo-payment/variants/kr/references/callback-receiver.md`
- **forbidden**: `depositSecret|stored-secret compare|\{ /payload/secret \}` — the stored-copy design: the confirm Script saved the response's `secret` on the buyer's own order row as `depositSecret`, and the receiver compared `{ /payload/secret }` against it under the heading "a stored-secret compare". Present at `ff46d29`, and each of the three alternatives fires there on its own (`depositSecret` in both KR files, the other two in `variants/kr/references/callback-receiver.md`); 0 from `e670b72` on. A correct sentence that names `depositSecret` in order to forbid it trips this row too — write "a stored copy" instead.
- **why**: Toss's own docs verify the deposit against a stored copy of that value, so the defect comes back by following them faithfully. The owner's §4 says why any stored copy reaches the buyer. Whoever holds it can post a `DONE` for an unpaid order to the anonymous receiver, and the receiver answers 200. The failure raises no error and is invisible in test mode. `forbidden` catches only the old names. The canary pins the verdict in the owner. A rewrite that drops or rewords that line, which is how a stored copy would come back under a new field name, fails the canary. A rewrite that keeps the line and stores a copy anyway contradicts the owner, and only reading catches that. `mentions` is there because the likeliest re-entry is a new file describing the Toss deposit webhook from Toss's page (a `weegloo-script` or `weegloo-webhook` example): read such a file against the owner before registering it.

### payment-amount-priced-by-script

- **fact**: The amount a payment is checked against is priced inside a Script from rows the buyer cannot write (a staff-written product ContentType), and the order row that carries it is created by that Script; the buyer's role holds no Create / Edit / Delete / All on orders. A server-side compare against a row the buyer wrote checks the buyer's own number.
- **owner**: `skills/weegloo-payment/SKILL.md`
- **mentions**: `client-reported amount|expected amount|(row|order) the buyer wrote`
  - `skills/weegloo-payment/SKILL.md`
  - `skills/weegloo-payment/variants/kr/SKILL.md`
  - `skills/weegloo-payment/variants/kr/references/stripe.md`
- **forbidden**: `createPendingOrder\(\{[^}\n]*amount|[Ww]rite the order to Weegloo[^.\n]{0,40}(FIRST|BEFORE)|setAmount\(\{ currency: "KRW", value: total|currency and status are[^.]{0,70}from something the PG said|or from the PG's API response|unit_amount": "\{ /order/|/order/fields/stripePriceId|because the buyer wrote the order before .requestPayment.` — the circular check. The page wrote the order row and its amount. On Stripe that was "write the order to Weegloo FIRST" and `createPendingOrder({ orderId, amountMinor, … })`. On Toss it was "Write the order to Weegloo … BEFORE `requestPayment()`", and the widget amount was a page-computed `total`. The Stripe session Script then charged `{ /order/…}` from that row, and the Toss deposit receiver's search relied on the buyer having written the order ("because the buyer wrote the order before `requestPayment`"). Both spines sourced the amount from the PG ("Amount, currency and status are established … from something the PG said", "or from the PG's API response"), which only echoes what the page asked for. Present at `e670b72`, and each of the eight alternatives fires there on its own (in `SKILL.md`, `variants/kr/SKILL.md` and `variants/kr/references/callback-receiver.md`); 0 from `935da28` on. `tests/fact-owners-control.mjs` judges the alternation as a whole, so an alternative edited later must be re-checked on its own. The alternatives are anchored to the old sentences, so a correct sentence such as "whether it was paid comes from something the PG said", or a page helper named `createPendingOrder` that sends no amount, does not trip them. The two `{ /order/…}` alternatives restate the owner's verdict that a price or Price id the session Script takes from the payload or the order is one the buyer picked. A design in which that Script reads an order another Script created drops them in the same change that rewrites that sentence.
- **why**: The old flow looked server-side, so it read as correct: a confirm Script compared the PG's amount with the order row. But the buyer wrote that row and also chose the amount the PG was asked for, so both sides of the compare were the buyer's number and an edited price confirmed with a 200. The failure raises no error in test mode or in production. The default spine and `variants/kr/SKILL.md` are full-replacement versions that state this in their own words (CLAUDE.md §2.8). That is why the row has no canary: a phrase required to appear exactly once fails the moment one version copies the other's sentence, and §2.8 prescribes copying. No test checks that the two versions agree. The payment fixtures in `tests/fixtures/routing/` grade only the version installed for the measuring machine's country (CLAUDE.md §2.8), so the other version is checked only by whoever edits one of them (CLAUDE.md §3.2: edit both). `weegloo-minimal-load.mdc` states the general principle ("an input to be verified, never the truth") without naming a payment's amount source, so it is not listed.

### script-writes-attributed-to-executor

- **fact**: A Script's writes are attributed to the identity it runs as, and `:self` resolves to that same identity, although the authority came from the author: the caller of `/execute`, the author on `/execute/anonymous`, the Scheduler's creator on a cron run, and the `runAs` identity under a Webhook. So a `content` rule under `createdBy :self` with no `contentType` (the usual member default) reaches every Content row a Script wrote for that identity, as if they had written it themselves: give every `Create`, `Edit`, `Delete` or `All` rule a `contentType`, and none of them a type whose rows must hold proof (a balance, an order, a charge).
- **owner**: `skills/weegloo-script/SKILL.md`
- **canary**: `**Attribution & `:self`:** writes are attributed to the **executor**`
- **mentions**: `.createdBy :self.[^.]{0,40}(with no|without a) .contentType.|usual member default|(theirs|buyer's|caller's)\s+by .sys\.createdBy.`
  - `skills/weegloo-payment/SKILL.md`
  - `skills/weegloo-payment/variants/kr/SKILL.md`
  - `skills/weegloo-payment/variants/kr/references/stripe.md`
  - `skills/weegloo-script/SKILL.md`
  - `skills/weegloo-space-role/references/script-permissions.md`
- **forbidden**: `cannot forge a completed job|never needs .Edit. on the .response. field|.:self. Read/Edit/Delete split|\*\*.(Edit|All).\*\*[^|\n]*\| \*\*.":self".\*\* \+ job` — the job recipe gave the user `Edit` on their own job rows, which is this fact's remedy broken on the one type the recipe treated as proof. `weegloo-space-role` → `references/script-permissions.md` put `Edit` beside `Read` and `Delete` under `":self"` on the job type and justified it with "the user's own role never needs `Edit` on the `response` field, so they cannot forge a completed job". Weegloo has no field-level permission, so `Edit` on the row is `Edit` on `response`, and the Script's result is whatever the user last wrote. The spine's Related line summed the recipe up as "`:self` Read/Edit/Delete split". Present at `32c6442`, and each of the four alternatives fires there on its own (three in `references/script-permissions.md`, one in `weegloo-space-role/SKILL.md`); 0 from `d15d1c8` on. The last alternative matches the grant rather than its wording: a table row that puts `Edit` or `All` before a `":self"` + job cell. A correct sentence that quotes the old claim in order to refute it trips this row too — paraphrase it instead.
- **why**: Four files state what the fact means for a role, each for its own rows and in its own words: the order (both payment versions), the wallet and the job flow (the owner), and the job recipe (the role reference). In the job flow the user creates the job row, so a `usual member default` sentence about that row holds without any attribution; what rests on attribution there is the proof row the Script creates, which `runAs: EventUser` makes the user's. The owner is the one file that states the mechanism for every identity a Script runs as. The payment versions restate it for the buyer alone, and the platform reference agrees with the owner (`docs.weegloo.com/api/reference/script/execution-and-limits` → *Execution identity and authorization*; `…/cma/scheduler` → *Status and constraints*; `…/cma/webhook` → *runAs*). The hole raises nothing. The role reads as least-privilege, the Script's write succeeds, and a member who then edits a balance, an order or a result the Script wrote gets a 200 that looks exactly like the Script's own write, since both put the member in `sys.updatedBy`. The canary pins the owner's verdict. The likely rewrite attributes a Script's writes to its author, the natural misreading of a Script that runs with its author's authority, and it would leave the four consequences standing on a premise the owner no longer states. `mentions` would not see it, because the owner still matches, and neither would `forbidden`. The payment versions carry no canary: they are full-replacement copies that CLAUDE.md §2.8 has restate each other (see `payment-amount-priced-by-script`). The regex deliberately misses `weegloo-webhook`'s `runAs` bullet and the anonymous-run and Scheduler lines (in the owner, in `weegloo-script` → `references/verify-callbacks.md`, and in both payment `callback-receiver.md` files): they say whose identity a run carries, not what a role rule then reaches. Content only: the `media` map takes no `contentType` filter (`…/cma/space-role` → *Permission maps*), so the remedy cannot scope a Media a Script creates for the caller, such as the image the owner's external-API job pattern ingests. No corpus file says so yet, and nothing here guards it.

### media-read-by-id-only

- **fact**: Product code reads a Media by `sys.id` only — `…/medias/{id}`, `sys.id[in]`, or `include` off the Content whose `Refer → Media` holds it — and never searches a Media list: not by `title` / `description`, which are console labels, and not by `fields.file.{locale}.mimeGroups`. Whatever the product finds files by (owner, kind, title) is a field of a Content that refers to the Media.
- **owner**: `rules/weegloo-api-endpoints.mdc`
- **mentions**: `read by .?sys\.id.? only`
  - `rules/weegloo-api-endpoints.mdc`
  - `skills/weegloo-api-query-optimization/SKILL.md`
  - `skills/weegloo-create-content-type/SKILL.md`
  - `skills/weegloo-list-pagination/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
  - `skills/weegloo-upload-api/SKILL.md`
- **forbidden**: `mimeGroups=` — the Media-list filter recipe (`fields.file.{locale}.mimeGroups={MimeGroup}`, `fields.file.en-US.mimeGroups=Image`) that taught product code to search Media by a field: the always-loaded rule's *CMA Media list* section, `weegloo-api-query-optimization` §5 and two lines of `weegloo-list-pagination`. Present in 3 file(s) at `d627b62`, 0 after the fix. A sentence that names the filter in order to forbid it does not trip this row as long as it gives the parameter no `=` value.
- **why**: The wrong side was the always-loaded rule, scoped to application code: it told every agent building a gallery or a file box to filter the Media list server-side, and the feature works on the first upload. A Media list has no ContentType scope and its labels are console text, so the feature later breaks with no error. Every restatement is a pointer at the rule's section title, which is what `mentions` matches — a new file that starts describing how to look a Media up must be read against the owner before it is registered. No canary: the verdict is pinned by `GATE-INVENTORY.md`, and the restatements are pointers, not copies.

### market-app-secret-install-input

- **fact**: Packing a Script into a MarketApp leaves its Weegloo resource ids where they are written (the install rewrites them) and ships every `definition.secrets` value as `******`; each installer enters their own value at install, so an installed Script holds the installer's value, never `******`. Only a value that is not a Weegloo resource id belongs in a secret.
- **owner**: `skills/weegloo-market-app/SKILL.md`
- **mentions**: `\*{6}|installer input`
  - `skills/weegloo-market-app/SKILL.md`
  - `skills/weegloo-script/SKILL.md`
- **forbidden**: `arrives with every secret value set to` — the claim that a Script installed from a MarketApp arrives with `******` secrets to fill in by hand. `ScriptPacker` turns every secret into a required install input and `BundleParameterResolver` refuses an install that leaves one unresolved, so the installed Script holds the installer's value. Present in 1 file(s) at `d658092`, 0 after the fix.
- **why**: The Script skill said the opposite of the server, and both copies read plausibly — the agent obeys whichever it loaded: one makes a secret the installer's own input at install, the other a slot to patch by hand afterwards. The verdict lives in `weegloo-market-app`; the Script skill's line is a pointer that agrees with it. No canary: the restatement is a pointer, not a copy.
