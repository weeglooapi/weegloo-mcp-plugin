---
name: weegloo-script
description: Weegloo Script — declarative, statement-based backend endpoints stored in a Space that your frontend calls via POST /execute. A Script runs a sequence of statements (ResourceRead/Find/PageRead, ResourceCreate/Update/Patch/Delete/Publish, Http, SetVar, If/Loop/Parallel/Try, Return) with `{ /pointer }` value expressions, sync (10s) or async (60s, poll by requestId). Call an external API and write the result back into Content/Media from one Script. Also covers the Script `Execute` role permission (scopable to all / caller-created / one specific Script via the `self` Refer filter) and per-plan Script limits. Use when a product must call a third-party API (LLM/image/search/payment) without its own backend, react to a Space event with follow-up work (Webhook + Script), run ordered all-or-nothing multi-step work with Try/catch compensation, do concurrency-safe writes via the sys.version field (optimistic locking, no lost updates), let a low-privilege caller perform ONE privileged operation through author-delegated authority (e.g. append to a Log they cannot otherwise write, or gate an anonymous board's edit/delete on a caller-supplied password checked against a credential store they cannot read), or run any "create a job → poll for the result" flow.
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

## Patterns — recognize when Script is the right tool

Reach for a Script (rather than client-side orchestration, or a Webhook that only POSTs to a URL)
whenever one of these fits. These are the situations an AI agent should map to Script:

1. **Event → external call → follow-up work (Webhook + Script).** React to a Space event by calling a
   third-party API and then *doing something with the result* — write a field, create a record,
   ingest Media. Wire it by pointing a **Webhook's `script`** at the Script (runs automatically on
   e.g. `Content.Publish`), or call `/execute` from the frontend. *Example:* on `Content.Publish`,
   POST the item to a search-index API, then `ResourcePatch` an `indexedAt` value back onto it.
   (`weegloo-webhook`.)
2. **Ordered, all-or-nothing multi-step work.** Steps that must run **in a fixed order and never be
   left half-done** belong in **one** Script, not a chain of separate client calls that can be
   interrupted between steps. Statements run **sequentially, server-side**; wrap the risky middle in
   **`Try`/`catch`/`finally`** to **compensate** (undo) on failure, and via `/execute` +
   poll-by-`requestId` the caller can confirm success or retry the whole unit. *Example:* *reserve
   stock → charge → create order*, with `catch` releasing the reservation if a later step throws.
3. **Concurrency-safe writes with `version` (optimistic locking).** To mutate a shared row without
   **lost updates**, read it (`ResourceRead`/`ResourceFind`), then `ResourcePatch`/`ResourceUpdate`
   passing **`version: "{ /<read>/sys/version }"`**. If another writer changed the row meanwhile the
   version no longer matches and the write **fails with a conflict** — `catch` it and retry
   (re-read → re-apply). *Example:* safely increment a shared counter / like-count / remaining
   inventory under concurrent calls.

   ```jsonc
   { "type": "ResourceRead", "resource": "Content", "target": { "sys": { "id": "{ /payload/id }" } }, "name": "row" },
   { "type": "Try",
     "body": [ { "type": "ResourcePatch", "resource": "Content",
       "target": { "sys": { "id": "{ /row/sys/id }" } },
       "version": "{ /row/sys/version }",
       "fields": { "count": { "en-US": { "+": [ "{ /row/fields/count/en-US }", 1 ] } } } } ],
     "catch": [ { "type": "Return", "value": { "ok": false, "retry": true }, "isError": true, "statusCode": 409 } ] }
   ```
