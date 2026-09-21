---
name: weegloo-script
description: Weegloo Script — declarative backend endpoints in a Space, run by POST /execute (script.weegloo.com). Use for server logic with no backend: call a third-party API (LLM, image, search, payment) and write the result into Content/Media; react to a Space event (Webhook); verify an inbound webhook signature (HMAC, replay); a token-free anonymous endpoint; ordered all-or-nothing work with rollback; concurrency-safe writes (sys.version); delegating ONE privileged op to a low-privilege caller (anonymous board password gate); job→poll flows; Script Execute permission. 스크립트, 백엔드 없이 서버 로직, 외부 API 호출, 웹훅 서명 검증, 동시성, 권한 위임.
---

# Weegloo — Script (declarative backend endpoints)

A **Script** is a named, saved sequence of **statements** stored in a Space. Your frontend (or a
Webhook) invokes it by id; the platform runs it server-side and returns a result — **backend logic
without hosting a backend**. The everyday shape, documented end to end here, is: **`Http` an external
API → write the answer into Content/Media → `Return` a summary.**

**Use one** for a third-party HTTP API call with no backend worker; server-side compute/transform;
ownership or credit enforcement that must not be client-trusted; a "create a job → poll" flow.
**Not** for work needing none of the server's authority (summing, sorting, formatting over data the
caller already holds) — that is client code, and every run spends the Organization's allowance.

**Other shapes a Script is the right answer for** — read **`references/patterns.md`** when the task
is one of these rather than an outbound API call: ordered **all-or-nothing** multi-step work with
`Try`/`catch` compensation; **concurrency-safe** writes to a shared row (`version` optimistic
locking); **privilege delegation** (a low-privilege caller performs ONE privileged operation);
**secret-gated** edit/delete for anonymous callers (the anonymous-board password gate).

## Mental model — and which plane

- A Script is a **resource** in a Space with a **`definition`**: `{ method, statements[] }`.
- **Authoring is CMA-only** — CRUD it with a **Weegloo User** Bearer on `https://cma.weegloo.com`
  (`/v1/spaces/{spaceId}/scripts[/{scriptId}]`; PUT is full replacement and takes `X-Weegloo-Version`;
  **delete is blocked while a Webhook or Scheduler references it**). There is **no ACMA authoring**.
  Over MCP use the `cma_*` Script tools when present (they ship in the **`extra`** / **`all`** group).
- **Execution has its own host** — **`https://script.weegloo.com`**, whatever identity calls it
  (Weegloo User Bearer, **`SpaceAccessToken`**, or ServiceLogin Bearer); each needs **Script
  `Execute`** on the role that identity resolves to.
  - **`POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute`** — with a JSON **payload**, which
    statements read as `{ /payload/... }`. **The request's HTTP method must match
    `definition.method`.** The frontend calls this directly over REST; that is the runtime path, not
    an agent-only action.
  - **`POST …/scripts/{scriptId}/execute/anonymous`** — the same, with no token at all.
- The run happens **on the request** and the response carries what `Return` produced (`200` by
  default) — from the caller's side an ordinary API call. Nothing is queued and there is nothing to
  poll, so **the time the Script can spend is a design constraint**.
- **The platform also starts Scripts with no caller:** a **Webhook**'s linked action and a
  **Scheduler**'s cron run. Neither goes through `/execute` (so neither is affected by
  `directCallEnabled`) and **neither hands the `Return` value to anyone** — a result that must be kept
  has to be written into Content/Media by the Script. A Scheduler run carries **no `payload` /
  `rawPayload` / `headers`** and is attributed to the **Scheduler's creator** (`:self` = them).

## The `definition`

```jsonc
{
  "name": "charge-and-generate",          // 1–64 chars
  "directCallEnabled": true,              // default true  — may be invoked through /execute at all
  "anonymousCallEnabled": false,          // default false — may ALSO be invoked with no token
  "definition": {
    "method": "Post",                       // Get|Post|Put|Patch|Delete — execute must use this method
    "payloadSchema": { /* optional JSON Schema; the /execute payload is validated against it */ },
    "statements": [ /* run top-to-bottom, stop on Return */ ]
  }
}
```

