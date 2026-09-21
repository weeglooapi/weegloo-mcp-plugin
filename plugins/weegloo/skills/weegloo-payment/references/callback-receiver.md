# Shape B — the PG POSTs to a Script

Read this **only when the provider pushes to you**: a webhook / callback / notification URL you
register in the provider's console. If your frontend can *ask* the PG whether the payment went
through, that is shape A and it is complete in `SKILL.md` (§6c) — a product does A or B, not both.

Not reachable on the §1 published sample keys: registering an endpoint and getting a `whsec_…`
requires dashboard access to an account you own.

## B-1. Which endpoint the PG posts to (read this before designing the flow)

There are two, and one question picks for you:

> **Can this provider send a custom HTTP header with its webhook?**

**Answer it from the provider's own webhook/notification documentation, per integration.** Do not
assume, and do not trust a list — the answer differs by provider, by product line within a provider,
and changes over time.

**For Stripe the answer is no.** A Stripe webhook endpoint is a bare URL; the dashboard offers no
custom headers or basic auth. So a Stripe receiver uses the **anonymous** row below, and its
signature check is the only thing authenticating the call.

| If it can… | Register this URL | What authenticates the call |
|---|---|---|
| send a **custom header** | `https://script.weegloo.com/v1/spaces/{spaceId}/scripts/{scriptId}/execute` | a **`SpaceAccessToken`** in `Authorization: Bearer …` **and** the Script's signature check |
| only POST to a **bare URL** (Stripe) | `https://script.weegloo.com/v1/spaces/{spaceId}/scripts/{scriptId}/execute/anonymous` | the Script's **signature check alone** |

The URL you paste into the provider's console is the **full** one above — Script execution is served by
`script.weegloo.com`, not the CMA host (`weegloo-api-endpoints`).

**Prefer the token path whenever the provider supports it** — two independent gates beat one, and an
endpoint that answers only to a known token never runs on someone else's traffic at all.

**Token path.** Bind the token to a **`SpaceRole` whose only grant is `script.Execute` scoped with the
`self` filter** to that one Script, so a leaked callback token buys nothing but the right to invoke
that one endpoint. See `weegloo-space-access-token` and `weegloo-space-role`.

```jsonc
// the SpaceRole bound to the callback token — nothing else granted
"script": { "Execute": { "Allow": [ { "self": { "sys": {
    "id": "<scriptId>", "type": "Refer", "targetType": "Script" } } } ] } }
```

**Anonymous path.** Set **`anonymousCallEnabled: true`** on the Script and register
`…/execute/anonymous`. No token is involved — a presented one is ignored. The flag's semantics (the
run is attributed to the Script's **author**, no role permission is consulted, and the quota is still
spent) are `weegloo-script`'s; what they mean for a payment receiver:

- ⚠️ **The signature check IS the authentication.** Not a precaution: it is the only thing between the
  open internet and a Script that runs with its author's authority. Verify first, return `401` on
  failure, and do nothing before that (B-2).
- **You may not use the `:self` filter** — refused when the Script is saved (**`WGL400061`**). Match
  the order on the provider's own reference instead (`client_reference_id`).
- Nothing rate-limits an anonymous call, so never leave the flag on for a Script that verifies
  nothing.

Either way the Script's **`directCallEnabled` must be `true`** (the default); `false` means it runs
only as a Webhook's linked action and both endpoints reject the call with **`WGL422062`**.

**A Weegloo `Webhook` is not this.** That reacts to *Space* events (Content created, …), not to a
third party calling in. See `weegloo-webhook`.

## B-2. Verify the signature as the FIRST statement

`Signature`, `Hash` and `Regex` are pure computation, so a Script that only verifies and writes answers
the PG in milliseconds with a genuine `200`. **Keep `Http` out of a callback receiver** — an outbound
call the provider has to wait for turns a receiver that should be instant into one that can exceed the
provider's own timeout, and a PG that stopped waiting treats the delivery as failed and retries. If you
must call out, verify + record here and let a `Webhook` on that write do the rest.

Stripe expects a `2xx` **before** any slow work, and retries a non-`2xx` for up to three days in live
mode (a few hours in a sandbox).

## B-3. Stripe's scheme, statement by statement

Stripe's `Stripe-Signature` header packs a timestamp and one or more signatures:

```
Stripe-Signature: t=1492774577,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

- The signed message is **`{timestamp}.{raw body}`** — a literal period between the two.
- **HMAC-SHA256**, keyed with the endpoint's **`whsec_…` secret used verbatim**, prefix included.
  Do not strip `whsec_`, and do not hex- or base64-decode it: `secretEncoding` stays **`Utf8`**.
- The code is **hex**.

```jsonc
{ "type": "Regex", "name": "sig", "mode": "Capture",
  "pattern": "t=(\\d+),v1=([0-9a-f]{64})",
  "value": "{ /headers/stripe-signature }" },

