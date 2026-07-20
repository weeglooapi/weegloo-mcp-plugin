---
name: weegloo-script
description: Weegloo Script — declarative, statement-based backend endpoints stored in a Space that your frontend calls via POST /execute. A Script runs a sequence of statements (ResourceRead/Find/PageRead, ResourceCreate/Update/Patch/Delete/Publish, Http, SetVar, If/Loop/Parallel/Try, Return) with `{ /pointer }` value expressions, sync (10s) or async (60s, poll by requestId). Call an external API and write the result back into Content/Media from one Script. Also covers the Script `Execute` role permission (scopable to all / caller-created / one specific Script via the `self` Refer filter) and per-plan Script limits. Use when a product must call a third-party API (LLM/image/search/payment) without its own backend, compute or transform data server-side, enforce credits/ownership, or run any "create a job → poll for the result" flow.
---

# Weegloo — Script (declarative backend endpoints)

A **Script** is a named, saved sequence of **statements** stored in a Space. Your frontend (or a
Webhook) invokes it by id; the platform runs it server-side and returns a result. It is Weegloo's
way to run **backend logic without hosting a backend** — call external APIs, read/transform/write
Content and Media, enforce credits/ownership, all in one place. A single Script can make an external
`Http` call **and** write the result back with `ResourceCreate`/`ResourcePatch` (and Media ingest) —
see *The external-API job pattern* below.

## When to use

- The product must call a **third-party HTTP API** (LLM, image gen, moderation, search, payment)
  **without** a dedicated backend worker.
- Server-side **compute/transform**: read Content, derive values, write results, all atomically-ish.
- **Ownership / credit** enforcement that must not be client-trusted (charge a wallet, gate by
  `createdBy`, validate input) before doing work.
- Any **"create a job → poll for the result"** flow.

> Base URLs, Accept/vendor-JSON, and OpenAPI/docs discovery live in `weegloo-api-endpoints`.
> Role permission shapes (incl. Script `Execute`) live in `weegloo-space-role`.
> Media readiness (`Published`, file `state`) lives in `weegloo-media-lifecycle`.

## Mental model

- A Script is a **resource** in a Space with a **`definition`**: `{ method, executionMode, statements[] }`.
- The frontend calls **`POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute`** with a JSON
  **payload**; statements read it as **`{ /payload/... }`**.
- **Sync** returns the `Return` value immediately (`200`). **Async** returns **`202` + `requestId`**;
  the caller **polls** `GET …/scripts/{scriptId}/executions/{requestId}` until `200`.
- A **Webhook** can run a Script instead of calling an external URL (event-driven trigger) — its
  `script` field points at the Script. See `weegloo-webhook`.

## Authoring vs execution (which plane)

- **Authoring is CMA-only** — create/read/update/delete a Script with a **Weegloo User** Bearer on
  `https://cma.weegloo.com`. There is **no ACMA authoring**; Service Users do not create Scripts.
- **Execution + polling run on CMA *or* ACMA** — a Service User (ServiceLogin Bearer) executes a
  Script on `https://acma.weegloo.com`; a Weegloo User executes on CMA. Both need the **Script
  `Execute`** permission (below).

### Endpoints

| Op | Method + path | Plane |
|----|----------------|-------|
| List | `GET /v1/spaces/{spaceId}/scripts` | CMA |
| Create | `POST /v1/spaces/{spaceId}/scripts` | CMA |
| Read | `GET /v1/spaces/{spaceId}/scripts/{scriptId}` | CMA |
| Update (full PUT, `X-Weegloo-Version`) | `PUT /v1/spaces/{spaceId}/scripts/{scriptId}` | CMA |
| Delete (immediate; no unpublish) | `DELETE /v1/spaces/{spaceId}/scripts/{scriptId}` | CMA |
| **Execute** | `POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute` | CMA **or** ACMA |
| **Poll (async)** | `GET /v1/spaces/{spaceId}/scripts/{scriptId}/executions/{requestId}` | CMA **or** ACMA |

- The **execute request's HTTP method must match** the Script's **`definition.method`** (e.g. a
  `Post` Script is executed with `POST`).
