---
name: weegloo-script
description: Weegloo Script — declarative, statement-based backend endpoints stored in a Space that your frontend calls via POST /execute. A Script runs a sequence of statements (ResourceRead/Find/ForEach, ResourceCreate/Update/Patch/Delete/Publish/Unpublish/Archive/Unarchive, Http, EmailSend, SetVar, ParseJson, Signature, Hash, Regex, If/Loop/Parallel/Try, Return) with `{ /pointer }` value expressions over the roots /payload, /rawPayload, /headers, /now (seconds|millis|iso), /vars and /error, plus JsonLogic operations (operators take a `$` prefix in data slots such as `fields` / `Http.body`, where a bare key is a field name), sync (10s, fixed) or async (30s base, capped at 180s, poll by requestId). Verify an inbound webhook signature without leaving Sync: Signature (HMAC, constant-time, accepts hex or base64 with no encoding field), Hash (unkeyed digest for schemes that salt the message with a shared secret), Regex (Match/Capture — the only way to cut text apart) and /now for the replay window. Also covers the two resource-level invocation flags — directCallEnabled, and anonymousCallEnabled which opens POST /execute/anonymous to a caller with NO token (runs as the Script's author, Sync only, no :self filter, and the Script itself must verify what it was sent). Call an external API and write the result back into Content/Media from one Script. Also covers the Script `Execute` role permission (scopable to all / caller-created / one specific Script via the `self` Refer filter) and per-plan Script limits. Use when a product must call a third-party API (LLM/image/search/payment) without its own backend, react to a Space event with follow-up work (Webhook + Script), run ordered all-or-nothing multi-step work with Try/catch compensation, do concurrency-safe writes via the sys.version field (optimistic locking, no lost updates), let a low-privilege caller perform ONE privileged operation through author-delegated authority (e.g. append to a Log they cannot otherwise write, or gate an anonymous board's edit/delete on a caller-supplied password checked against a credential store they cannot read), or run any "create a job → poll for the result" flow.
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
       "fields": { "count": { "en-US": { "$+": [ "{ /row/fields/count/en-US }", 1 ] } } } } ],
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
| Delete (no unpublish; **blocked while a Webhook references it**) | `DELETE /v1/spaces/{spaceId}/scripts/{scriptId}` | CMA |
| **Execute** | `POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute` | CMA **or** ACMA |
| **Execute unauthenticated** | `POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute/anonymous` | CMA |
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
  "directCallEnabled": true,              // default true  — may be invoked through /execute at all
  "anonymousCallEnabled": false,          // default false — may ALSO be invoked with no token
  "definition": {
    "method": "Post",                       // Get|Post|Put|Patch|Delete — execute must use this method
    "payloadSchema": { /* optional JSON Schema; the /execute payload is validated against it */ },
    "executionMode": "Async",               // "Sync" | "Async"
    "statements": [ /* run top-to-bottom, stop on Return */ ]
  }
}
```

### Who may invoke it — the two resource-level flags

- **`directCallEnabled`** (default `true`) — when `false` the Script runs **only** as a Webhook's
  linked action and both execute endpoints reject the call with **`WGL422062`**.
- **`anonymousCallEnabled`** (default `false`) — when `true` the Script may **also** be invoked with
  **no token at all**, through **`/execute/anonymous`**. That is the path a third party which cannot
  present a Weegloo token (a payment provider's callback, say) can reach. Leave it off unless you need
  exactly that; the authenticated `/execute` keeps working either way.
  - **It runs as the Script's author.** There is no caller to attribute to, so resource writes get the
    **author** as `sys.createdBy`/`updatedBy`. A presented Bearer token is ignored — use `/execute` to
    run as the caller.
  - **No role permission is consulted.** The Script `Execute` grant gates `/execute`, not this path:
    the flag *is* the authorization decision, made once by whoever saved the Script.
  - Two rules are enforced **when the Script is saved**: it may not use the **`:self`** filter
    (**`WGL400061`** — under anonymity `:self` resolves to the *author*, so an ownership filter written
    for an authenticated caller would silently widen to the author's own rows), and it must be
    **`Sync`** (**`WGL400062`** — an anonymous caller cannot poll an async result). Sync-only means a
    statement that forces Async — `Http`, `EmailSend`, Media ingest, `Loop`, `ResourceForEach` — cannot
    appear in it.
  - ⚠️ **The Script itself is the only thing authenticating the request.** Verify something before
    doing anything: a `Signature` over `{ /rawPayload }` is the usual answer (`weegloo-payment`).
    Anonymous calls also consume the Organization's Script-execution quota, and nothing rate-limits
    them — so an endpoint left open with nothing to verify is both a data risk and a cost risk.

## Statements

Every statement carries a **`type`** (the discriminator — **always include it**) and an optional
**`name`** that binds its result into the context as `{ /<name>/… }` for later statements. On
resource statements, **`resource`** is **`Content` | `Media`**. Statements run top-to-bottom and stop
at `Return`.

### Control flow

- **`If`** — `condition` (JsonLogic → boolean), `then` (statements[]), **`else`** (statements[], optional).
- **`Loop`** — one of **three modes** — `over` (array, foreach) / `while` (JsonLogic) / `for`
  (`{ from, to, step? }`, inclusive) — plus **`name`** (binds the element, the 0-based counter, or the
  counter value, read as `{ /<name> }`), `body`, and `maxIterations` (**optional**; omitted ⇒ platform
  cap **10,000**, declaring above it is rejected at save).
  **External calls ARE allowed in `body`** (`Http`, Media ingest). **Always `Async`** — the budget is
  priced `body × maxIterations`, so a big loop gets cut off mid-run, not rejected.
  **Declare a realistic `maxIterations`.** Omitting it prices the loop at the 10,000-iteration default,
  which truncates immediately; and because the run dies on budget rather than a statement failure, the
  writes already done stay done — **make the body idempotent / resumable** rather than relying on
  `Try`/`catch` compensation.
- **`Parallel`** — `branches: [[…],[…]]`; branches run **concurrently** and **cannot reference each
  other's** results.
- **`Try`** — `body` (statements[]); **`catch`** (optional, runs on failure — `/error` exposes
  `{ message }` only, read as `{ /error/message }`); **`finally`** (optional, **always runs**). Wrap risky HTTP/writes here.
- **`Return`** — `value` (optional value expression), `isError` (bool, default `false`; when `true`
  the value is delivered as the response **`error`** instead of `return`), `statusCode` (default
  `200`). **Terminates** the Script.

### Variables, parsing, HTTP & email

- **`SetVar`** — `var` (variable name; read as `{ /vars/<var> }`), `value` (value expression; may
  reference the variable itself to **accumulate**).
- **`Http`** — `method` (GET/POST/PUT/PATCH/DELETE), `url` (value expression), `headers`
  (`[{ key, value, secret?: bool }]` — **`secret: true`** ⇒ stored **encrypted**, never exposed to
  ServiceUsers, CMA-only), `body` (value expression / JSON), `timeoutMs` (per-call; omitted ⇒ **30s** default, hard cap **60s**),
  `retry` (default `0`; retries only when the response **status ≥ 400**; capped at 2),
  `ignoreStatusCode` (default `false`), `responseType` (**`json`** default | `text`).
  Binds **`{ status, body }`**. **`responseType` decides what `body` is:** `json` parses it, so you
  address it with pointers (`{ /resp/body/items/0/id }`), and the statement **fails when the response is
  not JSON**; `text` binds the raw string — what a plain-text / XML / CSV endpoint needs, and what you
  want when you intend to parse it yourself with `ParseJson`. An empty body (e.g. `204`) binds `null`,
  and a **status ≥ 400** body always comes back as-is for diagnostics whatever you declared.
  **The response body is capped at 10 MiB** — a larger response **throws**, failing the statement (an enclosing `Try` catches it via
  `{ /error/message }`, same as any `Http` failure; this size cap is about the body, independent of the
  status code). So never pull large binaries (e.g. raw or base64 image bytes) back through `Http` — have
  the provider return a **URL** and ingest it as Media with `encoding: "url"` (see the external-API job
  pattern). By default a final response
  **status ≥ 400** (after any retries) **fails the statement** — an enclosing `Try` catches it (uncaught
  ⇒ the engine surfaces a **502**). Because a failed statement binds no result, read the failure via
  `catch`'s **`{ /error/message }`** (it carries the status + a body snippet), **not** `{ /<name>/body }`.
  Set **`ignoreStatusCode: true`** to bind `{ status, body }` as-is for **any** status and branch on
  `{ /<name>/status }` yourself. **Forces Async.** Script `Http` draws on the Organization's **webhook
  outbound-network quota** — if that feature is quota-suspended the call fails with a catchable
  **`WGL403012`** (Forbidden), and request bytes are metered against it.
- **`ParseJson`** — turn a **JSON string into a value** you can address with pointers. `value` (the
  text; a value expression), **`name` (required** — the parsed value is the only thing it produces).
  Use it wherever JSON arrives *inside* a string instead of as the body: an LLM's structured output
  (`{ /resp/body/choices/0/message/content }`), a JSON blob kept in a LongText field, or a body you
  took as `responseType: "text"`. Read fields off the binding afterwards — `{ /answer/score }`.
  - **Text that is not JSON fails** the statement — the "LLM answered in prose" case; catch it with
    `Try`. Empty or blank text fails too; the literal `null` parses to `null`.
  - A value that is **already** an object or array is bound unchanged, so it is safe to point at
    something that may or may not still be a string.
  - `value` is a **template** slot — the `$` operator rules do not apply to it.
  - It does no I/O and does not iterate, so unlike `Http` it **never forces Async**.
- **`EmailSend`** — one email through a registered **`EmailAccount`**. `account`
  (`{ "sys": { "id": … } }`), **`to` XOR `toServiceUser`** (exactly one — neither or both is rejected):
  **`to` is a single address** (value expression), **`toServiceUser` is `{ "sys": { "id": … } }`**;
  `cc?`/`bcc?` are **arrays of addresses**; `subject`, `body`, `replyTo?`, `timeoutMs?` (cap **30s**).
  Recipients (`to` 1 + `cc` + `bcc`) cap at **50** — SMTP puts them all in `RCPT TO`, so that sum is
  what the provider counts. **Forces Async**, so it never runs on the Sync `/execute` path.
  - **The sender comes from the `EmailAccount`** (`fromAddress`/`fromName`), not the statement. The
    account must exist first, and **creating one sends a real test email** — see
    **`weegloo-email-account`**.
  - **`body` is always `text/html`** — use `<br>`/`<p>`, not bare newlines. Interpolated values are
    **HTML-escaped** (only the author's markup survives), `SetVar` values included.
  - `subject`/`replyTo`/addresses **reject CR·LF** (header injection). `body` may contain newlines.
  - **Binds nothing, takes no `name`.** Failure **throws with no retry** (email is not idempotent) —
    catch with `Try`.
  - ⚠️ **Never `Return` the SMTP error verbatim** — a rejection quotes the refused address, so on a
    `toServiceUser` send that **leaks a member's email**.

### Verification & text — `Signature`, `Hash`, `Regex`

All three are **pure computation and short-running**, so a Script that only verifies and writes stays
**`Sync`** — which is what lets an inbound webhook receiver answer a real `200` inline. They take a
**required `name`**: the result is their only effect, so one with nothing bound does nothing.

- **`Signature`** — is the code the caller sent the one a keyed hash (HMAC) of the message produces?
  Binds a **`Boolean`**. `algorithm` (`SHA1`|`SHA256`|`SHA384`|`SHA512`), `secret` (value expression),
  `secretEncoding` (`Utf8` **default** |`Hex`|`Base64`), `value` (the message), `expected` (the code
  received). Compared in **constant time**.
  - **There is no output-encoding field, on purpose.** `algorithm` fixes the byte length, and for a
    given length hex and base64 have different string lengths — so `expected` is accepted as **hex
    (either case), base64, or base64url, padded or not**. Do not look for an `encoding` field.
  - **`secretEncoding` is not optional guesswork** — a key issued hex- or base64-encoded is a
    *different key* when used as text, and the code it produces looks valid but never matches.
    Adyen issues hex; Standard Webhooks / PortOne V2 / Svix issue base64.
  - **Failure is split by who supplies the input.** A missing or mismatched `expected` is **`false`**,
    not an error (so a missing header and a wrong one are one outcome); an empty message is
    authenticated as the empty message; only a blank **`secret`** — your own authoring — is a `400`.
  - Sign **`{ /rawPayload }`**, the body exactly as received. A re-serialized object has other bytes.
- **`Hash`** — unkeyed digest, binds the **`String`**. `algorithm` (`MD5`|`SHA1`|`SHA256`|`SHA384`|
  `SHA512` — `MD5` only to reproduce an older scheme), `value`, `encoding` (`Hex` **default**|
  `HexUpper`|`Base64`|`Base64Url`). For schemes that hash a shared secret *with* the message
  (`SHA256(fields… + merchantKey)`, common in Korean PGs) — **there is no `secret` field**: write the
  secret into `value` in whatever position that scheme puts it, which is the only form that expresses
  every position. Compare with `$===`.
- **`Regex`** — how text is taken apart, since the operator vocabulary can join (`cat`) and test
  membership (`in`) but not cut. `mode`: **`Match`** → `Boolean`, **`Capture`** → a **list** (index `0`
  the whole match, `1..n` the capture groups, a group that did not participate `null`) or `null` when
  nothing matched. Read an element by pointer: **`{ /<name>/1 }`**.
  - Both modes ask whether the pattern occurs **anywhere** — anchor with `^…$` for the whole text.
  - **`pattern` is a literal, the one authored field that is NOT a value expression.** `{ /pointer }`
    is not resolved in it. Flags go inline: `(?i)`, `(?s)`.
  - Patterns are compiled **once per run** (a `Regex` in a `Loop` body is not recompiled per lap), and
    an unusable pattern fails the run **before any statement executes** — including one in a branch
    that would never have been taken.

```jsonc
// Stripe-shaped: unpack the packed header, then verify over "{timestamp}.{body}"
{ "type": "Regex", "name": "sig", "mode": "Capture",
  "pattern": "^t=(\\d+),v1=([0-9a-f]{64})$", "value": "{ /headers/stripe-signature }" },
{ "type": "Signature", "name": "verified", "algorithm": "SHA256", "secret": "{ /vars/whsec }",
  "value": "{ /sig/1 }.{ /rawPayload }", "expected": "{ /sig/2 }" },
{ "type": "If", "condition": { "!": "{ /verified }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

Two pointers in one string already concatenate, so a signed message needs **no `$cat`** — reach for
`$cat` only when a piece is a computed value rather than a pointer or literal. Full payment/callback
guidance: **`weegloo-payment`**.

### Resource reads (`requiredAction: Read`; no writes)

All three take **`from`**: **`Current`** (live draft — what CMA/ACMA read; **default**) or
**`Published`** (the published snapshot CDA/ACDA serve).

The two **search** reads (`ResourceFind` / `ResourceForEach`) additionally take **`advanced`** (bool,
default `false`) — **Advanced Search** over Content (see the *Advanced Search* callout below). It does
**not** apply to `ResourceRead` (get-one-by-id never searches) nor to Media reads.

- **`ResourceRead`** — get one **by id**: `resource`, `target` (`{ sys: { id } }`; `sys.id` is a
  value expression), `from`. Binds the **full resource** under `name` (`{ /name/fields/title/en-US }`);
  a **missing** resource raises an error a `Try` can catch.
- **`ResourceFind`** — **first match or `null`**: `resource`, `contentType` (scopes a Content find;
  Media is space-flat), `where` (filter `fields.<name> → { op: value }` — Weegloo list-filter operators,
  `:self` supported; see the key-format note below), `order` (decides which match is "first"), `from`,
  `advanced` (Content **Advanced Search** — set it when `where`/`order` touch `fields.*`; see the callout below). Branch on existence with
  `{ "==": [ "{ /name }", null ] }` (the find-then-upsert pattern).
- **`ResourceForEach`** — **iterate every match**: `resource`, `contentType`, `where`, `order`, `from`,
  `advanced`, `limit` (optional; omitted ⇒ platform cap **10,000**, declaring above it is rejected at
  save), `name` (the **current item**), **`onEach`** (statements[] per item).
  - **Binds no result** — a foreach, not a map. Accumulate in `onEach` with `SetVar` + `merge`.
  - **The engine pages internally** — no cursor to handle. **External calls allowed** in `onEach`.
    **Always `Async`**, `limit` or not.
  - **Two different ceilings.** The **item** cap: hitting it with matches left **fails the run** (no
    silent truncation). The **time** budget is separate and *is* truncating — a long `onEach` can stop
    partway through the items it was allowed. **Make `onEach` idempotent / resumable**; do not assume
    all-or-nothing.
  - **There is no cursor-paging read statement** — iterate with `ResourceForEach`, or fetch a single row
    with `ResourceFind` / `ResourceRead`.

> **`where` / `order` field keys — a content field MUST be `fields.<apiName>`, never the bare name (the
> #1 mistake).** Write **`fields.postId`**, not `postId` — a bare content-field name is not recognized and
> fails with **`WEB400002` "'…' 는 존재하지 않는 필드입니다 / … does not exist"**. The space **default
> locale is applied automatically** to a `fields.<name>` key, so **do not hand-append a locale**: use
> `fields.postId` (default locale) — `postId.ko-KR` and bare `postId` both fail. Only to target a
> **non-default** locale do you write the full `fields.<name>.<locale>` (e.g. `fields.postId.en-US`).
> **Exceptions (no `fields.` prefix):** **`sys.*`** fields (`sys.createdAt`, `sys.status`, …) and the
> **`createdBy`** convenience (with `:self`) are used **as-is**. The same key rules apply to `order`
> tokens — e.g. `order: "-fields.score"` or `"-sys.createdAt"`.
>
> ```jsonc
> // ✅ correct                                  // ❌ wrong — WEB400002
> "where": { "fields.postId": { "eq": "…" } }    "where": { "postId":          { "eq": "…" } }
>                                                 "where": { "postId.ko-KR":    { "eq": "…" } }
> ```

> **Advanced Search — set `advanced: true` whenever `where` / `order` touch `fields.*`.** A plain
> (non-advanced) `ResourceFind` / `ResourceForEach` matches **`fields.*`** by **exact equality only**.
> **Strongly prefer `advanced: true` for any search or sort over a user-defined content field**
> (`fields.<name>`) — that is the mode that supports partial / "contains" text matching, fuzzy search,
> and dependable ordering on content fields. Rule of thumb, by the keys in `where` / `order`:
> - references **any `fields.*`** key → **set `advanced: true`** (Content only).
> - uses **only `sys.*`** (`sys.createdAt`, `sys.status`, …) and/or the `createdBy` convenience → leave
>   `advanced` off (default) — those are served directly, no advanced needed.
>
> **Content only** — `advanced` is ignored on a Media read. (The targeted `fields.*` must also be a
> search-enabled field type — see `weegloo-create-content-type`.)
>
> ```jsonc
> // fields.* in where/order → advanced: true
> { "type": "ResourceForEach", "resource": "Content",
>   "contentType": { "sys": { "id": "ct_post" } },
>   "where": { "fields.title": { "eq": "weegloo" } },   // user field → Advanced Search
>   "order": "-fields.score", "advanced": true,
>   "name": "post", "onEach": [ /* … */ ] }
> // only sys.* / createdBy → advanced not needed:
> // "where": { "createdBy": ":self" }, "order": "-sys.createdAt"
> ```
>
> **A just-created row may not be found via `advanced` immediately.** Advanced Search is served from a
> search index that catches up a short moment **after** a write — typically about a second. So a row you
> just created (or updated) may **not** yet appear in an `advanced` `ResourceFind` / `ResourceForEach`
> run in the **same** flow, or in a client's instant re-query right after the write. When you must read a
> just-written row straight away, fetch it **by id** with **`ResourceRead`** (which reads the primary
> store — no indexing delay) or key the follow-up read off the write's returned `sys.id`. Do **not** rely
> on Advanced Search to surface brand-new rows in the same breath.

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
| `fields` | Create/Update/Patch | field-key → value. If `locale` is **set**, each value is a **bare** value written into that one locale; if `locale` is **omitted**, each value must itself be an explicit **`{ "<locale>": value }` map** (a non-map value ⇒ `400`). **Media** keys are fixed: `title`/`description` (scalar) and `file` = a `{ source, encoding }` **ingest directive**. A `locale → null` entry **deletes** that locale bucket. |
| `locale` | Create/Update/Patch | literal locale code **or** value expression. **Set it** to write bare `fields` values into that single locale; **omit it** and every `fields` value must be a `{ "<locale>": value }` map. Omitting `locale` does **not** default to the space locale. |
| `version` | Update/Patch/Publish/Unpublish/Archive/Unarchive | **optimistic lock** (value expression → Int). Present ⇒ the write applies only if the target's current `sys.version` matches; a mismatch aborts with a **version-conflict error** (catchable by `Try`). Omit ⇒ no check. |
| `publish` | Create/Update/Patch | **default `true`** — publish after the write so CDA/ACDA deliver it; set `false` to keep it a draft. |
| `propagateEvents` | **every write** | **default `false` — a Script's writes are SILENT**: they do **not** emit `EntityEvent`s, so **search indexing and Webhooks do NOT fire** on them. Set `true` (per action) when a write must index the row or trigger other Webhooks. |

**Media ingest** — set `fields.file.{locale} = { "source": "…", "encoding": "url" | "base64" }` on a
Media **`ResourceCreate`**, **`ResourceUpdate`** (re-ingests the listed locales — full replace), or
**`ResourcePatch`** (re-ingests just the named locales). **`encoding`** is **`url`** (the worker
fetches the URL's bytes) or **`base64`** (decodes the value). *(The `Binary` encoding is **rejected**
in Scripts with a `400` — use `url` or `base64`.)* A file ingest **forces Async** and **may** appear
inside a `Loop` `body` / `ResourceForEach` `onEach`. A Media that is still **processing** cannot be updated/patched/deleted (busy), and
publish is refused until all its files are processed.

**Ids are validated:** every `target.sys.id` / `contentType.sys.id` must resolve to a real id token
matching **`^[A-Za-z0-9_-]{1,64}$`** — an unsubstituted placeholder (e.g. `"<POST_ID>"`), quotes, or
whitespace is rejected with a clean **`400`** (NoSQL-injection guard).

## Value expressions — `{ /pointer }`

Any string value may embed a pointer. Roots:

| Root | Resolves to |
|------|-------------|
| `/payload` | the JSON body passed to `/execute` — e.g. `{ /payload/fields/prompt }` |
| `/rawPayload` | that same body as the caller's **own text, before parsing** — the only form a signature can be checked against (`Signature.value`) |
| `/headers` | request HTTP headers, **keys lower-cased** — e.g. `{ /headers/authorization }`, `{ /headers/stripe-signature }` |
| `/now` | when the run started: **`/now/seconds`**, **`/now/millis`** (epoch) and **`/now/iso`** |
| `/<name>` | the result of an earlier statement with that `name` — e.g. `{ /resp/body/... }`, `{ /post/sys/id }` |
| `/vars/<name>` | a `SetVar` variable — e.g. `{ /vars/total }` |
| `/error` | only inside a `Try` `catch` — e.g. `{ /error/message }` |

- **`/now` is read once per run** and shared by `Parallel` branches, so two statements can never
  disagree about "now" — which is what makes it usable in a signed message or a replay window. There
  is **no statement that reads the clock**, and **no zone to choose**: an epoch count is the same
  number everywhere, and `/now/iso` is the same rendering as `sys.createdAt`, so it compares against
  one directly. A replay window is plain arithmetic (a timestamp captured as text is coerced):
  `{ "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] }`.

- **Single pointer** preserves the source type (`{ /payload/fields/count }` stays a number).
- **Mixed template** concatenates as string (`"page-{ /payload/fields/n }-of-10"`).
- Missing path → **`null`** (single pointer) or **`""`** (mixed).
- **Literal brace:** write **`\{`** — that position is then not read as a pointer. Only `{ /… }`-shaped
  substrings (brace, optional space, a `/pointer`, optional space, brace) resolve at all, so other
  braces (e.g. a JSON literal `{"k":…}`) are left as-is and need no escape.
- **JsonLogic** operators: `if`/`?:`, `and`/`or`/`!`/`!!`,
  `==`/`!=`/`===`/`!==`/`<`/`<=`/`>`/`>=`, `+`/`-`/`*`/`/`/`%`, `min`/`max`, `cat`, `in`, `merge`.
  Operands resolve pointers first, then apply the op: `{ "$+": [ "{ /vars/n }", 1 ] }`.
  **Not supported:** array iterators `map` / `filter` / `reduce` / `all` / `some` / `none`.

### `$` on operators — required in data slots

A key like `cat` or `in` is a legitimate **field name**, so where keys belong to your data the
operator needs a **`$` prefix** to be read as an operator:

| Slot | Fields | How keys are read |
|---|---|---|
| **Data** | `fields` (Create/Update/Patch) · `Http.body` · `Return.value` · `SetVar.value` | A key without `$` is **always a field name**. Operators **must** use `$`: `{ "$+": [ … ] }`. |
| **Expression** | `If.condition` · `Loop.while` · `version` | The whole value is an expression — bare (`{ "and": [ … ] }`) and `$` both work. |
| **Template** | everything else — `url`, `method`, `headers[].value`, `locale`, `order`, `over`, `target.sys.id`, `EmailSend.*`, `ParseJson.value` | Plain strings; only `{ /pointer }` applies. |

- Once inside a `$` operation, **nested** operators need no `$` (adding it is still valid).
- **When unsure, prefix every operator with `$`** — it is correct in every slot.
- A data key that really starts with `$` is **doubled**: `"$$ref"` means the field `$ref`.
- **Errors:** an unknown `$` key ⇒ **`WGL400055`**; a `$` operator sharing its object with sibling
  keys ⇒ **`WGL400056`** (an operation must be its object's only key — move sibling data one level out).

```jsonc
"fields": { "cat": { "en-US": "hello" } }                      // data slot: `cat` is a FIELD
"fields": { "n":   { "en-US": { "$+": [ "{ /row/fields/n/en-US }", 1 ] } } }   // compute ⇒ needs $
"condition": { "and": [ { "<": [ "{ /a/body/risk }", 0.5 ] } ] }               // expression slot: bare OK
```

## Sync vs Async, and limits

- **Sync** (`executionMode: "Sync"`): runs on the request path, returns `200` with the `Return`
  value. **≤ 10s.**
- **Async** (`"Async"`): runs in the background, returns `202` + **`requestId`**; poll the
  executions endpoint (`202` = still running, `200` = done: `durationMs`, `statusCode`, and
  `return` or `error`).

**The async budget is computed from the script, not fixed:** **min(30s base + Σ declared
Http/EmailSend `timeoutMs`, 180s cap)**. Anything that declares no time of its own — store
round-trips, Media ingest, work inside iterations — comes out of the base. `Http` counts `1 + retry`
times, `EmailSend` once. Sequences add, `If` takes the wider branch, `Parallel` the slowest, `Try`
adds `body`+`catch`+`finally`, iterations **multiply**. Over the cap the budget is **truncated, not
rejected** — a big loop is cut off mid-run.

**Async is forced** by external I/O (`Http`, `EmailSend`, Media ingest) **or** by `Loop` /
`ResourceForEach` (always, cap or not). Sync needs **every** leaf statement to be a declared
short-running type — an unknown statement type is Async-only by default.

| Limit | Value |
|-------|-------|
| Sync timeout | **10s**, fixed |
| Async timeout | **computed**: `min(30s + Σ declared, 180s)` |
| Max statements / max external I/O ops | **per-plan** (see below) |
| Max `SetVar` | **5** |
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
| Async result TTL (poll before it expires) | **~30s** |
| Max async result size (whole response JSON) | **10 KB** (larger ⇒ replaced by a 500 error) |
| External calls inside `Loop` / `ResourceForEach` | **allowed** (forces Async) |

> **Statement count and external-I/O count are per-plan, not constants — never hard-code them.** When a
> save is rejected for exceeding one, the caller simplifies the Script or upgrades the plan.

**Save-time validation** also enforces: `executionMode` must be `Async` if any statement does external
I/O or iterates; a statement **block may not be empty**; binding **`name`**s must be non-blank, unique,
free of `/` and `~`, and not a reserved root (`payload`/`rawPayload`/`headers`/`now`/`vars`/`error`);
and — when **`anonymousCallEnabled`** is true — no `:self` filter (**`WGL400061`**) and
`executionMode` **`Sync`** (**`WGL400062`**).

**The resolved-length caps above are checked when the statement runs, not at save** — they bound the
message a `Signature`/`Hash` actually authenticates and the text a `Regex` scans, and those lengths are
unknown until the pointers resolve. `Signature`'s cap is sized for a real webhook body: the expression
`{ /rawPayload }` is sixteen characters standing for however many kilobytes the caller sent.

**Deleting a Script is blocked while a Webhook still runs it.** Delete that Webhook first, or point it
at another Script (`weegloo-webhook`).

## Secrets & auth

- Put API keys in **`Http` `headers`** with **`"secret": true`** — secret values are encrypted at
  rest. Never place keys in `payload` or Content fields.
- ⚠️ **`Signature.secret` has no such flag** — a webhook signing secret written into a Script is
  stored as authored and is readable by anyone who can read that Script. Keep Script `Read` off
  end-user roles when a Script carries one.
- **Execute authorization:** only the **caller's Script `Execute` permission** is checked at
  `/execute`; missing it → **`403`**. On **`/execute/anonymous`** no permission is checked at all —
  `anonymousCallEnabled` is the whole decision, and the Script must authenticate its own input.
  The resource operations *inside* the script then run with the
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
   - `ParseJson` when the provider nests its JSON inside a string (LLM structured output),
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

> **Structured output — the result arrives as a string, not as JSON.** Asking an LLM for JSON gets you
> JSON *inside* `content`, so the cookbook's `{ /resp/body/choices/0/message/content }` is one long
> string: pointers into it (`…/content/score`) resolve to nothing and the field is written as raw text.
> Put a `ParseJson` between the call and the write, then address the parsed value:
>
> ```jsonc
> { "type": "ParseJson", "name": "answer", "value": "{ /resp/body/choices/0/message/content }" },
> { "type": "ResourceCreate", "resource": "Content", "contentType": { "sys": { "id": "ct_result" } },
>   "fields": { "score":   { "en-US": "{ /answer/score }" },
>               "summary": { "en-US": "{ /answer/summary }" } }, "name": "out" }
> ```
>
> Wrap it in `Try` — a model that replies in prose instead of JSON fails the `ParseJson`, and `catch`
> is where you record that or `Return` a retryable error.

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
- `weegloo-payment` — PG / MoR integration: the confirm and callback shapes, and what `Signature` /
  `Hash` / `Regex` / `/now` are for in practice.
- `weegloo-space-role` — the `script.Execute` permission and `:self` filter.
- `weegloo-space-access-token` — the SpaceAccessToken that carries `script.Execute` for anonymous / public callers (role-scoped).
- `weegloo-create-content-type` / `weegloo-default-locale` — result ContentType fields, locale buckets.
- `weegloo-media-lifecycle` — when an ingested Media is deliverable.
- `weegloo-api-endpoints` — base URLs, vendor JSON, OpenAPI discovery.
- `weegloo-api-query-optimization` — poll a result Content by `sys.id`.
