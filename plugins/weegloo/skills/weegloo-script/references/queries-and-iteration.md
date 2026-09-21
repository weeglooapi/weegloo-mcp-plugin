# Searching, iterating, counting — and the run budget

Read this when the Script **searches, iterates or counts** Content, or when it is big enough that the
run budget or a save-time rejection matters. Getting one row by id (`ResourceRead`) and the `where` /
`order` key rules are already complete in `SKILL.md`.

## `ResourceForEach` — iterate every match

`resource`, `contentType` (**required** for Content), `where`, `order`, `from`, `advanced`, `limit`
(optional; omitted ⇒ platform cap **10,000**, declaring above it is rejected at save), `name` (the
**current item**), **`onEach`** (statements[] per item).

- **Binds no result** — a foreach, not a map. Accumulate in `onEach` with `SetVar` + `merge`.
- **The engine pages internally** — no cursor to handle. **External calls are allowed** in `onEach`.
- **Two different ceilings.** The **item** cap: hitting it with matches left **fails the run** (no
  silent truncation). The **time** budget is separate and *is* truncating — a long `onEach` can stop
  partway through the items it was allowed. **Make `onEach` idempotent / resumable**; do not assume
  all-or-nothing.
- **There is no cursor-paging read statement** — iterate with `ResourceForEach`, or fetch a single
  row with `ResourceFind` / `ResourceRead`.
- An **`onEach` block may not be empty** (empty `If`/`Loop`/`Try`/`Parallel` bodies are allowed).

## `ResourceCount` — how many match

`resource` (**`Content` | `ContentType`** only), `contentType` (**required** when counting Content;
ignored for ContentType, which is space-flat), `where` (same filter shape and operators as
`ResourceFind`, `:self` supported; omit it to count everything), `from`, `advanced`, `name`. Binds a
**number** — no resource enters the context.

- **No match binds `0`, not `null`** (where `ResourceFind` binds `null`). Branch with a numeric
  comparison — `{ ">": [ "{ /mine }", 0 ] }` — not a `null` check.
- **No `order` and no `limit`** — it is a total, not a page. Do not approximate a count by reading one
  row with `ResourceFind`, and do not tally by iterating: `ResourceForEach` pays the item cap and a
  per-item time budget for a number the store returns directly.
- **Counting `ContentType` is the one read with no locale defaulting** — a ContentType has no
  localized `fields.*`, so a `where` key is used exactly as written (no automatic default-locale
  suffix, nothing prefixed). `advanced` is ignored there too.
- Permission note: a count is gated like any read, **on the map matching what it counts** — a
  ContentType count needs an unconditional `contentType` `Read` on the author's role, which a
  Content/Media-only role does not carry (`WGL403015` at save).

```jsonc
// how many posts this caller has written — then gate on it
{ "type": "ResourceCount", "resource": "Content", "name": "mine",
  "contentType": { "sys": { "id": "ct_post" } },
  "where": { "createdBy": ":self" } }
{ "type": "If", "condition": { ">=": [ "{ /mine }", 10 ] },
  "then": [ { "type": "Return", "value": "daily post limit reached", "isError": true, "statusCode": 429 } ] }

// how many ContentTypes the Space has
{ "type": "ResourceCount", "resource": "ContentType", "name": "schemaCount" }
```

## `advanced` — which of two read paths a search runs on

Only the three **search** reads take it (`ResourceFind` / `ResourceForEach` / `ResourceCount`); it
does not apply to `ResourceRead`, to Media reads, to a ServiceUser read, or to a `ContentType` count,
so none of those reach the indexed path or its operators. It **defaults to `true`** — keep it there
unless the narrow exception below applies.

**`advanced: true` is the indexed path.** It stays fast however the `where` / `order` is shaped, it
matches **`fields.*`** text by *containing* the term rather than only byte-for-byte, it sorts
dependably on content fields, and it is the only mode where the `regex` and geo `near` / `within`
operators work.

**`advanced: false` reads the store the writes land in, which is indexed on the *system* axes only**
— the `sys.*` facts every resource carries (Space and ContentType, owner, status, tags, references,
recency) plus the `createdBy` convenience. A `where` / `order` confined to those is served from an
index and is fine. **What that store has no index for is `fields.*` — your own content fields.** The
moment a `where` or `order` touches one, the query degrades into a scan: the run gets **very slow and
then times out**. That failure scales with how much content the Space holds, so it will **not** show
up while testing against a handful of rows — it arrives in production. A non-advanced `fields.*`
match is also **exact-equality only**, which under-matches silently (a count simply comes back low)
rather than failing.

**What `advanced: false` buys — the only reason to reach for it.** The indexed path catches up a
moment **after** a write (about a second), so a row written seconds ago may not be matched yet: a
`ResourceFind` can return `null`, a `ResourceCount` can come back one short, and a client's instant
re-query right after a write can look empty. The non-advanced path is exact as of this instant. So
use `advanced: false` **only** where a search must see a just-written row *and* the Script then
writes based on what it read.

**Even in that case, first try to restructure so it can stay `true`** — and usually you can:

