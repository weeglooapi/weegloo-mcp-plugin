# Receiving a signed request — `Signature`, `Hash`, `Regex`, and the anonymous endpoint

Read this when the Script is the **receiver**: a payment provider's callback, any inbound webhook
that signs its body, or any endpoint you are about to open with `anonymousCallEnabled`. Calling
*out* to an API is covered in `SKILL.md`.

All three statements are **pure computation and short-running**, so a Script that only verifies and
writes answers its caller in milliseconds — which is what an inbound webhook receiver needs. They
take a **required `name`**: the result is their only effect, so one with nothing bound does nothing.

## `Signature` — is the code the caller sent the one an HMAC of the message produces?

Binds a **`Boolean`**. `algorithm` (`SHA1`|`SHA256`|`SHA384`|`SHA512`), `secret` (value expression),
`secretEncoding` (`Utf8` **default** |`Hex`|`Base64`), `value` (the message), `expected` (the code
received). Compared in **constant time**.

- **There is no output-encoding field, on purpose.** `algorithm` fixes the byte length, and for a
  given length hex and base64 have different string lengths — so `expected` is accepted as **hex
  (either case), base64, or base64url, padded or not**. Do not look for an `encoding` field.
- **`secretEncoding` is not optional guesswork** — a key issued hex- or base64-encoded is a
  *different key* when used as text, and the code it produces looks valid but never matches. Read how
  the provider issued the key from its own docs; a key handed over as hex or base64 is common, and it
  is not inferable from the string.
- **Failure is split by who supplies the input.** A missing or mismatched `expected` is **`false`**,
  not an error (so a missing header and a wrong one are one outcome); an empty message is
  authenticated as the empty message; only a blank **`secret`** — your own authoring — is a `400`.
- **Sign `{ /rawPayload }`**, the body exactly as received. A re-serialized object has other bytes.
- Cap: the **resolved** `value` is limited to **65,536 chars** (over ⇒ the statement fails, `422`).
- ⚠️ `secret` has **no `secret: true` flag** (unlike an `Http` header): a signing secret written into
  a Script is stored as authored and readable by anyone who can read that Script. Keep Script `Read`
  off end-user roles.

## `Hash` — unkeyed digest

Binds the **`String`**. `algorithm` (`MD5`|`SHA1`|`SHA256`|`SHA384`|`SHA512` — `MD5` only to
reproduce an older scheme), `value`, `encoding` (`Hex` **default**|`HexUpper`|`Base64`|`Base64Url`).

For schemes that hash a shared secret *with* the message (`SHA256(fields… + sharedKey)`) — **there is
no `secret` field**: write the secret into `value` in whatever position that scheme puts it, which is
the only form that expresses every position. Compare with `$===`. Cap: the **resolved** `value` is
limited to **128 chars**.

## `Regex` — how text is taken apart

The operator vocabulary can join (`cat`) and test membership (`in`) but not cut. `mode`:
**`Match`** → `Boolean`, **`Capture`** → a **list** (index `0` the whole match, `1..n` the capture
groups, a group that did not participate `null`) or `null` when nothing matched. Read an element by
pointer: **`{ /<name>/1 }`**.

- Both modes ask whether the pattern occurs **anywhere** — anchor with `^…$` for the whole text.
- **`pattern` is a literal, the one authored field that is NOT a value expression.** `{ /pointer }`
  is not resolved in it. Flags go inline: `(?i)`, `(?s)`.
- Patterns are compiled **once per run** (a `Regex` in a `Loop` body is not recompiled per lap), and
  an unusable pattern fails the run **before any statement executes** — including one in a branch
  that would never have been taken.
- Caps: `pattern` **128 chars** as authored (rejected at save); the **resolved** `value` **10,240
  chars** (over ⇒ the statement fails).

## Putting it together — unpack, verify, check the replay window

```jsonc
// A header packing `t=<timestamp>,v1=<hex>`: unpack it, then verify over "{timestamp}.{body}"
{ "type": "Regex", "name": "sig", "mode": "Capture",
  "pattern": "^t=(\\d+),v1=([0-9a-f]{64})$", "value": "{ /headers/x-provider-signature }" },
{ "type": "Signature", "name": "verified", "algorithm": "SHA256", "secret": "{ /vars/signingSecret }",
  "value": "{ /sig/1 }.{ /rawPayload }", "expected": "{ /sig/2 }" },
{ "type": "If", "condition": { "!": "{ /verified }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

Two pointers in one string already concatenate, so a signed message needs **no `$cat`** — reach for
`$cat` only when a piece is a computed value rather than a pointer or literal.

**The replay window is plain arithmetic** over `/now`, which is read once per run (so `Parallel`
branches cannot disagree about it) and needs no clock statement. A timestamp captured as text is
coerced:

```jsonc
{ "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] }   // within 5 minutes
```

**Idempotency.** Providers retry. Verify first, then look the event up by its provider-side id
(`ResourceFind` on a `fields.eventId`, or `ResourceRead` when you store it as the `sys.id`) and
return the existing result instead of doing the work twice. Full PG / MoR guidance, including which
of `/execute` and `/execute/anonymous` a given provider can reach: **`weegloo-payment`**.

## The anonymous endpoint — `anonymousCallEnabled`

`anonymousCallEnabled` (default `false`) lets the Script **also** be invoked with **no token at all**
through **`POST /v1/spaces/{spaceId}/scripts/{scriptId}/execute/anonymous`**. That is the path a
third party which cannot present a Weegloo token (a payment provider's callback, say) can reach.
Leave it off unless you need exactly that; the authenticated `/execute` keeps working either way.

- **It runs as the Script's author.** There is no caller to attribute to, so resource writes get the
  **author** as `sys.createdBy`/`updatedBy`. A presented Bearer token is **ignored** — use `/execute`
  to run as the caller.
- **No role permission is consulted.** The Script `Execute` grant gates `/execute`, not this path:
  the flag *is* the authorization decision, made once by whoever saved the Script.
- One rule is enforced **when the Script is saved**: it may not use the **`:self`** filter
  (**`WGL400061`**) — under anonymity `:self` resolves to the *author*, so an ownership filter written
  for an authenticated caller would silently widen to the author's own rows.
- ⚠️ **The Script itself is the only thing authenticating the request.** Verify something before
  doing anything — a `Signature` over `{ /rawPayload }` is the usual answer. Anonymous calls also
  consume the Organization's Script-execution quota and nothing rate-limits them, so an endpoint left
  open with nothing to verify is both a data risk and a cost risk.

**When the provider can send a custom header instead**, prefer an authenticated `/execute` call
carrying a **`SpaceAccessToken`** bound to a role that grants only `script.Execute` on that one
Script (`weegloo-space-access-token`) — the leak radius is then one endpoint, and the platform does
the authentication before your first statement runs.