- **`directCallEnabled: false`** ⇒ the Script runs **only** as a Webhook's action or a Scheduler's
  run; both execute endpoints reject the call with **`WGL422062`**.
- **`anonymousCallEnabled: true`** ⇒ `/execute/anonymous` accepts a caller with **no token**. It runs
  as the **author** (writes attributed to them), **no role permission is consulted** — the flag *is*
  the authorization decision — and a `:self` filter is then rejected at save (**`WGL400061`**).
  ⚠️ The Script itself is the only thing authenticating the request, and anonymous calls still spend
  quota: read **`references/verify-callbacks.md`** before enabling it.

## Statements

Every statement carries a **`type`** (**always include it**) and an optional **`name`** binding its
result as `{ /<name>/… }` for later statements. They run top-to-bottom and stop at `Return`. A
binding `name` must match `^[a-zA-Z0-9_-]+$`, be unique, and not shadow a reserved root
(`payload`/`rawPayload`/`headers`/`now`/`vars`/`error`).

On resource statements **`resource`** is **`Content` | `Media`**, plus two narrow cases:
**`ServiceUser`** is read-only (read statements only; needs the `SETTING_SERVICE_LOGIN` permission)
and **`ContentType`** is **countable only** (`ResourceCount`; anything else is rejected at save).

**A Content statement that does not address its target by id must name the ContentType it works
within.** `ResourceCreate`, `ResourceFind`, `ResourceForEach` and `ResourceCount` each take
**`contentType`** (`{ sys: { id } }`), **required** on `resource: "Content"` — omitting it is
**rejected at save**, not an empty result at run time. There is no Space-wide Content search. Media
is space-flat; the by-id statements carry a `target` instead.

### Control flow

- **`If`** — `condition` (JsonLogic → boolean), `then` (statements[]), `else` (optional).
- **`Loop`** — `over` (array) / `while` (JsonLogic) / `for` (`{ from, to, step? }`, inclusive), plus
  `name` (binds the element for `over`, the **0-based counter** for `while`, the counter value for `for`), `body`, `maxIterations` (omitted ⇒ cap **10,000**). External
  calls **are** allowed in `body`; the budget is priced `body × maxIterations`, so declare a realistic
  `maxIterations` and keep the body **idempotent / resumable** — a run cut off on budget keeps the
  writes it already made. Detail: `references/queries-and-iteration.md`.
- **`Parallel`** — `branches: [[…],[…]]` run **concurrently** and **cannot reference each other's**
  results.
- **`Try`** — `body`; `catch` (optional, on failure — `/error` exposes `{ message }` only);
  `finally` (optional, **always runs**). Wrap risky HTTP/writes here.
- **`Return`** — `value` (optional), `isError` (default `false`; `true` delivers the value as the
  response **`error`** instead of `return`), `statusCode` (default `200`). **Terminates.**

### `Http` — call an external API

`method`, `url` (value expression), `headers` (`[{ key, value, secret?: bool }]` — **`secret: true`**
⇒ stored **encrypted**), `body`, `timeoutMs` (omitted ⇒ **30s**, cap **60s**), `retry` (default `0`,
cap **2**; retries only on status ≥ 400), `ignoreStatusCode` (default `false`), `responseType`
(**`json`** default | `text`). Binds **`{ status, body }`**.

- **A `Content-Type` header decides how `body` is serialized** (no separate field; case- and
  `;charset=`-insensitive). None ⇒ **JSON**. **`application/x-www-form-urlencoded`** ⇒ nested keys
  flattened into brackets (`{"user":{"name":"kim"}}` → `user[name]=kim`), arrays indexed (`tags[0]=a`),
  `null` empty (`memo=`), percent-encoded UTF-8 — what an OAuth **token endpoint** wants.
  **`text/plain`** ⇒ the bare value, unquoted. **Any other declared type keeps its header and sends JSON.** A body the declared type cannot carry is sent under
  one that can**, so the header never describes a body that is not there.