4. **Controlled privilege delegation (act with the author's authority).** A Script runs its inner
   Content/Media ops with the **Script author's** permissions, so it is a **safe, narrow privilege
   grant**: expose a *single* privileged operation to callers who otherwise lack it. Give end users
   only `script.Execute` (ideally pinned to that one Script via the **`self`** filter —
   `weegloo-space-role`); they gain exactly that operation and nothing else. *Example:* end users
   **cannot** write the `Log` (audit/activity) ContentType directly, but a Script `recordEvent`
   **appends** a log entry on their behalf — so they can add entries only *through* the Script (which
   fixes the shape and stamps the caller), yet still cannot read, edit, or delete arbitrary logs.
   Same shape for: increment a protected counter, file a report into a moderation queue they can't
   read, or grant a one-off write into an admin-only collection. (This is the positive side of the
   *author gate* in **Secrets & auth** below — the author needs the real permission; the caller does
   not.)
5. **Secret-gated edit/delete — ownership by a shared secret, not identity.** When the caller has **no
   usable identity** to gate on — anonymous / public callers, so `createdBy :self` means nothing —
   prove ownership with a **caller-supplied secret** the Script checks **server-side** against a store
   the caller **cannot read**. Canonical case: an **anonymous board** — a post is created with a
   `password`, and a later **edit or delete** must re-supply it. Keep the password in a **separate
   credential ContentType** (one row per post: the post id + its password) on which the public role
   has **no `Read`**. The Script, running with its **author's** delegated authority (Pattern 4 +
   *Secrets & auth*), `ResourceFind`s that credential, compares, and **`Return`s an error on
   mismatch** — only a match proceeds to the `ResourcePatch` / delete. Because the comparison happens
   *inside* the Script, the secret store never reaches the client: a caller holding nothing but
   `script.Execute` can neither read another post's password nor skip the gate. No `Http` / ingest ⇒
   it can run **Sync**. (Anonymous callers carry `script.Execute` via a **`SpaceAccessToken`** — the
   Space-scoped token that, with a suitably narrow bound role, authorizes `/execute` for an
   anonymous/public caller with no logged-in Weegloo User; see **`weegloo-space-access-token`**.)

   ```jsonc
   // Edit a post only if the supplied password matches the stored one.
   // Public role holds script.Execute on THIS script only — NOT Read on ct_pw, NOT Edit on ct_post.
   { "type": "ResourceFind", "resource": "Content", "contentType": { "sys": { "id": "ct_pw" } },
     "where": { "postId": { "eq": "{ /payload/postId }" } }, "name": "cred" },
   { "type": "If", "condition": { "or": [
       { "==": [ "{ /cred }", null ] },
       { "!=": [ "{ /cred/fields/password/en-US }", "{ /payload/password }" ] } ] },
     "then": [ { "type": "Return", "isError": true, "statusCode": 403,
                 "value": { "ok": false, "error": "bad-password" } } ] },
   { "type": "ResourcePatch", "resource": "Content", "target": { "sys": { "id": "{ /payload/postId }" } },
     "fields": { "body": { "en-US": "{ /payload/fields/body }" } } },
   { "type": "Return", "value": { "ok": true } }
   ```

   **Delete** reuses the same gate, then — `ResourceDelete` accepts **Draft/Archived only** —
   `ResourceUnpublish` the post (read it first for its `sys.version`) **before** `ResourceDelete`.
   Prefer to **store a client-hashed value, not the raw password** (the Script compares either the
   same way), so the credential store never holds plaintext.

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

Every statement carries a **`type`** (the discriminator — **always include it**) and an optional
**`name`** that binds its result into the context as `{ /<name>/… }` for later statements. On
resource statements, **`resource`** is **`Content` | `Media`**. Statements run top-to-bottom and stop
at `Return`.

### Control flow

- **`If`** — `condition` (JsonLogic → boolean), `then` (statements[]), **`else`** (statements[], optional).
- **`Loop`** — one of **three modes** plus a required cap:
  - `over`: a value expression resolving to an **array** (foreach);
  - `while`: JsonLogic — loops **while true**;
  - `for`: a counted range **`{ "from": int, "to": int, "step"?: int }`**;
  - `maxIterations` (**required** — engine-enforced hard cap), `as` (binding name for the current
    item/index, read as `{ /<as> }`), `body` (statements[]). **No `Http` / Media-ingest inside a loop body.**
- **`Parallel`** — `branches: [[…],[…]]`; branches run **concurrently** and **cannot reference each
  other's** results.
