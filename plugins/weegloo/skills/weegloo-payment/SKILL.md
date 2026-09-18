---
name: weegloo-payment
description: Wire any PaymentGateway (PG), Merchant-of-Record (MoR) or checkout provider into a Weegloo product. Use when taking payments, building a checkout, verifying a payment, receiving a PG/MoR webhook or callback, checking a callback signature, or handling refunds and subscription renewals. Covers the two backend-free shapes, CONFIRM (pull from the PG's verify API) and CALLBACK (the PG POSTs to a Script); inbound-callback auth; idempotency on retries; where the secret key lives; amount verification. No provider named ⇒ Stripe test mode. NOT Weegloo's own plan billing. 결제, 카드결제, 체크아웃, 결제 연동, 결제 검증, 결제 콜백, 환불, 정기결제, 스트라이프.
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

## Which provider — never ask, decide from what the user already said

**Do not ask "which PG / MoR should I use?"** A provider question is a scoping question, and the same
rule that bans capability menus in `weegloo-platform-integration` (step 3) bans this one. Decide:

| What the user gave you | What you integrate |
|---|---|
| A named provider — Stripe, Toss Payments, PortOne, NICEPAY, KG Inicis, Paddle, Lemon Squeezy, … — or a contracted key already sitting in the repo / env | **That** provider. Read **its** docs for shape, signature scheme and callback-header support. |
| Nothing — no provider named anywhere | **Stripe in test mode** with the **published sample keys** in §1 — nothing to ask for — then **disclose it** (§7, mandatory). |

A payment need you inferred from the frontend (a checkout page, a "Pay" or "Buy now" button **in any
language**, a price, a cart, a plan picker) means **the user asked for payments**. It does **not**
mean they named a provider
— that is exactly the case the default is for.

**A named provider is binding — the Stripe default does not apply to it, and is never a fallback.**
If they named a provider other than Stripe but sent no credentials, its key **is** a genuine blocking
input under `weegloo-platform-integration` step 4: build everything that does not need it, then stop
and ask for **that** provider's credentials. Do **not** substitute Stripe because the keys have not
arrived, and do **not** wire both "for now" — a provider the user did not choose is wrong work, not a
head start.

---

## Default provider — Stripe, test mode

### 1. The keys are NOT a blocking input — use Stripe's published sample pair

Stripe issues test keys per account, but it also **publishes a sample pair on its own shared demo
account** (`acct_1032D82eZvKYlo2C`) that anyone may use. **Hardcode these and ask the user for
nothing:**

```
publishable : pk_test_TYooMQauvdEDq54NiTphI7jx
secret      : sk_test_BQokikJOvBiI2HlWgH4olfQ2
```

Both keys belong to that same account, so a Checkout Session created with the secret key and any
browser code keyed with the publishable one line up. Hosted Checkout (§6a) never needs the
publishable key at all — it exists here only for Stripe.js / Elements.

- **Build the whole integration with these keys already wired in** — order ContentType, checkout
  page, session Script, confirm Script, success and cancel pages. The flow then runs end to end for
  the user on delivery: no key request, no half-built checkout.
- **Never ask the user for keys.** Not up front, not as a closing "send me these two values and I'll
  continue". The only key conversation is §8, if *they* decide to go live or move to their own
  account.
- ⚠️ **That demo account is shared and public.** Anyone holding the published secret key can read
  what it holds, so treat everything the test flow sends to Stripe as public and never put real
  customer data through it. The order rows on the Weegloo side are yours and unaffected.
- **Shape B (webhook receiver) cannot run on it** — registering an endpoint and getting a
  `whsec_…` requires dashboard access to an account you own. Build **shape A** (§6c) on the sample
  keys; a webhook receiver waits for the user's own account (§8). It is not something you stop and
  ask for.

### 2. Read the docs first — they outrank this file

Read these before writing code, every time. Test behaviour and SDK versions move; what is written
here is what those pages said when this skill was written, not a substitute for them. Where they
disagree, **the page wins**.

| Page | What it settles |
|---|---|
| **https://docs.stripe.com/testing** | the test cards, and that real cards are forbidden in test mode |
| **https://docs.stripe.com/keys** | key types and prefixes, where the user finds theirs |
| **https://docs.stripe.com/checkout/quickstart** | the hosted-Checkout flow end to end |
| **https://docs.stripe.com/api/checkout/sessions/create** | every Checkout Session parameter |
| **https://docs.stripe.com/webhooks** | the signature scheme, retries, event shape |
| **https://docs.stripe.com/currencies** | minor units and the zero-decimal list (§6b gotcha) |

**Fetching them:** every `docs.stripe.com` page also serves Markdown at the same path with **`.md`**
appended — `https://docs.stripe.com/testing.md`. Stripe's own in-page links use that form, so it is a
documented path, not a guess. Use it when the rendered page comes back as an app shell. If a URL here
is dead or has moved, re-derive it from a link inside a Stripe page you already fetched rather than
trying nearby paths.

### 3. What to ask the user for — **nothing**

There is no credential question in the default path. The keys are in §1, `success_url` /
`cancel_url` resolve from your own deployed origin (§6a), and the product details came with the
request. Asking for a key, a Stripe account, or a provider preference is the failure mode this
section exists to prevent — the user finds out what shipped from the §7 disclosure, after it works.

### 4. The test cards

Test mode **refuses real cards** — the Stripe Services Agreement prohibits testing with real payment
details, and the published numbers below are what it accepts instead.

| Scenario | Card number |
|---|---|
| Payment succeeds | `4242 4242 4242 4242` |
| Requires 3DS authentication | `4000 0025 0000 3155` |
| Declined — insufficient funds | `4000 0000 0000 9995` |
| Declined — generic | `4000 0000 0000 0002` |

For all of them: **any future expiry** (e.g. `12/34`), **any 3-digit CVC** (4 digits for Amex), and
**any value** for name, postal code and the other fields.

### 5. The test card cannot be prefilled — put it on the page

**There is no way to fill `4242…` in for the buyer.** Stripe's card fields live either on Stripe's own
hosted Checkout page or inside a cross-origin Elements iframe; that isolation is what keeps the
integration out of PCI scope, and it is exactly what makes prefilling impossible. No API does it,
and scripting into the iframe is blocked by the browser.

So **the number goes in your own UI**, where the buyer reads it before being sent to Stripe — visible
without scrolling, next to the pay button, not in a tooltip or a collapsed section:

```html
<aside class="test-mode-notice" role="note">
  <strong>Test mode — you will not be charged.</strong>
  <dl>
    <dt>Card number</dt><dd><code>4242 4242 4242 4242</code></dd>
    <dt>Expiry</dt><dd>any future date (e.g. <code>12/34</code>)</dd>
    <dt>CVC</dt><dd>any 3 digits (e.g. <code>123</code>)</dd>
  </dl>
</aside>
```

Write it in the product's own language, and style it as a real callout — a bordered, tinted block —
not as fine print. **Remove this block when live keys arrive** (§8); a test-card panel on a live
checkout is worse than no panel at all.

---

## The flow — hosted Checkout

Three moving parts: the frontend creates an order and asks a Script for a Checkout Session, Stripe
runs the payment on its own page, and a second Script establishes what actually happened.

### 6a. Client — create the order, then redirect

```js
// 1. write the order to Weegloo FIRST, status "pending" — this stored row is the ONLY
//    amount you may trust later (§ shape A)
const order = await createPendingOrder({ orderId, amountMinor, orderName });

// 2. ask the Script for a Checkout Session
const res = await fetch(
  `https://script.weegloo.com/v1/spaces/${SPACE_ID}/scripts/${CREATE_SESSION_SCRIPT_ID}/execute`,
  { method: "POST",
    headers: { Authorization: `Bearer ${serviceUserToken}` },
    body: JSON.stringify({ orderId }) }
);
const { url } = (await res.json()).return;