- **`responseType` decides what `body` is:** `json` parses it (`{ /resp/body/items/0/id }`) and
  **fails when the response is not JSON**; `text` binds the raw string (plain-text / XML / CSV, or
  text you will `ParseJson` yourself). An empty body (`204`) binds `null`.
- **A final status ≥ 400 fails the statement** (uncaught ⇒ the engine surfaces **502**). A failed
  statement binds nothing, so read the failure in `catch` via **`{ /error/message }`** (it carries the
  status + a body snippet), **not** `{ /<name>/body }`. `ignoreStatusCode: true` binds
  `{ status, body }` for any status so you branch on `{ /<name>/status }` yourself.
- **Response body cap 10 MiB** — larger **throws** (catchable). Never pull large binaries through
  `Http`: have the provider return a **URL** and ingest it as Media with `encoding: "url"`.
- `Http` draws on the Organization's **webhook outbound-network quota**; suspended ⇒ a catchable
  **`WGL403012`**.

### `ParseJson`, `SetVar`, `Cache`, `EmailSend`

- **`ParseJson`** — turn a **JSON string into a value** you can address with pointers. `value` (the
  text), **`name` required**. Use it wherever JSON arrives *inside* a string: an LLM's structured
  output, a JSON blob in a LongText field, a `responseType: "text"` body. Then read
  `{ /answer/score }`. **Text that is not JSON fails** the statement (the "LLM answered in prose"
  case — catch with `Try`); blank text fails too; a value already an object/array binds unchanged.
- **`SetVar`** — `var` (read as `{ /vars/<var> }`), `value` (may reference itself to **accumulate**).
  Max **10**.