- **`Try`** — `body` (statements[]); **`catch`** (optional, runs on failure — `/error` exposes
  `{ message, statement }`); **`finally`** (optional, **always runs**). Wrap risky HTTP/writes here.
- **`Return`** — `value` (optional value expression), `isError` (bool, default `false`; when `true`
  the value is delivered as the response **`error`** instead of `return`), `statusCode` (default
  `200`). **Terminates** the Script.

### Variables & HTTP

- **`SetVar`** — `var` (variable name; read as `{ /vars/<var> }`), `value` (value expression; may
  reference the variable itself to **accumulate**).
- **`Http`** — `method` (GET/POST/PUT/PATCH/DELETE), `url` (value expression), `headers`
  (`[{ key, value, secret?: bool }]` — **`secret: true`** ⇒ stored **encrypted**, never exposed to
  ServiceUsers, CMA-only), `body` (value expression / JSON), `timeoutMs` (per-call, ≤ 60s cap),
  `retry` (default `0`; retries only when the response **status ≥ 400**; capped at 2),
  `ignoreStatusCode` (default `false`). Binds **`{ status, body }`**. **The response body is capped at
  10 MiB** — a larger response **throws**, failing the statement (an enclosing `Try` catches it via
  `{ /error/message }`, same as any `Http` failure; this size cap is about the body, independent of the
  status code). So never pull large binaries (e.g. raw or base64 image bytes) back through `Http` — have
  the provider return a **URL** and ingest it as Media with `encoding: "url"` (see the external-API job
  pattern). By default a final response
  **status ≥ 400** (after any retries) **fails the statement** — an enclosing `Try` catches it (uncaught
  ⇒ the engine surfaces a **502**). Because a failed statement binds no result, read the failure via
  `catch`'s **`{ /error/message }`** (it carries the status + a body snippet), **not** `{ /<name>/body }`.
  Set **`ignoreStatusCode: true`** to bind `{ status, body }` as-is for **any** status and branch on
  `{ /<name>/status }` yourself. **Forces Async.**

### Resource reads (`requiredAction: Read`; no writes)

All three take **`from`**: **`Current`** (live draft — what CMA/ACMA read; **default**) or
**`Published`** (the published snapshot CDA/ACDA serve).

- **`ResourceRead`** — get one **by id**: `resource`, `target` (`{ sys: { id } }`; `sys.id` is a
  value expression), `from`. Binds the **full resource** under `name` (`{ /name/fields/title/en-US }`);
  a **missing** resource raises an error a `Try` can catch.
- **`ResourceFind`** — **first match or `null`**: `resource`, `contentType` (scopes a Content find;
  Media is space-flat), `where` (filter `field → { op: value }` — Weegloo list-filter operators,
  `:self` supported), `order` (decides which match is "first"), `from`. Branch on existence with
  `{ "==": [ "{ /name }", null ] }` (the find-then-upsert pattern).