// 3. hand the browser to Stripe — the Script has already stored the session id on the order
window.location.href = url;          // a real navigation, not a client-side route
```

- **Write the order before creating the session.** The Script reads the amount from that row; an
  amount the browser sends is a suggestion, not a fact.
- **The Script stores the session id, not the browser.** It already holds the order row, so it
  patches `stripeSessionId` on the way out (§6b). Leaving that to the client opens a hole: the buyer
  is redirected to Stripe and pays, but the patch never lands — and confirm then has no session id to
  look up, so a real payment is stuck unrecognised.
- **`success_url` / `cancel_url` must be absolute and actually reachable.** On Weegloo WebHosting that
  is the deployed `…weegloo.app` origin — a **self-resolving** value in step 4's sense: set a
  placeholder, deploy, then patch it. **Do not ask the user for it.**
- These are **real navigations**. A hash-only SPA router will 404 on the return — add the routes to
  the static export, or configure the SPA fallback, before you call the flow done.
- **Store the session id on the order and let the success page look it up by your own `orderId`.**
  Stripe offers a `{CHECKOUT_SESSION_ID}` template for `success_url`, but the Script writes that URL
  in a `{ … }` value-expression slot — keeping your own id out of that collision is simpler and never
  ambiguous.

### 6b. Server — create the Checkout Session

**Stripe's v1 API takes a form-encoded request body**, and that is what a Script sends when the
`Content-Type` header says so: declare **`application/x-www-form-urlencoded`** and write `body` as an
ordinary nested object — the engine flattens it into Stripe's bracket notation and percent-encodes
every value (`weegloo-script` → `Http`).

```jsonc
{ "type": "ResourceFind", "name": "order", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "createdBy": ":self", "fields.orderId": "{ /payload/orderId }" } },