- Confirm exact request/response schemas against the live OpenAPI (`weegloo-api-endpoints` → docs).
  Authoring over MCP: use the Weegloo `cma_*` Script tools when present (they ship in the **`extra`**
  or **`all`** MCP group — see `weegloo-webhook`/README for group setup). The product frontend calls
  **`/execute`** directly over REST (that is the runtime path, not an agent-only action).

## The `definition`

```jsonc
{
  "name": "charge-and-generate",          // 1–64 chars
  "definition": {
    "method": "Post",                       // Get|Post|Put|Patch|Delete — execute must use this method
    "payloadSchema": { /* optional JSON Schema; the /execute payload is validated against it */ },
    "executionMode": "Async",               // "Sync" | "Async"
    "statements": [ /* run top-to-bottom, stop on Return */ ]
  }
}
```

## Statements

Each statement has a `type`; most may carry a **`name`** so later statements reference its result as
**`{ /<name>/… }`**. `resource` is **`"Content"` | `"Media"`**.

| Statement | Purpose / key fields |
|-----------|----------------------|
| `SetVar` | `var`, `value` → readable as `{ /vars/<var> }` |
| `If` | `condition` (JsonLogic), `then[]`, `else[]` |
| `Loop` | `over` / `while` / `for`, `body[]`, `maxIterations` — **no `Http` inside a loop body** |
| `Parallel` | `branches: [[…],[…]]` concurrent branches |
| `Try` | `body[]`, `catch[]` (has `{ /error/… }`), `finally[]` |
| `Return` | `value`, `isError` (bool), `statusCode` — **terminates** the script |
| `ResourceRead` | one item by id: `resource`, `target`, `name` |
| `ResourceFind` | first match or null: `resource`, `contentType`, `where`, `name` |
| `ResourcePageRead` | paginated: `resource`, `contentType`, `where`, `order`, `limit`, `name` |
| `ResourceCreate` | `resource`, `contentType` (Content), `fields` — **Media file ingest ⇒ Async** |
| `ResourceUpdate` | full PUT: `target`, `version`, `fields` — **file re-ingest ⇒ Async** |
| `ResourcePatch` | partial merge: `target`, `fields` (optional `version`) — **file update ⇒ Async** |
| `ResourceDelete` | `target` — **Draft/Archived only** |
| `ResourcePublish` / `ResourceUnpublish` / `ResourceArchive` / `ResourceUnarchive` | `target` state transitions |
| `Http` | `method`, `url`, `headers[]`, `body`, `timeoutMs`, `name` — **external call ⇒ forces Async** |

**Media ingest inside a Script** = `ResourceCreate` with `resource: "Media"` and
`fields.file.{locale}` = `{ "source": "{ /gen/body/data/0/url }", "encoding": "url" }` (or
`"base64"`) — Weegloo downloads/decodes the bytes and stores a Media asset you can reference.

## Value expressions — `{ /pointer }`

Any string value may embed a pointer. Roots:

| Root | Resolves to |
|------|-------------|
| `/payload` | the JSON body passed to `/execute` — e.g. `{ /payload/fields/prompt }` |
| `/headers` | request HTTP headers — e.g. `{ /headers/authorization }` |
| `/<name>` | the result of an earlier statement with that `name` — e.g. `{ /resp/body/... }`, `{ /post/sys/id }` |
| `/vars/<name>` | a `SetVar` variable — e.g. `{ /vars/total }` |
| `/error` | only inside a `Try` `catch` — e.g. `{ /error/message }` |

- **Single pointer** preserves the source type (`{ /payload/fields/count }` stays a number).
- **Mixed template** concatenates as string (`"page-{ /payload/fields/n }-of-10"`).
- Missing path → **`null`** (single pointer) or **`""`** (mixed). Escape a literal brace as `\{`.
- **JsonLogic** operators in `condition`/`value`: `if`/`?:`, `and`/`or`/`!`/`!!`,
  `==`/`!=`/`===`/`!==`/`<`/`<=`/`>`/`>=`, `+`/`-`/`*`/`/`/`%`, `min`/`max`, `cat`, `in`, `merge`.
  Operands resolve pointers first, then apply the op: `{ "+": [ "{ /vars/n }", 1 ] }`.
  **Not supported:** array iterators `map` / `filter` / `reduce` / `all` / `some` / `none`.