- Fetch it **by id** with **`ResourceRead`**. That statement never takes the indexed path at all, so
  it is both exact and unaffected by `advanced`. If you hold the `sys.id`, this is the answer.
- Key the follow-up off the **`sys.id` the write returned** instead of searching for the row again.
- For a read-then-write against a shared row, correctness comes from **`version` optimistic locking**
  (`patterns.md` → *Concurrency-safe writes*), not from the read path.

Only when none of those fit should the search itself drop to `advanced: false`. If its `where` is on
the system axes (a `createdBy`, a status, a tag), that is cheap and you are done. If it has to match
a `fields.*` value, **pair it with the system axes** — the ContentType scope, plus something like
`createdBy: ":self"` — so the unindexed part runs over a small subset instead of the Space.

A `fields.*` the search targets must also be a **search-enabled field type** (`RichText` and `Json`
are not searchable at all) — `weegloo-create-content-type`.

```jsonc
// the default: leave advanced alone, whatever where/order you use
{ "type": "ResourceForEach", "resource": "Content",
  "contentType": { "sys": { "id": "ct_post" } },
  "where": { "fields.title": { "eq": "weegloo" } },
  "order": "-fields.score", "name": "post", "onEach": [ /* … */ ] }

// the exception: this run just wrote the row and must see it — and has no sys.id to read by.
// the fields.* match is unindexed, so createdBy narrows it before that runs.
{ "type": "ResourceFind", "resource": "Content", "name": "fresh",
  "contentType": { "sys": { "id": "ct_job" } },
  "where": { "createdBy": ":self", "fields.token": "{ /payload/token }" },
  "advanced": false }
```

## The complete limits table

| Limit | Value |
|-------|-------|
| Run timeout | **computed** from the declared `timeoutMs` values, then capped by the platform — size the Script to fit it; do not hardcode a number |
| Max statements / max external I/O ops | **per-plan** (never hard-code) |
| Max `SetVar` | **10** |
| Max `Cache` | **5** (none inside `Loop`/`ResourceForEach`) |
| `Http` retry cap | **2** |
| Per-`Http` `timeoutMs` cap | **60s** (omitted ⇒ 30s) |
| Per-`EmailSend` `timeoutMs` cap | **30s** |
| `Loop` `maxIterations` / `ResourceForEach` `limit` cap | **10,000** |
| `EmailSend` recipients (`to`+`cc`+`bcc`) | **50** |
| `Signature` `value` — **resolved** message | **65,536 chars** (over ⇒ statement fails, `422`) |
| `Hash` `value` — **resolved** message | **128 chars** (over ⇒ statement fails, `422`) |
| `Regex` `pattern` — as authored | **128 chars** (rejected at save) |
| `Regex` `value` — **resolved** text | **10,240 chars** (over ⇒ statement fails) |
| Max `Http` **response body** size | **10 MiB** (larger ⇒ statement throws) |
| External calls inside `Loop` / `ResourceForEach` | **allowed** |

**The resolved-length caps are checked when the statement runs, not at save** — they bound the
message a `Signature`/`Hash` actually authenticates and the text a `Regex` scans, and those lengths
are unknown until the pointers resolve. `Signature`'s cap is sized for a real webhook body: the
expression `{ /rawPayload }` is sixteen characters standing for however many kilobytes the caller
sent.

**How the time budget is priced.** Every declared `timeoutMs` adds to it — `Http` counts `1 + retry`
times, `EmailSend` once — while anything that declares no time of its own (store round-trips, Media
ingest, work inside iterations) comes out of the base. Sequences add, `If` takes the wider branch,
`Parallel` the slowest, `Try` adds `body`+`catch`+`finally`, iterations **multiply**. At the platform
cap the budget is **truncated, not rejected** — a big loop is cut off mid-run and the writes it
already made stay made. Split work that cannot fit into runs that can (the job pattern in `SKILL.md`).

## Save-time validation (what is rejected before the Script ever runs)

- `contentType` missing on a Content `ResourceCreate` / `Find` / `ForEach` / `Count`.
- A resource statement other than `ResourceCount` on `resource: "ContentType"`, or a mutation on
  `resource: "ServiceUser"`.
- A `Loop` `maxIterations` or `ResourceForEach` `limit` above **10,000**.
- An empty **`ResourceForEach` `onEach`** block (empty `If`/`Loop`/`Try`/`Parallel` bodies are fine).
- A binding **`name`** that is not `^[a-zA-Z0-9_-]+$` (no `/`, `~`, dots, spaces or other
  punctuation), is duplicated, or shadows a reserved root
  (`payload`/`rawPayload`/`headers`/`now`/`vars`/`error`).
- A **`:self`** filter while **`anonymousCallEnabled`** is true — **`WGL400061`**.
- A `Regex` `pattern` over 128 chars, or one that does not compile (**the whole run fails before any
  statement executes**, including a pattern in a branch that would never be taken).
- The **author gate**: an action the Script performs that the author's role does not `Allow`
  unconditionally — **`WGL403015`** (`SKILL.md` → *Secrets & auth*).