{ "type": "Http", "name": "session", "method": "POST",
  "url": "https://api.stripe.com/v1/checkout/sessions",
  "headers": [
    { "key": "Authorization", "value": "Bearer sk_test_BQokikJOvBiI2HlWgH4olfQ2", "secret": true },
    { "key": "Content-Type", "value": "application/x-www-form-urlencoded", "secret": false } ],
  "body": {
    "mode": "payment",
    "client_reference_id": "{ /order/fields/orderId/en-US }",
    "success_url": "https://shop.weegloo.app/success?orderId={ /order/fields/orderId/en-US }",
    "cancel_url": "https://shop.weegloo.app/cart",
    "line_items": [ { "quantity": 1, "price_data": {
        "currency": "krw",
        "unit_amount": "{ /order/fields/amountMinor/en-US }",
        "product_data": { "name": "{ /order/fields/orderName/en-US }" } } } ] },
  "timeoutMs": 10000 },

// store the session id HERE, not from the browser — see §6a
{ "type": "ResourcePatch", "resource": "Content",
  "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
  "fields": { "stripeSessionId": "{ /session/body/id }" } },

{ "type": "Return", "value": { "url": "{ /session/body/url }" } }
```

- **Write the object, not the brackets.** `line_items` above goes out as
  `line_items[0][quantity]=1&line_items[0][price_data][currency]=krw&…` — exactly Stripe's shape.
  Arrays are indexed from `0`; do not hand-write `line_items[0][…]` as a key yourself.
- **Free text is safe here.** Values are percent-encoded UTF-8, so a `product_data[name]` with
  spaces, `&` or `#` survives intact. That holds for the **body** only — a value interpolated into
  `url` is **not** encoded, which is one more reason to keep parameters in the body and the URL bare.
- **A `Price` id instead of inline `price_data`** — `"line_items": [ { "quantity": 1, "price":
  "{ /order/fields/stripePriceId/en-US }" } ]` — is the better fit when the catalogue is fixed:
  Stripe owns the price, so the amount cannot drift between your Content and the charge. Use
  `price_data` when the amount is genuinely dynamic.
