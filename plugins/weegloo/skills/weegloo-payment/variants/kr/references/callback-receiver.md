# Shape B — the PG POSTs to a Script

Read this **only when the provider pushes to you**: a webhook / callback / notification URL you
register in the provider's console. If your frontend can *ask* the PG whether the payment went
through, that is shape A and it is complete in `SKILL.md` (§4, *A. Confirm*). On Toss the one push
you may need is the **가상계좌 deposit notification** — only once the user's own keys offer 가상계좌;
the documentation keys do not — and its check is not a signature but an inquiry to Toss's 결제 조회
API — see *The Toss 가상계좌 deposit* at the end.

## B-1. Which endpoint the PG posts to (read this before designing the flow)

There are two, and one question picks for you:

> **Can this provider send a custom HTTP header with its webhook?**

**Answer it from the provider's own webhook/notification documentation, per integration.** Do not
assume, and do not trust a list — the answer differs by provider, by product line within a provider,
and changes over time.

| If it can… | Register this URL | What authenticates the call |
|---|---|---|
| send a **custom header** | `https://script.weegloo.com/v1/spaces/{spaceId}/scripts/{scriptId}/execute` | a **`SpaceAccessToken`** in `Authorization: Bearer …` **and** the Script's signature check |
| only POST to a **bare URL** | `https://script.weegloo.com/v1/spaces/{spaceId}/scripts/{scriptId}/execute/anonymous` | the Script's **signature check alone** |

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
- The Script may not use the **`:self`** filter — refused when the Script is saved
  (**`WGL400061`**). Match the order on the reference the provider sends back instead — for Toss,
  the `orderId` in the notification body.
- Nothing rate-limits an anonymous call, so do not leave the flag on for a Script that verifies
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
must call out, verify + record here and let a `Webhook` on that write (`propagateEvents: true`, B-5) do
the rest. **The one exception here is the Toss 가상계좌 deposit:** its body proves nothing on its own,
so the call to Toss *is* its verification — bounded inside Toss's timeout in the section at the end.

```jsonc
{ "type": "Signature", "name": "verified", "algorithm": "SHA256",
  "secret": "{ /secrets/WEBHOOK_SIGNING_SECRET }",
  "value": "{ /rawPayload }",
  "expected": "{ /headers/x-provider-signature }" },

{ "type": "If", "condition": { "!": "{ /verified }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

- **The signing secret lives in the receiver Script's `definition.secrets`** — `WEBHOOK_SIGNING_SECRET`
  above — never as a literal in the statement.
- **Sign `{ /rawPayload }`** — the caller's body exactly as received. A re-serialized object has
  different bytes and will never match.
- Header names arrive **lower-cased**, whatever case the provider sent: `{ /headers/x-provider-signature }`.
- **Nothing before the check.** No read, no write, no `SetVar` off the payload.

## B-3. Read the provider's scheme, then map its shape to statements

**Start by extracting four things from the provider's signature documentation** — these are what the
statements need, and guessing any of them produces a check that fails every time:

1. **Which header** carries the signature, and whether it holds the bare code or a packed structure.
2. **What exactly is signed** — the raw body alone, or a string built from it (a timestamp, a message
   id, a joined field list). Byte-for-byte.
3. **How the code is written** — hex (lower- or upper-case) or base64. `Signature` accepts any of
   these, so there you need not act on it. **`Hash` does not:** set its `encoding` (`Hex` **default** |
   `HexUpper` | `Base64` | `Base64Url`) to the provider's exact form, case included — the compare is
   a plain string match, so a digest in any other form fails every delivery.
4. **How the secret was issued to you** — plain text, hex, or base64. This one you *must* act on
   (`secretEncoding`); the wrong choice is a different key and never matches.

Then map the shape you found. This table is the **shape → statement** vocabulary, not a claim about
any provider:

| The scheme's shape | Statements |
|---|---|
| Keyed hash of the raw body, code sits alone in a header | `Signature` |
| Signing key issued **hex**- or **base64**-encoded | `Signature` + `secretEncoding: "Hex"` / `"Base64"` |
| Signature header packs several values, e.g. `t=…,v1=…` or `ts=…;h1=…`, and the timestamp is part of the signed message | `Regex` `Capture` → `Signature` over `"{ /sig/1 }.{ /rawPayload }"` |
| Signed message joins values from **separate** headers | `Signature` over `"{ /headers/a }.{ /headers/b }.{ /rawPayload }"` |
| **Keyless** salted digest — a hash of concatenated fields *including* a shared secret | `Hash` with `encoding` matching the provider's form + compare with `$===` |
| Legacy `MD5(…)` digest | `Hash` with `algorithm: "MD5"`, `encoding` matching the provider's form |
| Asymmetric signature (RSA/ECDSA), or a scheme requiring a fetched certificate | **not covered** — `Signature` is keyed-hash only; use shape A instead |

**Packed header, end to end** — the header here holds `t=<timestamp>,v1=<hex>` and the signed message
is `"{timestamp}.{body}"`; adapt the pattern and the assembled message to the scheme you read:

```jsonc
{ "type": "Regex", "name": "sig", "mode": "Capture",
  "pattern": "^t=(\\d+),v1=([0-9a-f]{64})$",
  "value": "{ /headers/x-provider-signature }" },

