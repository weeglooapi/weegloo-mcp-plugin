---
name: weegloo-payment
description: Wire a PaymentGateway (PG) or Merchant-of-Record (MoR) into a product built on Weegloo — Stripe, Toss Payments, PortOne, Paddle, FastSpring, LemonSqueezy, Adyen, NCP, KCP, 나이스페이 and the like. Covers the two server-side shapes that work without hosting a backend: CONFIRM (frontend hands over a payment id, a Script pulls the truth from the PG's verify API and writes the order) and CALLBACK (the PG POSTs to a Script's /execute, whose FIRST statement verifies the signature with Signature/Hash, unpacks packed headers with Regex, and checks the replay window with /now). Also covers what authenticates an inbound PG callback — a SpaceAccessToken bound to a role granting only script.Execute on that one Script when the provider can send a custom header, or the token-free /execute/anonymous endpoint (anonymousCallEnabled) when it can only POST to a bare URL, as Stripe, Paddle and Shopify do — plus idempotency against provider retries, where the PG secret key belongs, and the amount-verification rule. Use when a product must take payments, verify a payment, receive a PG/MoR webhook, handle refunds or subscription renewals, or check a callback signature. NOT for Weegloo's own subscription/plan billing.
---

# Weegloo — payments (PG / MoR)

**This is about the product charging its own customers**, using Weegloo as the backend. Weegloo's own
subscription and plan billing is a different thing entirely and is not configured from here.

## The constraint that decides the architecture

Weegloo hosts no backend of yours. **The only place your server-side payment logic can run is a
Script** (`weegloo-script`) — which means:

> **The browser may never be what decides a payment succeeded.** Amount, currency and status are
> established server-side, inside a Script, from something the PG said — never from the request
> payload.

Everything below is a consequence of that one rule.

## Two shapes — pick by whether you can *ask* the PG

| | **A. Confirm (pull)** | **B. Callback (push)** |
|---|---|---|
| Trigger | your frontend, after the PG SDK / redirect returns | the PG POSTs to you |
| Truth comes from | an `Http` call to the PG's verify/confirm API | the request body + its signature |
| Script mode | **Async** (`Http` forces it) → `202` + poll `requestId` | **Sync** → real `200` inline |
| Endpoint | `…/execute` (your frontend holds a token) | `…/execute` with a token, or `…/execute/anonymous` with none — see B-1 |
| Use for | checkout approval, "did this payment really go through" | refunds, disputes, subscription renewals, virtual-account deposits, anything you cannot pull |

**Prefer A whenever the answer can be pulled.** It needs no signature verification, no inbound
authentication, and no idempotency key — you are asking the authoritative source directly.

---

## A. Confirm — frontend → Script → PG verify API

1. The frontend completes the PG's client flow and receives a **payment id / token** (plus the PG's
   redirect params). It calls the Script with just those identifiers.
2. The Script **reads the order it created earlier** (`ResourceRead` / `ResourceFind` with
   `where: { "createdBy": ":self" }`) to learn the **expected amount** — from your own record.
3. `Http` GET/POST to the PG's confirm endpoint, secret key in a header with **`"secret": true`**.
4. **Compare** the PG's reported amount + currency + order id against step 2. Mismatch ⇒ `Return`
   with `isError: true` and do not fulfil.
5. `ResourceCreate` / `ResourcePatch` the order → paid, and only then grant the entitlement.

```jsonc
{ "type": "ResourceFind", "name": "order", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "createdBy": ":self", "fields.orderId": "{ /payload/orderId }" } },

{ "type": "Http", "name": "confirmed", "method": "POST",
  "url": "https://api.pg.example/v1/payments/confirm",
  "headers": [ { "key": "Authorization", "value": "Basic <key>", "secret": true } ],
  "body": { "paymentKey": "{ /payload/paymentKey }", "orderId": "{ /payload/orderId }",
            "amount": "{ /order/fields/amount/en-US }" } },

{ "type": "If",
  "condition": { "and": [
      { "===": [ "{ /confirmed/body/status }", "DONE" ] },
      { "===": [ "{ /confirmed/body/totalAmount }", "{ /order/fields/amount/en-US }" ] } ] },
  "then": [ { "type": "ResourcePatch", "resource": "Content", "target": { "sys": { "id": "{ /order/sys/id }" } },
              "locale": "en-US", "fields": { "status": "paid" } } ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 402, "value": "payment not confirmed" } ] }
```