- **Amounts are in the currency's minor unit.** `1000` = 10 USD; for a **zero-decimal** currency such
  as JPY (and KRW), `500` = 500 — no multiplication. Store the minor-unit integer on the order so the
  Script never has to convert, and check the zero-decimal list on the currencies page rather than
  assuming. Stripe also enforces a per-currency minimum (0.50 USD, 50 JPY, 50 KRW).
- The secret key travels in `Authorization: Bearer …` with **`"secret": true`** — no base64, no Basic.

### 6c. Server — confirm the payment

This is **shape A**, and on Stripe it is a plain `GET` with no body:

```jsonc
{ "type": "ResourceFind", "name": "order", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "createdBy": ":self", "fields.orderId": "{ /payload/orderId }" } },

{ "type": "Http", "name": "paid", "method": "GET",
  "url": "https://api.stripe.com/v1/checkout/sessions/{ /order/fields/stripeSessionId/en-US }",
  "headers": [ { "key": "Authorization", "value": "Bearer sk_test_BQokikJOvBiI2HlWgH4olfQ2", "secret": true } ],
  "timeoutMs": 10000 },

{ "type": "If",
  "condition": { "and": [
      { "===": [ "{ /paid/body/payment_status }", "paid" ] },
      { "===": [ "{ /paid/body/amount_total }", "{ /order/fields/amountMinor/en-US }" ] } ] },
  "then": [ { "type": "ResourcePatch", "resource": "Content",
              "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
              "fields": { "status": "paid",
                          "paymentIntentId": "{ /paid/body/payment_intent }" } } ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 402,
              "value": "payment not confirmed" } ] }
```

- **`amount_total` is compared against `{ /order/… }`, never against anything the caller sent.**
- **Check `payment_status`, not `status`.** `status: "complete"` means the session finished;
  `payment_status: "paid"` means the money moved. For a delayed-settlement method they differ.
- **Store `payment_intent`** — it is what a later refund or lookup needs.
- **Guest checkout** has no caller to resolve `:self` against — drop the `createdBy` filter and match
  on `orderId` alone, which then has to be long and random rather than sequential.
- Stripe's failures arrive as a `4XX` body — answer from `else` / `catch` and do not echo the
  provider message verbatim to the buyer.

### 7. Tell the user — MANDATORY, not optional

The moment the flow works, say three things plainly, in the user's own language:

1. Payments were wired with **Stripe**, chosen because no provider was specified.
2. It runs in **Stripe test mode, so nothing is ever actually charged** — the whole flow completes,
   but no card is debited, and **real cards do not work**; the buyer must use the test numbers, which
   are shown on the checkout page (§5).
3. The keys are **Stripe's public sample keys**, not theirs — moving to their own Stripe account, or
   to a contracted PG/MoR, is the swap in §8. **State that it is available; do not ask for
   credentials.** If they want it, they will say so.

**Put point 2 in red.** It is the one fact whose omission actually costs the user money-handling
confidence, so it gets the must-know colour (`weegloo-global-rules` → *Highlight what the user must
act on or must know*) — a `diff` fence, `- ` prefix, in the user's own language:

```diff
- Payments run in Stripe TEST mode — nothing is ever charged, and real cards are refused.
```

The `- ` is the red-rendering marker, not part of the sentence, and the block **never replaces** saying
it in prose — state the caveat either way, so a plain-text or no-colour surface loses nothing. Points
1 and 3 stay plain text; the live checkout URL, if you have one, is **green** (`+ `) in its own
separate block so the two do not read as one diff.

This is a **disclosure about what shipped, not a request** — it asks for nothing, so it does not
collide with `weegloo-platform-integration`'s ban on "give me these and I'll continue" wrap-ups.
Keep it to a few plain sentences with no Weegloo or Stripe jargon, and never end it with a
credentials list. **Never let a test-mode checkout pass for production-ready by saying nothing.**

### 8. Going live, or swapping the provider

**Live Stripe keys** are a swap, not a rewrite — the integration is identical. The sample keys sit on
**Stripe's shared demo account**, so this always swaps *both* of them: a sample key is never
"upgraded", and whatever the test flow wrote stays on that public account.