{ "type": "Signature", "name": "verified", "algorithm": "SHA256",
  "secret": "{ /secrets/WEBHOOK_SIGNING_SECRET }",
  "value": "{ /sig/1 }.{ /rawPayload }",
  "expected": "{ /sig/2 }" },
```

**Keyless digest, end to end:**

```jsonc
{ "type": "Hash", "name": "expected", "algorithm": "SHA256", "encoding": "Hex",
  "value": "{ /payload/merchantId }{ /payload/timestamp }{ /payload/orderId }{ /payload/amount }{ /secrets/SHARED_KEY }" },

{ "type": "If", "condition": { "!==": [ "{ /expected }", "{ /payload/signData }" ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "bad signature" } ] }
```

`Hash` takes the secret inside `value` as `{ /secrets/<key> }`, wherever that scheme puts it, and caps the resolved `value` at
**128 characters**, checked when the statement runs, not at save (over ⇒ it fails with `422`) — so
size it by the longest value every field and the key can take, not by one test delivery. A scheme
that can exceed it is **not covered**, like the asymmetric row: `Signature` is an HMAC, a different
code from a plain digest, and the field list is the provider's to fix, not yours — use shape A
instead. Statement fields, `Capture` indexing and the other caps are `weegloo-script`'s.

## B-4. Replay window

Providers that sign a timestamp expect you to reject old deliveries:

```jsonc
{ "type": "If",
  "condition": { "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] },
  "then": [ … proceed … ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "stale" } ] }