{ "type": "If", "condition": { "!": "{ /sig }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] },

{ "type": "Signature", "name": "verified", "algorithm": "SHA256",
  "secret": "whsec_…", "secretEncoding": "Utf8",
  "value": "{ /sig/1 }.{ /rawPayload }",
  "expected": "{ /sig/2 }" },

{ "type": "If", "condition": { "!": "{ /verified }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

- ⚠️ **Do not anchor the pattern with `^…$`.** For test events Stripe appends a second, fake `v0=…`
  scheme, and a rolled secret adds a second `v1=…` — an anchored pattern matches neither, so the
  receiver rejects every delivery while looking correct. Ignore any scheme that is not `v1`.
- **Signing `{ /rawPayload }` — the body exactly as received — rather than a re-serialized object is
  the single most common cause of a failing Stripe signature check.**
- Header names arrive **lower-cased**, whatever case the provider sent: `{ /headers/stripe-signature }`.
- **Nothing before the check.** No read, no write, no `SetVar` off the payload.

**Other providers** sign differently. This is the **shape → statement** vocabulary to map onto
whatever their docs describe — start by extracting four things from their signature documentation:
which header carries the code, exactly what bytes are signed, hex vs base64 (`Signature` accepts
either, so this is diagnostic only), and how the secret itself was issued (this one you *must* act on
via `secretEncoding` — the wrong choice is a different key and never matches).

| The scheme's shape | Statements |
|---|---|
| Keyed hash of the raw body, code sits alone in a header | `Signature` |
| Signing key issued **hex**- or **base64**-encoded | `Signature` + `secretEncoding: "Hex"` / `"Base64"` |
| Signature header packs several values, e.g. `t=…,v1=…` (Stripe) or `ts=…;h1=…` | `Regex` `Capture` → `Signature` over the assembled message |
| Signed message joins values from **separate** headers | `Signature` over `"{ /headers/a }.{ /headers/b }.{ /rawPayload }"` |
| **Keyless** salted digest — a hash of concatenated fields *including* a shared secret | `Hash` + compare with `$===` |
| Legacy `MD5(…)` digest | `Hash` with `algorithm: "MD5"` |
| Asymmetric signature (RSA/ECDSA), or a scheme requiring a fetched certificate | **not covered** — `Signature` is keyed-hash only; use shape A instead |

`Hash` takes the secret inside `value`, wherever that scheme puts it, and caps the resolved `value` at
**128 characters** — a long concatenation needs `Signature` instead. Statement fields, `Capture`
indexing and the other caps are `weegloo-script`'s.

## B-4. Replay window

Stripe's own libraries reject a delivery whose timestamp is more than **5 minutes** old, and the
timestamp is inside the signed message so it cannot be tampered with:

```jsonc
{ "type": "If",
  "condition": { "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] },
  "then": [ … proceed … ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "stale" } ] }
```

The captured timestamp is text; the arithmetic coerces it. Never use a tolerance of `0`; that
disables the check entirely. Note that a Stripe **retry** carries a **fresh** timestamp and
signature, so the window never rejects a legitimate retry — dedupe is B-5's job, not this one's.

## B-5. Idempotency — providers retry

A retried delivery must not charge, credit or fulfil twice. Stripe explicitly does not guarantee
ordering or exactly-once delivery, so **key on `event.id`** (`evt_…`), not on arrival:

1. `ResourceFind` a receipt Content by that `evt_…` id.
2. If found ⇒ `Return` `200` immediately (a success, not an error — otherwise the PG keeps retrying).
3. Otherwise write it, then do the work.

The payload's `data.object` is the resource the event is about — for `checkout.session.completed`, the
Checkout Session, carrying `client_reference_id`, `amount_total`, `currency` and `payment_status`.
Verify the amount against your own order row here exactly as in shape A; a verified signature proves
*Stripe sent this*, not *this is the order you think it is*.

For a counter or balance that two deliveries could race on, pass the row's **`sys.version`** as the
write's `version` (optimistic lock) and let `Try` handle the conflict. And remember a Script's writes
are **silent** by default — set `propagateEvents: true` on the write that should trigger downstream
work (both mechanics: `weegloo-script`).

## Never — the callback-only four

These are in addition to the `Never` list in `SKILL.md`.

- **Never reuse a test webhook signing secret in live mode.** Signing secrets are per-endpoint and
  per-mode; the wrong one fails every delivery with a valid-looking signature error.
- **Never anchor the `Stripe-Signature` pattern with `^…$`** — the extra `v0=` on test events and the
  second `v1=` during a secret roll both break it (B-3).
- **Never skip signature verification because the callback URL is secret.** A URL is not a secret, and
  on Stripe's anonymous endpoint there is no token either.
- **Never set `anonymousCallEnabled` on a Script that verifies nothing.** That publishes an endpoint
  which runs with the author's authority to anyone who finds the URL.