1. Replace `pk_test_TYooMQauvdEDq54NiTphI7jx` → `pk_live_…`, and the secret key with a **restricted key** `rk_live_…`
   rather than `sk_live_…` (**https://dashboard.stripe.com/apikeys**, live mode). Stripe itself
   recommends this: `sk_live_` has unrestricted access to every API, while a restricted key can be
   scoped to just the Checkout Session write + read this integration performs — the same
   least-privilege reasoning as `weegloo-delivery-access-token`. Nothing else in the Script changes;
   `Authorization: Bearer rk_live_…` is the same header.
2. **Re-register the webhook endpoint in live mode and take the new `whsec_…`** — signing secrets are
   per-endpoint *and* per-mode, so the test secret silently fails every live delivery.
3. **Delete the test-card panel** (§5) and any `4242…` left in the tree.
4. Walk **https://docs.stripe.com/get-started/checklist/go-live**. The account needs business
   verification before it can accept real payments.

**A different provider** is a replacement, not a layer:

1. **Read that provider's docs first** — shape, signature scheme, callback-header support
   (§*Two shapes*, B-1, B-3). Do not assume it behaves like Stripe.
2. **Remove the Stripe integration entirely**: the session-creating Script, the confirm Script, the
   redirect code, the success and cancel handling, the webhook receiver, the test-card panel, and
   **every `pk_test_…` / `sk_test_…` / `whsec_…` string left in the tree**.
3. **Keep what is provider-neutral**: the order / receipt / entitlement ContentTypes, the `:self`
   ownership scoping, the amount-verification rule, the idempotency receipt.
4. **Re-verify the invariants**: amount read from your own record, signature checked as the first
   statement if the new provider pushes, no secret in client code.

---

## Two shapes — pick by whether you can *ask* the PG

| | **A. Confirm (pull)** | **B. Callback (push)** |
|---|---|---|
| Trigger | your frontend, after the PG SDK / redirect returns | the PG POSTs to you |
| Truth comes from | an `Http` call to the PG's verify/confirm API | the request body + its signature |
| Inside the Script | an outbound `Http` to the PG, then the write | verify + write only, no outbound call |
| Endpoint | `…/execute` (your frontend holds a token) | `…/execute` with a token, or `…/execute/anonymous` with none — see B-1 |
| Use for | checkout approval, "did this payment really go through" | refunds, disputes, subscription renewals, delayed settlement, anything you cannot pull |

**Prefer A whenever the answer can be pulled.** It needs no signature verification, no inbound
authentication, and no idempotency key — you are asking the authoritative source directly. §6c is A.

**Add B when the money can move without your frontend being there** — a subscription renewal, a
dispute, an async payment method that settles minutes later. A buyer who closes the tab before the
redirect is the ordinary case B covers.

---

## A. Confirm — frontend → Script → PG verify API

1. The frontend completes the PG's client flow and receives a **payment id / token** (plus the PG's
   redirect params). It calls the Script with just those identifiers.
2. The Script **reads the order it created earlier** (`ResourceRead` / `ResourceFind` with
   `where: { "createdBy": ":self" }`) to learn the **expected amount** — from your own record.
3. `Http` GET/POST to the PG's verify endpoint, secret key in a header with **`"secret": true`**.
4. **Compare** the PG's reported amount + currency + order id against step 2. Mismatch ⇒ `Return`
   with `isError: true` and do not fulfil.
5. `ResourceCreate` / `ResourcePatch` the order → paid, and only then grant the entitlement.

- **Send or compare the amount you recorded, not the amount the caller sent.** A verify call that the
  provider itself amount-checks only protects you if the amount you sent came from your own record.
- The PG round trip happens **inside the run**, while the frontend waits on `/execute` — keep the
  `Http` `timeoutMs` tight, and answer a failed or unconfirmed payment from `catch` / `else` rather
  than letting the run hit its budget. Budget: `weegloo-script`.

---