```

The captured timestamp is text; the arithmetic coerces it.

## B-5. Idempotency — providers retry

A retried delivery must not charge, credit or fulfil twice. **Key on the provider's own event or
payment id**, not on arrival:

1. `ResourceFind` a receipt Content by that id.
2. If found ⇒ `Return` `200` immediately (a success, not an error — otherwise the PG keeps retrying).
3. Otherwise write it, then do the work. The receipt needs no `propagateEvents` (that only fires
   Webhooks): with or without it, the receipt reaches the synced copy step 1's find reads about a
   second later (`weegloo-script` → *Resource reads*).

Before fulfilling, match the delivery to **your own order row** and check it exactly as in shape A —
amount and status against what you stored, never the payload alone. A verified delivery proves *the
PG sent this*, not *this is the order you think it is*.

For a counter or balance that two deliveries could race on, pass the row's **`sys.version`** as the
write's `version` (optimistic lock) and let `Try` handle the conflict. And remember a Script's writes
are **silent** by default — they fire no Webhooks; set `propagateEvents: true` on a write that must
(both mechanics: `weegloo-script`).

## The Toss 가상계좌 deposit — ask Toss; the delivery is only a trigger

As of writing (Toss's event reference, the path `llms.txt` lists — `…/reference/using-api/webhook-events.md`),
`DEPOSIT_CALLBACK` carries **no signature header and no amount**: its body is `orderId`, `status`,
`transactionKey`, `createdAt` and a per-payment `secret`, which Toss's own check compares with the
`secret` the confirm call returned. **Here there is no copy to compare, and do not add one back** —
`SKILL.md` §4 says why any stored copy reaches the buyer. Trust nothing in the body: `orderId` only
says which order to ask about, and the answer comes from Toss's **결제 조회 API** — the route Toss's
LLM quick reference gives for this event (webhook → 조회 API → `DONE`). Re-read both pages before
building; where they disagree with this section about a field or an endpoint, the page wins — not
about where a `secret` may live, which the page cannot see.

- **Ask by `paymentKey`** — `GET https://api.tosspayments.com/v1/payments/{paymentKey}`, with the
  `paymentKey` `SKILL.md` §4 stored when the account was issued. The notification carries none, and
  Toss's key reference (`…/reference/using-api/api-keys.md`) lists `paymentKey로 결제 조회` for the
  결제위젯 secret key but not `orderId로 결제 조회`.
- **The same `Basic …` header as the confirm Script**, from the same `TOSS_BASIC_AUTH` secret
  declared in this receiver's own `definition.secrets` — by now the user's own key: 가상계좌, and so
  this receiver, exists only on their own keys (`SKILL.md` §6).

```jsonc
{ "type": "If", "condition": { "!": "{ /payload/orderId }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 400, "value": "no orderId" } ] },

{ "type": "ResourceFind", "name": "found", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "fields.orderId": "{ /payload/orderId }" } },

{ "type": "If", "condition": { "!": "{ /found }" },
  "then": [ { "type": "Return", "isError": true, "statusCode": 404, "value": "unknown order" } ] },

{ "type": "ResourceRead", "name": "order", "resource": "Content",
  "target": { "sys": { "id": "{ /found/sys/id }" } } },

{ "type": "If", "condition": { "or": [
      { "!": "{ /order/fields/paymentKey/en-US }" },
      { "and": [ { "!==": [ "{ /order/fields/status/en-US }", "awaiting_deposit" ] },
                 { "!==": [ "{ /order/fields/status/en-US }", "paid" ] } ] } ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 409,
              "value": "not a deposit order" } ] },

{ "type": "Http", "name": "toss", "method": "GET",
  "url": "https://api.tosspayments.com/v1/payments/{ /order/fields/paymentKey/en-US }",
  "headers": [ { "key": "Authorization", "value": "Basic { /secrets/TOSS_BASIC_AUTH }" } ],
  "timeoutMs": 5000, "ignoreStatusCode": true },

{ "type": "If", "condition": { "or": [
      { "!=": [ "{ /toss/status }", 200 ] },
      { "!==": [ "{ /toss/body/orderId }", "{ /order/fields/orderId/en-US }" ] },
      { "!==": [ "{ /toss/body/totalAmount }", "{ /order/fields/amount/en-US }" ] } ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 503, "value": "not confirmed" } ] },

{ "type": "Try",
  "body": [
    { "type": "If", "condition": { "and": [
          { "===": [ "{ /toss/body/status }", "DONE" ] },
          { "===": [ "{ /order/fields/status/en-US }", "awaiting_deposit" ] } ] },
      "then": [ { "type": "ResourcePatch", "resource": "Content",
                  "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
                  "version": "{ /order/sys/version }", "fields": { "status": "paid" } } ] },
    { "type": "If", "condition": { "===": [ "{ /toss/body/status }", "WAITING_FOR_DEPOSIT" ] },
      "then": [ { "type": "ResourcePatch", "resource": "Content",
                  "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
                  "version": "{ /order/sys/version }",
                  "fields": { "status": "awaiting_deposit" } } ] } ],
  "catch": [ { "type": "Return", "isError": true, "statusCode": 409, "value": "retry" } ] },

{ "type": "Return", "value": "ok" }
```