## Sync vs Async, and limits

- **Sync** (`executionMode: "Sync"`): runs on the request path, returns `200` with the `Return`
  value. **≤ 10s.**
- **Async** (`"Async"`): runs in the background, returns `202` + **`requestId`**; poll the
  executions endpoint (`202` = still running, `200` = done: `durationMs`, `statusCode`, and
  `return` or `error`). **≤ 60s.** Async is **forced** whenever the script uses `Http` (ExternalIo),
  Media ingest (MediaIngest), or a long-running op — a Sync script that needs these is rejected.

| Limit | Value |
|-------|-------|
| Sync timeout | **10s** |
| Async timeout | **60s** |
| Max `Http` calls (`maxExternalIo`) | **3** |
| Max `SetVar` | **5** |
| Max statements (nested included) | **15** |
| `Http` retry cap | **2** |
| Per-`Http` `timeoutMs` cap | **60s** |
| Async result TTL (poll before it expires) | **~30s** |
| Max result size | **~10 KB** |
| `Http` inside a `Loop` body | **forbidden** |

**Save-time validation** also enforces: `executionMode` must be `Async` if any statement is
`ExternalIo`/MediaIngest/long-running; statement binding **`name`**s must be non-blank, unique, must
not contain `/` or `~`, and must not be a reserved root (`payload`/`headers`/`vars`/`error`). A
definition that violates a limit or rule is rejected at create/update (`WGL400021`–`WGL400034`).

## Secrets & auth

- Put API keys in **`Http` `headers`** with **`"secret": true`** — secret values are encrypted at
  rest. Never place keys in `payload` or Content fields.
- **Execute authorization:** only the **caller's Script `Execute` permission** is checked at
  `/execute`; missing it → **`403`**. The resource operations *inside* the script then run with the
  **Script author's authority, delegated** — individual resource permissions are **not** re-validated
  per statement at runtime. So a low-privilege end user can execute a Script that performs writes the
  author authorized, without granting that user those writes directly.
- **Author gate (create/edit time — the key gotcha):** because inner ops aren't re-checked at run
  time, the **Script's author must hold an *unconditional* `Allow`** (no `contentType`/`createdBy`/
  `tag` filter) for **each** Content/Media action the Script performs — validated when the Script is
  saved; missing it → **`WGL403015`** (Content **create** may keep a `contentType` filter, the one
  exception). Practically: **author Scripts as an admin / broadly-permissioned Weegloo User.** A
  narrowly-scoped role cannot save a Script that writes outside its filters.
- **Attribution & `:self`:** resource writes are attributed to the **executor** (`sys.createdBy` /
  `updatedBy` = whoever called `/execute`), and **`:self` inside the script resolves to that
  executor** — even though authorization came from the author. So enforce ownership in the Script
  itself with `where: { "createdBy": ":self" }`, since the broad author authority won't do it for you.

## Roles — grant Script `Execute`

`SpaceRole` and `ServiceUserRole` gain a **`script`** permission map (peer to `contentType`,
`content`, `media`). Actions: **`Create`, `Read`, `Edit`, `Delete`, `Execute`, `All`** — `Execute`
is unique to Script (the right to call `/execute`). On `script` the meaningful filters are
**`createdBy`** and **`self`** (`contentType` and `tag` do **not** apply). Scope `Execute` three ways:

| Rule | Meaning |
|------|---------|
| `"Execute": { "Allow": [] }` | may Execute **any** Script in the Space |
| `createdBy :self` | may Execute only Scripts the **caller created** |
| **`self`** = a Script `Refer` | may Execute **exactly that one Script** (least-privilege) |

```json
"script": {
  "Execute": {
    "Allow": [
      { "self": { "sys": { "type": "Refer", "id": "<scriptId>", "targetType": "Script" } } }
    ]
  }
}
```