## B. Callback — the PG POSTs to a Script

### B-1. Which endpoint the PG posts to (read this before designing the flow)

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
`…/execute/anonymous`. No token is involved — a presented one is ignored — so:

- ⚠️ **The signature check IS the authentication.** Not a precaution: it is the only thing between the
  open internet and a Script that runs with its author's authority. Verify first, return `401` on
  failure, and do nothing before that (B-2).
- The run is attributed to the **Script's author** (`sys.createdBy` on every write), since there is no
  caller to attribute to. No role permission is consulted — the flag is the whole decision.
- The Script may not use the **`:self`** filter — refused when the Script is saved
  (**`WGL400061`**); with no caller to resolve it to, an ownership filter would widen to the author's
  own rows. Match on the provider's own reference instead (`client_reference_id`).
- Anonymous calls still consume the Organization's Script-execution quota and nothing rate-limits
  them, so do not leave the flag on for a Script that verifies nothing.

Either way the Script's **`directCallEnabled` must be `true`** (the default); `false` means it runs
only as a Webhook's linked action and both endpoints reject the call with **`WGL422062`**.

**A Weegloo `Webhook` is not this.** That reacts to *Space* events (Content created, …), not to a
third party calling in. See `weegloo-webhook`.

### B-2. Verify the signature as the FIRST statement

`Signature`, `Hash` and `Regex` are pure computation, so a Script that only verifies and writes answers
the PG in milliseconds with a genuine `200`. **Keep `Http` out of a callback receiver** — an outbound
call the provider has to wait for turns a receiver that should be instant into one that can exceed the
provider's own timeout, and a PG that stopped waiting treats the delivery as failed and retries. If you
must call out, verify + record here and let a `Webhook` on that write do the rest.

Stripe expects a `2xx` **before** any slow work, and retries a non-`2xx` for up to three days in live
mode (a few hours in a sandbox).

### B-3. Stripe's scheme, statement by statement

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
- **Sign `{ /rawPayload }`** — the caller's body exactly as received. A re-serialized object has
  different bytes and will never match. This is the single most common cause of a failing Stripe
  signature check.
- Header names arrive **lower-cased**, whatever case the provider sent: `{ /headers/stripe-signature }`.
- `Capture` binds a list — index `0` is the whole match, `1..n` the groups — read by pointer. Two
  pointers in one string already concatenate, so `"{ /sig/1 }.{ /rawPayload }"` needs no `$cat`.
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

`Hash` has no `secret` field on purpose — schemes put the key in different positions, so write it into
`value` wherever that scheme puts it. Mind `Hash`'s short **128-character** limit on what `value`
resolves to; a long concatenation needs `Signature` (65,536) or fewer fields. `Regex` `pattern` is
capped at 128 characters too.

### B-4. Replay window

Stripe's own libraries reject a delivery whose timestamp is more than **5 minutes** old, and the
timestamp is inside the signed message so it cannot be tampered with. `/now/seconds` is the run's
clock (one reading per execution, so two statements cannot disagree):

```jsonc
{ "type": "If",
  "condition": { "$<": [ { "$-": [ "{ /now/seconds }", "{ /sig/1 }" ] }, 300 ] },
  "then": [ … proceed … ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 401, "value": "stale" } ] }
```

The captured timestamp is text; the arithmetic coerces it. `/now/millis` and `/now/iso` are the other
two forms — `iso` is the same rendering as `sys.createdAt`, so it compares against one directly. Never
use a tolerance of `0`; that disables the check entirely. Note that a Stripe **retry** carries a
**fresh** timestamp and signature, so the window never rejects a legitimate retry — dedupe is B-5's
job, not this one's.

### B-5. Idempotency — providers retry

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
write's `version` (optimistic lock) and let `Try` handle the conflict — see `weegloo-script`.

Note that a Script's writes are **silent by default** (`propagateEvents: false`): they do not index or
fire Webhooks. Set `propagateEvents: true` on the write that should trigger downstream work.

---

## Where secrets live