- ⚠️ **Here the inquiry IS the authentication** — B-1's rule, with Toss's answer in the signature's
  place. Nothing before it writes; the reads only find the `paymentKey` to ask about. A forged
  delivery can at most make you ask Toss about a payment you already hold, and the answer can only
  move the order to what Toss says — at the cost of one execution and one outbound call, which
  nothing rate-limits. The gates before the `Http` keep an unknown `orderId`, or an order with no
  stored `paymentKey`, from reaching it. The notice Toss sends as it issues the account can beat
  §4's patch and be refused once — harmless, its retry a minute later passes; a genuine delivery
  refused on every retry means the find missed the order or `SKILL.md` §4 never stored the
  `paymentKey`, and Toss's failure email is the alarm. No `Return` echoes the order or Toss's body.
- **Decide from `ResourceRead`, not from the search.** The find reads the indexed copy, which trails
  the writes by about a second: it has `orderId`, written when the order Script created the order
  long before any notice (`SKILL.md` → *The order Script*; §4's own find depends on the same).
  `paymentKey` and `status` come from Script patches — §4's and this receiver's — that can land
  moments before a notice, so they are taken from `ResourceRead`, which never uses the index.
  **No write here needs `propagateEvents: true` to be correct**; set it on the two patches only if
  a `Webhook` fulfils, or stops fulfilment, from them (B-5) — and make that Webhook idempotent,
  because the `WAITING_FOR_DEPOSIT` patch also runs on an order that already reads `awaiting_deposit`.
- **This is B-2's exception: it has to call out.** `timeoutMs: 5000`, with `retry` left at `0`, keeps
  the run well inside the **10 seconds** Toss waits for a `200`. A Toss error or a mismatch answers
  `503`, a version conflict `409`, and an `Http` timeout fails the run — none of them a `200` — so
  Toss retries, up to 7 times over about 3 days 19 hours, then emails a failure notice. Each retry
  asks Toss again, so the order converges on Toss's answer whether or not an earlier run's write
  landed.
- **Every check runs after the inquiry, "already paid" included.** A short-circuit before it would
  swallow a reversal: Toss can move `DONE` back to `WAITING_FOR_DEPOSIT` (a deposit error, or a bank
  that cancels a deposit it just reported), and the order must go back to awaiting deposit and
  fulfilment must stop. That is why the `WAITING_FOR_DEPOSIT` patch runs even on an order that already
  reads `awaiting_deposit`: its `version` lock sends a reversal that races a `DONE` delivery into the
  `catch`, to be retried instead of lost, just as it lets a duplicate `DONE` pay the order once. Other
  statuses change nothing here. The cases: `…/resources/glossary/virtual-account.md` in `llms.txt`.
- **Register `DEPOSIT_CALLBACK`** from the user's own Toss account (개발자센터 → 웹훅), on the
  **anonymous** endpoint (B-1) — Toss's webhook guide (`…/guides/v2/webhook.md`) describes no custom
  header or auth on a delivery. Registering `PAYMENT_STATUS_CHANGED` as well delivers every 가상계좌
  change twice.

## Never — the callback-only two

These are in addition to the `Never` list in `SKILL.md`.

- **Never skip signature verification because the callback URL is secret.** A URL is not a secret, and
  a callback token authenticates *that it is your endpoint*, not *that the PG sent this body* — and on
  the anonymous endpoint there is no token either.
- **Never set `anonymousCallEnabled` on a Script that verifies nothing.** That publishes an endpoint
  which runs with the author's authority to anyone who finds the URL.