- The **`self`** filter pins a rule to **one specific Script by reference** — the cleanest way to let
  a group of users run a single backend endpoint without granting "execute any Script." Do **not**
  confuse `self` (this filter — a `Refer` to one entity) with the `createdBy.sys.id: ":self"`
  sentinel (which means "the current caller").
- **End users who call a Script** need `script.Execute` on their role — on the **`ServiceUserRole`**
  (ServiceLogin → ACMA execute) or **`SpaceRole`** (Weegloo User / `DeliveryAccessToken`). Grant
  `Execute` (all / own / one specific), generally **not** `Create`/`Edit`/`Delete` — authoring is an
  admin task.
- Full filter mechanics, `self` vs `:self`, and the author gate: **`weegloo-space-role`**.

## The external-API job pattern

**Goal:** frontend submits input → an external API is called → the result is stored → frontend gets
it. One Script does the whole thing.

1. **Author a Script** (`executionMode: "Async"`, `method: "Post"`) that:
   - optionally validates/charges (`ResourceFind` the caller's wallet by `where: {createdBy: ":self"}`,
     `If` balance check, `ResourcePatch` to deduct — wrap risky steps in `Try`/`catch` to refund),
   - `Http` POSTs to the provider (key in a `secret` header),
   - writes the result back with `ResourceCreate`/`ResourcePatch` (text field, or a **Media** ingest
     for images: `ResourceCreate resource:"Media"` with `file.{locale}.source`+`encoding`),
   - `Return`s a small summary.
2. **Grant `script.Execute`** to the caller's role.
3. **Frontend**: `POST …/scripts/{id}/execute` with the payload → **`202` + `requestId`** → poll
   `GET …/executions/{requestId}` until `200`. (Or, if the Script writes results into a Content row,
   poll that Content by `sys.id` as before — see `weegloo-api-query-optimization`. If that job
   Content is polled on **ACDA / CDA** under a `createdBy :self` role, its ContentType needs
   **`publishWithAuthor: true`**, or the delivery read matches nothing — `weegloo-create-content-type`.)
4. **Event-driven variant**: instead of the frontend calling `/execute`, attach the Script to a
   **Webhook** (`script` Refer, on e.g. `Content.Create`) so it runs automatically — `weegloo-webhook`.

Minimal cookbook (call LLM, write result Content, return id):

```jsonc
{
  "name": "gen", "definition": { "method": "Post", "executionMode": "Async", "statements": [
    { "type": "Http", "method": "POST", "url": "https://api.llm.com/v1/gen",
      "headers": [ { "key": "Authorization", "value": "Bearer sk-…", "secret": true } ],
      "body": { "prompt": "{ /payload/fields/prompt }" }, "timeoutMs": 15000, "name": "resp" },
    { "type": "ResourceCreate", "resource": "Content", "contentType": { "sys": { "id": "ct_result" } },
      "fields": { "text": { "en-US": "{ /resp/body/choices/0/message/content }" } }, "name": "out" },
    { "type": "Return", "value": { "ok": true, "id": "{ /out/sys/id }" } }
  ] }
}
```

Locale: write Content/Media fields under the **default locale** bucket (`fields.text.en-US`) unless
the field is `localized: true` — see `weegloo-default-locale`.

## Plan limits

The number of Scripts per Space is **plan-limited** (illustrative: Free **3** / Basic **10** / Pro
**50** / Enterprise unlimited). On a limit error (`WGL429*`), do not loop-retry — surface the upgrade
path per `weegloo-global-rules`. Confirm current caps on the pricing page; do not hardcode.

## Related

- `weegloo-webhook` — event triggers that run a Script (or call a URL).
- `weegloo-space-role` — the `script.Execute` permission and `:self` filter.
- `weegloo-create-content-type` / `weegloo-default-locale` — result ContentType fields, locale buckets.
- `weegloo-media-lifecycle` — when an ingested Media is deliverable.
- `weegloo-api-endpoints` — base URLs, vendor JSON, OpenAPI discovery.
- `weegloo-api-query-optimization` — poll a result Content by `sys.id`.