- **`ResourcePageRead`** — a **page**: `resource`, `contentType`, `where`, `order`, `limit`
  (**≤ 100**), `cursor` (continuation = the previous result's `next`), `from`. Binds **`{ items, next }`**.

### Resource writes (`requiredAction` per action)

- **`ResourceCreate`** (Create) — `resource`, `contentType` (Content; only `sys.id`), `fields`.
- **`ResourceUpdate`** (Edit) — `target`, `fields` — **full replacement** (Content **or** Media): the
  resource's fields become exactly `fields`; any field/locale you **omit is cleared**. For **Media**,
  the `file` locales you list are **re-ingested** and omitted ones removed.
- **`ResourcePatch`** (Edit) — `target`, `fields` — **partial merge** (Content **or** Media): only the
  named fields — and within each, the named locales — change; everything unmentioned is preserved. A
  bucket set to literal `null` **deletes** it. For **Media**, a named `file` locale with a
  `{ source, encoding }` directive **re-ingests** that locale (`null` deletes it); `title`/
  `description` merge per locale.
- **`ResourceDelete`** (Delete) — `target`. **Draft/Archived items only.** (No `version`.)
- **`ResourcePublish` / `ResourceUnpublish` / `ResourceArchive` / `ResourceUnarchive`** — `target`
  state transitions (each also takes `version`).

**Shared write options:**

| Option | On | Meaning |
|--------|----|---------|
| `fields` | Create/Update/Patch | field-key → locale-map value. **Media** keys are fixed: `title`/`description` (scalar) and `file` = a `{ source, encoding }` **ingest directive**. A `locale → null` entry **deletes** that locale bucket. |
| `locale` | Create/Update/Patch | literal locale code **or** value expression; **omit for the space default locale**. |
| `version` | Update/Patch/Publish/Unpublish/Archive/Unarchive | **optimistic lock** (value expression → Int). Present ⇒ the write applies only if the target's current `sys.version` matches; a mismatch aborts with a **version-conflict error** (catchable by `Try`). Omit ⇒ no check. |
| `publish` | Create/Update/Patch | **default `true`** — publish after the write so CDA/ACDA deliver it; set `false` to keep it a draft. |
| `propagateEvents` | **every write** | **default `false` — a Script's writes are SILENT**: they do **not** emit `EntityEvent`s, so **search indexing and Webhooks do NOT fire** on them. Set `true` (per action) when a write must index the row or trigger other Webhooks. |

**Media ingest** — set `fields.file.{locale} = { "source": "…", "encoding": "url" | "base64" }` on a
Media **`ResourceCreate`**, **`ResourceUpdate`** (re-ingests the listed locales — full replace), or
**`ResourcePatch`** (re-ingests just the named locales). **`encoding`** is **`url`** (the worker
fetches the URL's bytes) or **`base64`** (decodes the value). *(The `Binary` encoding is **rejected**
in Scripts with a `400` — use `url` or `base64`.)* A file ingest **forces Async** and is **banned
inside a `Loop`**. A Media that is still **processing** cannot be updated/patched/deleted (busy), and
publish is refused until all its files are processed.

**Ids are validated:** every `target.sys.id` / `contentType.sys.id` must resolve to a real id token
matching **`^[A-Za-z0-9_-]{1,64}$`** — an unsubstituted placeholder (e.g. `"<POST_ID>"`), quotes, or
whitespace is rejected with a clean **`400`** (NoSQL-injection guard).

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
| Max `Http` **response body** size | **10 MiB** (larger ⇒ statement throws) |
| Async result TTL (poll before it expires) | **~30s** |
| Max result size (the Script `Return` value) | **~10 KB** |
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

> **Large `Http` responses — image / file generation.** The `Http` response body is capped at **10 MiB**
> (see *Statements → Http* and the limits table). A generation API that returns the asset **inline as
> base64** can exceed that and make the call **throw**, so prefer a provider mode that returns a **URL**
> to the generated asset (a tiny JSON response), then hand that URL to the **Media** ingest with
> **`encoding: "url"`** — the ingest worker fetches the bytes on its own path, **not** through the
> 10 MiB `Http` cap. Reserve `encoding: "base64"` for assets you are sure stay well under 10 MiB.

Locale: write Content/Media fields under the **default locale** bucket (`fields.text.en-US`) unless
the field is `localized: true` — see `weegloo-default-locale`.

## Plan limits

The number of Scripts per Space is **plan-limited** (illustrative: Free **3** / Basic **10** / Pro
**50** / Enterprise unlimited). On a limit error (`WGL429*`), do not loop-retry — surface the upgrade
path per `weegloo-global-rules`. Confirm current caps on the pricing page; do not hardcode.

## Related

- `weegloo-webhook` — event triggers that run a Script (or call a URL).
- `weegloo-space-role` — the `script.Execute` permission and `:self` filter.
- `weegloo-space-access-token` — the SpaceAccessToken that carries `script.Execute` for anonymous / public callers (role-scoped).
- `weegloo-create-content-type` / `weegloo-default-locale` — result ContentType fields, locale buckets.
- `weegloo-media-lifecycle` — when an ingested Media is deliverable.
- `weegloo-api-endpoints` — base URLs, vendor JSON, OpenAPI discovery.
- `weegloo-api-query-optimization` — poll a result Content by `sys.id`.