- **Send the amount you recorded, not the amount the caller sent.** Most PGs make the confirm call
  itself amount-checked — that only helps if the amount comes from your record.
- `Http` **forces Async**, so `/execute` answers `202` + `requestId` and the frontend polls. Budget
  and poll semantics: `weegloo-script`.

---

## B. Callback — the PG POSTs to a Script

### B-1. Which endpoint the PG posts to (read this before designing the flow)

There are two, and the provider's own capabilities pick for you.

| The provider can… | Register this URL | What authenticates the call |
|---|---|---|
| set a **custom header** on its notification URL (FastSpring, Adyen, NCP, most Korean PGs) | `…/scripts/{scriptId}/execute` | a **`SpaceAccessToken`** in `Authorization: Bearer …` **and** the Script's signature check |
| only POST to a **bare URL** (Stripe, Paddle, Shopify) | `…/scripts/{scriptId}/execute/anonymous` | the Script's **signature check alone** |

**Prefer the token path when the provider supports it** — two independent gates beat one, and an
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
`…/execute/anonymous`. No token is involved — a presented one is ignored — so:

- ⚠️ **The signature check IS the authentication.** Not a precaution: it is the only thing between the
  open internet and a Script that runs with its author's authority. Verify first, return `401` on
  failure, and do nothing before that (B-2).
- The run is attributed to the **Script's author** (`sys.createdBy` on every write), since there is no
  caller to attribute to. No role permission is consulted — the flag is the whole decision.
- The Script must be **`Sync`** and may not use the **`:self`** filter; both are refused when the
  Script is saved (**`WGL400062`** / **`WGL400061`**). Sync-only means **no `Http`** in it — which is
  what you want here anyway (B-2).
- Anonymous calls still consume the Organization's Script-execution quota and nothing rate-limits
  them, so do not leave the flag on for a Script that verifies nothing.

Either way the Script's **`directCallEnabled` must be `true`** (the default); `false` means it runs
only as a Webhook's linked action and both endpoints reject the call with **`WGL422062`**.

**A Weegloo `Webhook` is not this.** That reacts to *Space* events (Content created, …), not to a
third party calling in. See `weegloo-webhook`.

### B-2. Verify the signature as the FIRST statement

`Signature`, `Hash` and `Regex` are all short-running, so **a verifying Script stays `Sync`** and the
PG gets a genuine `200` inline. Keep `Http` out of it — one `Http` turns the whole Script Async, the
PG sees `202` and stops caring, and any later failure is invisible to it (no retry). If you must call
out, verify + record in the Sync Script and let a `Webhook` on that write do the rest.

```jsonc
{ "type": "Signature", "name": "verified", "algorithm": "SHA256",
  "secret": "<webhook signing secret>",
  "value": "{ /rawPayload }",
  "expected": "{ /headers/x-fs-signature }" },

{ "type": "If", "condition": { "!": "{ /verified }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

- **Sign `{ /rawPayload }`** — the caller's body exactly as received. A re-serialized object has
  different bytes and will never match.
- Header names arrive **lower-cased**: `{ /headers/x-fs-signature }`.
- **Nothing before the check.** No read, no write, no `SetVar` off the payload.

### B-3. Provider scheme → statements

Verify the exact scheme in the provider's own docs; this is the *shape*, not the spec.

| Provider scheme | Statements |
|---|---|
| HMAC-SHA256 over raw body, **hex**, bare header | `Signature` |
| HMAC-SHA256 over raw body, **base64** | `Signature` — no encoding field needed, it accepts either |
| Signing key issued **hex** (Adyen) or **base64** (Standard Webhooks / PortOne V2 / Svix) | `Signature` + `secretEncoding: "Hex"` / `"Base64"` |
| Packed header, e.g. `t=…,v1=…` (Stripe) or `ts=…;h1=…` (Paddle) — timestamp is part of the signed message | `Regex` `Capture` → `Signature` over `"{ /sig/1 }.{ /rawPayload }"` |
| `v1,<base64>` with id + timestamp in **separate** headers (Standard Webhooks) | `Signature` over `"{ /headers/webhook-id }.{ /headers/webhook-timestamp }.{ /rawPayload }"` |
| **Keyless** salted digest — `SHA256(fields… + merchantKey)` (many Korean PGs) | `Hash` + compare with `$===` |
| Legacy `MD5(…)` digest | `Hash` with `algorithm: "MD5"` |

**Packed header (Stripe-shaped), end to end:**

```jsonc
{ "type": "Regex", "name": "sig", "mode": "Capture",
  "pattern": "^t=(\\d+),v1=([0-9a-f]{64})$",
  "value": "{ /headers/stripe-signature }" },

