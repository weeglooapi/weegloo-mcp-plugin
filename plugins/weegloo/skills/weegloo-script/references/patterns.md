# Script patterns — the five non-outbound shapes

Read this when the task is **not** "call an external API and write the result back" (that one is
complete in `SKILL.md`), but one of the shapes below. Each is a situation where client-side
orchestration, or a Webhook that only POSTs to a URL, is the wrong answer.

## 1. Ordered, all-or-nothing multi-step work

Steps that must run **in a fixed order and never be left half-done** belong in **one** Script, not a
chain of separate client calls that can be interrupted between steps. Statements run **sequentially,
server-side**; wrap the risky middle in **`Try`/`catch`/`finally`** to **compensate** (undo) on
failure; the caller gets one answer for the whole unit and can retry it as a unit.

*Example:* *reserve stock → charge → create order*, with `catch` releasing the reservation if a later
step throws.

There is no transaction manager: compensation is something you author. Writes already committed stay
committed, so the `catch` block has to undo them explicitly, and a body that may be retried should be
**idempotent** (a natural key checked with `ResourceFind` before creating, say).

## 2. Concurrency-safe writes with `version` (optimistic locking)

To mutate a shared row without **lost updates**, read it (`ResourceRead`/`ResourceFind`), then
`ResourcePatch`/`ResourceUpdate` passing **`version: "{ /<read>/sys/version }"`**. If another writer
changed the row meanwhile the version no longer matches and the write **fails with a conflict** —
`catch` it and retry (re-read → re-apply).

*Example:* safely increment a shared counter / like-count / remaining inventory under concurrent calls.

```jsonc
{ "type": "ResourceRead", "resource": "Content", "target": { "sys": { "id": "{ /payload/id }" } }, "name": "row" },
{ "type": "Try",
  "body": [ { "type": "ResourcePatch", "resource": "Content",
    "target": { "sys": { "id": "{ /row/sys/id }" } },
    "version": "{ /row/sys/version }",
    "fields": { "count": { "en-US": { "$+": [ "{ /row/fields/count/en-US }", 1 ] } } } } ],
  "catch": [ { "type": "Return", "value": { "ok": false, "retry": true }, "isError": true, "statusCode": 409 } ] }
```

Correctness here comes from the `version` check, **not** from how fresh the read was — so this
pattern is the right answer to "my read might be stale", and it keeps search reads on the default
indexed path (`advanced: true`).

## 3. Controlled privilege delegation (act with the author's authority)

A Script runs its inner Content/Media ops with the **Script author's** permissions, so it is a
**safe, narrow privilege grant**: expose a *single* privileged operation to callers who otherwise
lack it. Give end users only `script.Execute` — ideally pinned to that one Script via the **`self`**
filter — and they gain exactly that operation and nothing else.

*Example:* end users **cannot** write the `Log` (audit/activity) ContentType directly, but a Script
`recordEvent` **appends** a log entry on their behalf — so they can add entries only *through* the
Script (which fixes the shape and stamps the caller), yet still cannot read, edit, or delete
arbitrary logs. Same shape for: increment a protected counter, file a report into a moderation queue
they can't read, or grant a one-off write into an admin-only collection.

This is the positive side of the **author gate** in `SKILL.md` → *Secrets & auth*: the **author**
needs the real permission, the caller does not. It also means the Script must do its own ownership
enforcement — the author's broad authority will not scope anything for you, so add
`where: { "createdBy": ":self" }` wherever the caller should only reach their own rows.

## 4. Secret-gated edit/delete — ownership by a shared secret, not identity

When the caller has **no usable identity** to gate on — anonymous / public callers, so
`createdBy :self` means nothing — prove ownership with a **caller-supplied secret** the Script checks
**server-side** against a store the caller **cannot read**.

Canonical case: an **anonymous board** — a post is created with a `password`, and a later **edit or
delete** must re-supply it. Keep the password in a **separate credential ContentType** (one row per
post: the post id + its password) on which the public role has **no `Read`**. The Script, running
with its **author's** delegated authority (pattern 3), `ResourceFind`s that credential, compares, and
**`Return`s an error on mismatch** — only a match proceeds to the `ResourcePatch` / delete. Because
the comparison happens *inside* the Script, the secret store never reaches the client: a caller
holding nothing but `script.Execute` can neither read another post's password nor skip the gate.

Anonymous callers carry `script.Execute` via a **`SpaceAccessToken`** — the Space-scoped token that,
with a suitably narrow bound role, authorizes `/execute` for a caller with no logged-in Weegloo User
(`weegloo-space-access-token`). A caller with no token at all needs `anonymousCallEnabled` instead —
see `verify-callbacks.md`.

```jsonc
// Edit a post only if the supplied password matches the stored one.
// Public role holds script.Execute on THIS script only — NOT Read on ct_pw, NOT Edit on ct_post.
{ "type": "ResourceFind", "resource": "Content", "contentType": { "sys": { "id": "ct_pw" } },
  "where": { "fields.postId": { "eq": "{ /payload/postId }" } }, "name": "cred" },
{ "type": "If", "condition": { "or": [
    { "==": [ "{ /cred }", null ] },
    { "!=": [ "{ /cred/fields/password/en-US }", "{ /payload/password }" ] } ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 403,
              "value": { "ok": false, "error": "bad-password" } } ] },
{ "type": "ResourcePatch", "resource": "Content", "target": { "sys": { "id": "{ /payload/postId }" } },
  "fields": { "body": { "en-US": "{ /payload/fields/body }" } } },
{ "type": "Return", "value": { "ok": true } }
```

**Delete** reuses the same gate, then — since `ResourceDelete` accepts **Draft/Archived only** —
`ResourceUnpublish` the post (read it first for its `sys.version`) **before** `ResourceDelete`.
Prefer to **store a client-hashed value, not the raw password** (the Script compares either the same
way), so the credential store never holds plaintext.

## 5. Event → external call → follow-up work (Webhook + Script)

React to a Space event by calling a third-party API and then *doing something with the result* —
write a field, create a record, ingest Media. Wire it by pointing a **Webhook's `script`** at the
Script (`weegloo-webhook`), so it runs automatically on e.g. `Content.Publish`.

*Example:* on `Content.Publish`, POST the item to a search-index API, then `ResourcePatch` an
`indexedAt` value back onto it.

Two consequences of running without a caller: the `Return` value goes nowhere (persist anything worth
keeping), and a Script's own writes are **silent** by default (`propagateEvents: false`), which is
what stops a Webhook-run Script from re-triggering itself. Set `propagateEvents: true` only on the
writes that genuinely must fan out — and check you are not building a loop.