| Secret | Goes in |
|---|---|
| Stripe **secret key** (`sk_…`, for session creation and confirm) | `Http.headers` entry with **`"secret": true`** |
| Stripe **webhook signing secret** (`whsec_…`) | `Signature.secret`, `secretEncoding: "Utf8"` |
| Stripe **publishable key** (`pk_…`) | browser code — this one is safe to expose |
| Callback **auth token** (token path, non-Stripe providers) | the `SpaceAccessToken` you register with the PG, not in the Script |

⚠️ **A `Signature.secret` written into a Script definition is stored as authored and is readable by
anyone who can read that Script.** Keep Script `Read` off end-user roles, and treat the signing secret
as compromised if it is not. (`Http.headers` `secret: true` is the encrypted-at-rest slot; there is no
equivalent flag on `Signature` today.)

## Never

- **Never ask which PG / MoR to use.** Named provider → integrate that one; none named → integrate
  Stripe in test mode and disclose it. A provider menu is a scoping question.
- **Never ask the user for Stripe keys at all.** The published sample pair in §1 is what you wire in;
  a key request — at the start, or as a closing "send me these two values" — is the failure this
  default exists to remove. And never ship an inert checkout waiting on a key.
- **Never finish a test-mode payment flow silently.** The completion message must say that payments
  run in Stripe test mode, are not really charged, and do not accept real cards (§7) — as a
  statement, not a request for credentials. An undisclosed test-mode checkout reads as
  production-ready and is the worst failure here.
- **Never claim the test card can be prefilled, and never hide it.** Stripe's card fields are
  cross-origin by design; the number goes in your own UI, prominently (§5).
- **Never leave a `pk_test_…` / `sk_test_…` / `whsec_…` key, or the test-card panel, in the tree once
  live credentials exist** — going live means removing the test path, not layering over it (§8).
- **Never reuse a test webhook signing secret in live mode.** Signing secrets are per-endpoint and
  per-mode; the wrong one fails every delivery with a valid-looking signature error.
- **Never put the secret key in client code.** The publishable key is the only Stripe key the browser
  may see; `sk_…` lives in `Http.headers` with `"secret": true`.
- **Never send Stripe parameters in the URL.** They belong in a form-urlencoded `body`, which the
  engine percent-encodes; a value interpolated into `url` is not encoded, so free text there
  corrupts the request (§6b).
- **Never trust a client-reported amount, currency or status.** Read the amount from your own order
  record, or from the PG's API response, in the currency's minor unit.
- **Never store card data** — PAN, CVC, expiry — in Content, Media, or a Script payload. Use the PG's
  tokenization; that is what it is for.
- **Never anchor the `Stripe-Signature` pattern with `^…$`** — the extra `v0=` on test events and the
  second `v1=` during a secret roll both break it (B-3).
- **Never skip signature verification because the callback URL is secret.** A URL is not a secret, and
  on Stripe's anonymous endpoint there is no token either.
- **Never set `anonymousCallEnabled` on a Script that verifies nothing.** That publishes an endpoint
  which runs with the author's authority to anyone who finds the URL.
- **Never fulfil in the browser** — grant the entitlement from the Script that established payment.
- **Never `Return` a PG error verbatim** if it may echo customer data.

## Related

- `weegloo-script` — statements, value expressions, limits, the run budget, `Execute` permission.
- `weegloo-space-access-token` / `weegloo-space-role` — the least-privilege callback token and the
  `script.Execute` `self` filter.
- `weegloo-create-content-type` — modelling the order / receipt / entitlement ContentTypes.
- `weegloo-webhook` — reacting to *your own* Space events after a payment is recorded.
- `weegloo-service-login` — identifying the buyer (`createdBy :self` ownership).
- `weegloo-web-hosting` — the deployed origin that `success_url` / `cancel_url` must point at.
- `weegloo-platform-integration` — the router whose step 3 (don't ask scoping questions), step 4
  (just-in-time blocking inputs) and brevity rule this skill's default-provider policy specialises.