{ "type": "Signature", "name": "verified", "algorithm": "SHA256",
  "secret": "<whsec…>",
  "value": "{ /sig/1 }.{ /rawPayload }",
  "expected": "{ /sig/2 }" },
```

`Capture` binds a list — index `0` is the whole match, `1..n` the groups — read by pointer
(`{ /sig/1 }`). Two pointers in one string already concatenate, so building the signed message needs
no `$cat`; reach for `$cat` only when a piece is a computed value rather than a pointer or literal.

**Keyless digest (Korean-PG shaped):**

```jsonc
{ "type": "Hash", "name": "expected", "algorithm": "SHA256", "encoding": "Hex",
  "value": "{ /payload/mid }{ /payload/ediDate }{ /payload/moid }{ /payload/amt }<merchantKey>" },

{ "type": "If", "condition": { "!==": [ "{ /expected }", "{ /payload/signData }" ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

`Hash` has no `secret` field on purpose — schemes put the key in different positions, so write it
into `value` wherever that scheme puts it. Mind `Hash`'s short **128-character** limit on what
`value` resolves to; a long concatenation needs `Signature` (65,536) or fewer fields.

### B-4. Replay window

Providers that sign a timestamp expect you to reject old deliveries. `/now/seconds` is the run's
clock (one reading per execution, so two statements cannot disagree):

```jsonc
{ "type": "If",
  "condition": { "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] },
  "then": [ … proceed … ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "stale" } ] }
```

The captured timestamp is text; the arithmetic coerces it. `/now/millis` and `/now/iso` are the other
two forms — `iso` is the same rendering as `sys.createdAt`, so it compares against one directly.

### B-5. Idempotency — providers retry

A retried delivery must not charge, credit or fulfil twice. **Key on the provider's own event or
payment id**, not on arrival:

1. `ResourceFind` a receipt Content by that id.
2. If found ⇒ `Return` `200` immediately (a success, not an error — otherwise the PG keeps retrying).
3. Otherwise write it, then do the work.

For a counter or balance that two deliveries could race on, pass the row's **`sys.version`** as the
write's `version` (optimistic lock) and let `Try` handle the conflict — see `weegloo-script`.

Note that a Script's writes are **silent by default** (`propagateEvents: false`): they do not index or
fire Webhooks. Set `propagateEvents: true` on the write that should trigger downstream work.

---

## Where secrets live

| Secret | Goes in |
|---|---|
| PG **API/secret key** (for confirm calls) | `Http.headers` entry with **`"secret": true`** |
| **Webhook signing secret** | `Signature.secret` / inside `Hash.value` |
| Callback **auth token** (token path) | the `SpaceAccessToken` you register with the PG, not in the Script |

⚠️ **A `Signature.secret` written into a Script definition is stored as authored and is readable by
anyone who can read that Script.** Keep Script `Read` off end-user roles, and treat the signing secret
as compromised if it is not. (`Http.headers` `secret: true` is the encrypted-at-rest slot; there is no
equivalent flag on `Signature` today.)

## Never

- **Never trust a client-reported amount, currency or status.** Read the amount from your own order
  record, or from the PG's API response.
- **Never store card data** — PAN, CVC, expiry — in Content, Media, or a Script payload. Use the PG's
  tokenization; that is what it is for.
- **Never skip signature verification because the callback URL is secret.** A URL is not a secret, and
  a callback token authenticates *that it is your endpoint*, not *that the PG sent this body* — and on
  the anonymous endpoint there is no token either.
- **Never set `anonymousCallEnabled` on a Script that verifies nothing.** That publishes an endpoint
  which runs with the author's authority to anyone who finds the URL.
- **Never fulfil in the browser** — grant the entitlement from the Script that established payment.
- **Never `Return` a PG error verbatim** if it may echo customer data.

## Related

- `weegloo-script` — statements, value expressions, limits, Sync/Async, `Execute` permission.
- `weegloo-space-access-token` / `weegloo-space-role` — the least-privilege callback token and the
  `script.Execute` `self` filter.
- `weegloo-create-content-type` — modelling the order / receipt / entitlement ContentTypes.
- `weegloo-webhook` — reacting to *your own* Space events after a payment is recorded.
- `weegloo-service-login` — identifying the buyer (`createdBy :self` ownership).