- **`Cache`** — short-lived store **private to one Script**, to skip work it already did. `action`
  `Set`/`Get`/`Delete`; `key` is a **literal, never a value expression** (a caller-chosen key would
  read another caller's run); `ttl` **1–30**s (default 5); `defaultValue` is what `Get` binds on a
  miss (a miss and an expiry are the same thing); **`Get` requires `name`**. Max **5**, and **not
  allowed inside `Loop`/`ResourceForEach`**.
- **`EmailSend`** — one email through a registered **`EmailAccount`** (`weegloo-send-email`).
  `account` (`{ sys: { id } }`), **`to` XOR `toServiceUser`** (exactly one; `to` is a **single
  address**, `toServiceUser` is `{ sys: { id } }`), `cc?`/`bcc?` (**arrays**), `subject`, `body`,
  `replyTo?`, `timeoutMs?` (cap **30s**); recipients (`to`+`cc`+`bcc`) cap at **50**. The **sender
  comes from the account**, not the statement. **`body` is always `text/html`** — use `<br>`/`<p>`,
  and interpolated values are **HTML-escaped**. `subject`/`replyTo`/addresses **reject CR·LF**.
  **Binds nothing, takes no `name`**; failure **throws with no retry** — catch with `Try`.
  ⚠️ **Never `Return` the SMTP error verbatim** — it quotes the refused address, which on a
  `toServiceUser` send **leaks a member's email**.

> **Receiving a signed request** — `Signature` (HMAC, constant-time), `Hash` (unkeyed digest) and
> `Regex` (`Match`/`Capture`, the only way to cut text apart) live in
> **`references/verify-callbacks.md`**. Read it when the Script *receives* a webhook (a payment
> provider's callback) rather than calling out, or before enabling `anonymousCallEnabled`.

### Resource reads (`requiredAction: Read`)

All reads take **`from`**: **`Current`** (live draft, what CMA/ACMA read; **default**) or
**`Published`** (the snapshot CDA/ACDA serve).

- **`ResourceRead`** — get one **by id**: `target` (`{ sys: { id } }`, a value expression), `from`.
  Binds the **full resource** (`{ /name/fields/title/en-US }`); a **missing** one raises an error
  `Try` can catch. It never searches — **if you hold the id, this is the read to use**.
- **`ResourceFind`** — **first match or `null`**: `contentType` (**required** for Content), `where`
  (`fields.<name> → { op: value }`, `:self` supported), `order` (decides which match is "first"),
  `from`, `advanced`. Branch on existence with `{ "==": [ "{ /name }", null ] }` (find-then-upsert).
- **`ResourceForEach`** (iterate every match via `onEach`; binds no result) and **`ResourceCount`**
  (how many match — binds a number, **`0` not `null`** when none, and `ContentType` is countable):
  **`references/queries-and-iteration.md`**, together with `advanced` / Advanced Search in full.

> **`where` / `order` field keys — a content field MUST be `fields.<apiName>`, never the bare name
> (the #1 mistake).** `fields.postId`, not `postId` — a bare content-field name fails with
> **`WEB400002` "'…' does not exist"**. The space **default locale is applied automatically**, so
> **do not hand-append a locale** (`postId.ko-KR` fails too); spell `fields.<name>.<locale>` only for
> a **non-default** locale. **No prefix** on **`sys.*`** keys or the **`createdBy`** convenience
> (with **`:self`** = the executing caller). Same rules for `order` — `"-fields.score"`,
> `"-sys.createdAt"`. Leave **`advanced`** at its `true` default.

### Resource writes (`requiredAction` per action)

- **`ResourceCreate`** — `resource`, `contentType` (**required** for Content; only `sys.id`), `fields`.
- **`ResourceUpdate`** — `target`, `fields` — **full replacement**: any field/locale you **omit is
  cleared** (for **Media**, listed `file` locales are re-ingested, omitted ones removed).
- **`ResourcePatch`** — `target`, `fields` — **partial merge**: only the named fields, and within
  each the named locales, change. A bucket set to literal `null` **deletes** it.
- **`ResourceDelete`** — `target`. **Draft/Archived only.** (No `version`.)
- **`ResourcePublish` / `Unpublish` / `Archive` / `Unarchive`** — `target` transitions (each takes
  `version`).

| Option | On | Meaning |
|--------|----|---------|
| `fields` | Create/Update/Patch | field-key → value. With `locale` **set**, each value is a **bare** value for that locale; with `locale` **omitted**, each value must be an explicit **`{ "<locale>": value }` map** (a non-map ⇒ `400`). **Media** keys are fixed: `title`/`description` (scalar) and `file` = a `{ source, encoding }` ingest directive. `locale → null` **deletes** that bucket. |
| `locale` | Create/Update/Patch | literal code **or** value expression. Omitting it does **not** default to the space locale. |
| `version` | Update/Patch/Publish/Unpublish/Archive/Unarchive | **optimistic lock** (→ Int): the write applies only if `sys.version` matches; a mismatch aborts with a catchable conflict error. Omit ⇒ no check. |
| `publish` | Create/Update/Patch | **default `true`** — publish after the write so CDA/ACDA deliver it; `false` keeps a draft. |
| `propagateEvents` | **every write** | **default `false` — a Script's writes are SILENT**: no `EntityEvent`s, so **search indexing and Webhooks do NOT fire**. Set `true` per action when a write must index the row or trigger other Webhooks. |

**Media ingest** — `fields.file.{locale} = { "source": "…", "encoding": "url" | "base64" }` on a Media
`ResourceCreate` / `ResourceUpdate` (re-ingests the listed locales) / `ResourcePatch` (just the named
ones). **`url`** makes the worker fetch the bytes **outside the 10 MiB `Http` cap**; **`base64`**
decodes the value; **`Binary` is rejected (`400`)**. An ingest **may** sit inside a `Loop` body /
`onEach`. A Media still **processing** cannot be updated/patched/deleted and will not publish
(`weegloo-media-lifecycle`).

**Ids are validated:** every `target.sys.id` / `contentType.sys.id` must match
**`^[A-Za-z0-9_-]{1,64}$`** — an unsubstituted placeholder (`"<POST_ID>"`), quotes or whitespace is
rejected with a clean **`400`** (NoSQL-injection guard).

## Value expressions — `{ /pointer }`

Any string value may embed a pointer. Roots:

| Root | Resolves to |
|------|-------------|
| `/payload` | the JSON body passed to `/execute` — `{ /payload/fields/prompt }` |
| `/rawPayload` | that body as the caller's **own text, before parsing** — the only form a signature can be checked against |
| `/headers` | request headers, **keys lower-cased** — `{ /headers/authorization }` |
| `/now` | when the run started: **`/now/seconds`**, **`/now/millis`**, **`/now/iso`** |
| `/<name>` | an earlier statement's result — `{ /resp/body/... }`, `{ /post/sys/id }` |
| `/vars/<name>` | a `SetVar` variable |
| `/error` | only inside a `Try` `catch` — `{ /error/message }` |

- **Single pointer** preserves the source type (a number stays a number); a **mixed template**
  concatenates as string (`"page-{ /payload/fields/n }-of-10"`) — so two pointers in one string
  already concatenate and need no `$cat`. Missing path → **`null`** (single) / **`""`** (mixed).
  Literal brace: **`\{`** (other braces, e.g. a JSON literal, need no escape).
- **`/now` is read once per run** and shared by `Parallel` branches, so no two statements disagree
  about "now". `/now/iso` is the same rendering as `sys.createdAt`.
- **JsonLogic** operators: `if`/`?:`, `and`/`or`/`!`/`!!`, `==`/`!=`/`===`/`!==`/`<`/`<=`/`>`/`>=`,
  `+`/`-`/`*`/`/`/`%`, `min`/`max`, `cat`, `in`, `merge`, `date`. Operands resolve pointers first:
  `{ "$+": [ "{ /vars/n }", 1 ] }`. **Not supported:** `map`/`filter`/`reduce`/`all`/`some`/`none` —
  iterate with `Loop`, and filter a list by date server-side through `where`.

**`$` on operators — required in data slots.** A key like `cat` or `in` is a legitimate **field
name**, so where keys belong to your data an operator needs a **`$` prefix**:

- **Data slots** — `fields` (Create/Update/Patch) · `Http.body` · `Return.value` · `SetVar.value` ·
  `Cache.value`/`defaultValue`: a key without `$` is **always a field name**; operators **must** use
  `$`.
- **Expression slots** — `If.condition` · `Loop.while` · `version`: the whole value is an expression,
  so bare and `$` both work.
- **Template slots** — everything else (`url`, `headers[].value`, `locale`, `order`, `over`,
  `target.sys.id`, `EmailSend.*`, `ParseJson.value`): plain strings, only `{ /pointer }` applies.
- Nested operators inside a `$` operation need no `$`. **When unsure, prefix every operator with
  `$`** — correct in every slot.

```jsonc
"fields": { "cat": { "en-US": "hello" } }                                     // data slot: `cat` is a FIELD
"fields": { "n":   { "en-US": { "$+": [ "{ /row/fields/n/en-US }", 1 ] } } }  // compute ⇒ needs $
"condition": { "and": [ { "<": [ "{ /a/body/risk }", 0.5 ] } ] }              // expression slot: bare OK
```

> **Dates:** comparison coerces operands to numbers, so date **text is `NaN` and every comparison
> over it is silently `false`** — never compare `"2026-10-03"` directly. Normalize with the **`date`**
> operator, which is also the only way to produce the `iso` form a **Date field accepts on write**.
> Formats, outputs, the before/after/between recipes and operator edge cases (`WGL400055` /
> `WGL400056`, `$$`-escaped field names): **`references/value-expressions.md`** — read it whenever a
> date is compared, stored or arrives in the payload.

## Run budget and limits

A run executes **on the request**, so **how long the Script can take is a design constraint**. The
budget is **computed from the Script** — every declared `timeoutMs` adds (`Http` counts `1 + retry`
times), sequences add, `If` takes the wider branch, `Parallel` the slowest, `Try` adds
`body`+`catch`+`finally`, iterations **multiply** — then **capped by the platform**. At the cap it is
**truncated, not rejected**: a big loop is cut off mid-run and the writes it already made stay made.
Keep an iterating body **idempotent / resumable** and split work that cannot fit.

Everyday caps: `Http` `timeoutMs` **60s** (default 30s), `retry` **2**, response body **10 MiB** ·
`EmailSend` **30s**, 50 recipients · `SetVar` **10** · `Cache` **5** · `Loop` `maxIterations` /
`ForEach` `limit` **10,000**. **Statement count and external-I/O count are per-plan — never
hard-code them.** Full table, the resolved-length caps on `Signature`/`Hash`/`Regex`, and the rest of
save-time validation: **`references/queries-and-iteration.md`**.

Scripts **per Space** are plan-limited, and **executions are a monthly allowance for the whole
Organization** shared with Webhook-run Scripts and every **Scheduler** run — when it is spent, Script
execution is suspended and any Scheduler that comes due is **deactivated**. On a `WGL429*` do not
loop-retry; surface the upgrade path.

## Secrets & auth

- Put API keys in **`Http` `headers`** with **`"secret": true`** — encrypted at rest. Never in
  `payload` or Content fields. ⚠️ **`Signature.secret` has no such flag** — a signing secret written
  into a Script is stored as authored and readable by anyone who can read that Script, so keep Script
  `Read` off end-user roles.
- **Execute authorization:** only the caller's **Script `Execute`** permission is checked at
  `/execute` (missing ⇒ **`403`**); on `/execute/anonymous` nothing is checked. The resource
  operations *inside* run with the **Script author's authority, delegated** — **not** re-validated per
  statement at runtime, which is what lets a low-privilege caller perform writes the author authorized.
- **Author gate (save time — the key gotcha):** because inner ops aren't re-checked at run time, the
  **author must hold an *unconditional* `Allow`** (no `contentType`/`createdBy`/`tag` filter) for
  **each** Content/Media action the Script performs, validated when the Script is saved; missing it ⇒
  **`WGL403015`**. Content **create** may keep a `contentType` filter, the one exception; a
  `ResourceCount` is gated on the map matching what it counts (a **ContentType** count needs
  unconditional `contentType` `Read`). Practically: **author Scripts as an admin.**
- **Attribution & `:self`:** writes are attributed to the **executor** (whoever called `/execute`) and
  **`:self` resolves to that executor**, even though authorization came from the author — so enforce
  ownership in the Script with `where: { "createdBy": ":self" }`; the author's broad authority will
  not do it for you.

**Granting the caller `script.Execute`.** `SpaceRole` and `ServiceUserRole` carry a **`script`**
permission map peer to `content`/`media`, whose actions add **`Execute`** (the right to call
`/execute`). Scope it three ways: `"Execute": { "Allow": [] }` = **any** Script in the Space ·
`createdBy :self` = only Scripts the **caller created** · **`self`** (a `Refer` to one Script) =
**exactly that one Script** — the least-privilege default for exposing a single endpoint. Only
`createdBy` and `self` apply on this map. Grant end users `Execute` only, never
`Create`/`Edit`/`Delete`. Use a **`ServiceUserRole`** for a ServiceLogin caller, a **`SpaceRole`** for
a Weegloo User / `DeliveryAccessToken` / `SpaceAccessToken`.

```json
"script": { "Execute": { "Allow": [
  { "self": { "sys": { "type": "Refer", "id": "<scriptId>", "targetType": "Script" } } }
] } }
```

## The external-API job pattern

**Goal:** frontend submits input → an external API is called → the result is stored → frontend gets
it. One Script does the whole thing.

1. **Author a Script** (`method: "Post"`) that: optionally validates/charges (`ResourceFind` the
   caller's wallet by `where: { "createdBy": ":self" }`, `If` balance check, `ResourcePatch` to
   deduct — wrap risky steps in `Try`/`catch` to refund); `Http` POSTs to the provider (key in a
   `secret` header); `ParseJson` when the provider nests JSON inside a string; writes the result back
   with `ResourceCreate`/`ResourcePatch` (a text field, or a **Media** ingest for images); `Return`s a
   small summary.
2. **Grant `script.Execute`** to the caller's role (above).
3. **Frontend**: `POST …/scripts/{id}/execute` with the payload and read the result off the response.
   **When the provider is too slow for one run**, keep the wait off the request: the frontend creates
   a job Content row, a **`Webhook`** on `Content.Create` runs the Script that calls the provider and
   writes the result back, and the frontend **polls that row by `sys.id`**. If that job Content is
   polled on **ACDA / CDA** under a `createdBy :self` role, its ContentType needs
   **`publishWithAuthor: true`** or the delivery read matches nothing.
4. **Event-driven variant**: attach the Script to a **Webhook** (`script` Refer, on e.g.
   `Content.Create`) so it runs automatically instead of being called.

```jsonc
{
  "name": "gen", "definition": { "method": "Post", "statements": [
    { "type": "Http", "method": "POST", "url": "https://api.llm.com/v1/gen",
      "headers": [ { "key": "Authorization", "value": "Bearer sk-…", "secret": true } ],
      "body": { "prompt": "{ /payload/fields/prompt }" }, "timeoutMs": 15000, "name": "resp" },
    { "type": "ResourceCreate", "resource": "Content", "contentType": { "sys": { "id": "ct_result" } },
      "fields": { "text": { "en-US": "{ /resp/body/choices/0/message/content }" } }, "name": "out" },
    { "type": "Return", "value": { "ok": true, "id": "{ /out/sys/id }" } }
  ] }
}
```

> **Structured output arrives as a string, not as JSON.** Asking an LLM for JSON gets you JSON
> *inside* `content`, so the cookbook's `{ /resp/body/choices/0/message/content }` is one long string
> and pointers into it (`…/content/score`) resolve to nothing. Put a `ParseJson` in between, wrapped
> in `Try` (a model replying in prose fails the parse), then address the parsed value:
>
> ```jsonc
> { "type": "ParseJson", "name": "answer", "value": "{ /resp/body/choices/0/message/content }" },
> { "type": "ResourceCreate", "resource": "Content", "contentType": { "sys": { "id": "ct_result" } },
>   "fields": { "score": { "en-US": "{ /answer/score }" } }, "name": "out" }
> ```

> **Image / file generation:** a provider returning the asset **inline as base64** can blow the
> 10 MiB `Http` cap and make the call throw. Prefer a provider mode that returns a **URL** (a tiny
> JSON response) and hand that URL to the Media ingest with `encoding: "url"`.

Write Content/Media fields under the space **default-locale** bucket (`fields.text.en-US`) — for a
`localized: false` field that is the only bucket there is, and a `localized: true` one still needs it
on create, alongside every **other non-optional locale** the space defines — `weegloo-default-locale`.

## References

- **`references/patterns.md`** — the five non-outbound shapes: all-or-nothing work with compensation,
  `version` optimistic locking, privilege delegation, and the secret-gated anonymous-board
  edit/delete. Read it when the task is one of those rather than an outbound API call.
- **`references/queries-and-iteration.md`** — `ResourceForEach` / `ResourceCount` in full, Advanced
  Search (`advanced`) in full, the limits table and save-time validation. Read it when the Script
  searches, iterates or counts, or is large enough that the run budget matters.
- **`references/verify-callbacks.md`** — `Signature` / `Hash` / `Regex`, the replay window and the
  anonymous endpoint. Read it when the Script *receives* a signed request instead of sending one.
- **`references/value-expressions.md`** — the `date` operator and operator edge cases. Read it
  whenever a date is compared, stored or read out of the payload.

## Related

- `weegloo-webhook` (event triggers) · `weegloo-scheduler` (cron triggers) · `weegloo-payment`
  (PG / MoR confirm and callback shapes) · `weegloo-send-email` (the `EmailAccount` behind
  `EmailSend`).
- `weegloo-space-role` (the `script` map's filters) · `weegloo-space-access-token` (the token that
  carries `script.Execute` for anonymous / public callers).
- `weegloo-create-content-type` / `weegloo-default-locale` (result fields, locale buckets) ·
  `weegloo-media-lifecycle` (when an ingested Media is deliverable) · `weegloo-api-endpoints` (base
  URLs, vendor JSON) · `weegloo-api-query-optimization` (poll a result Content by `sys.id`).
