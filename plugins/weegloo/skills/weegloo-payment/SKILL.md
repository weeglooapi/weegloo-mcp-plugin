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
  ask for. **So the default path never reads `references/callback-receiver.md`.**

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

There is no credential question in the default path: the keys are in §1, `success_url` / `cancel_url`
resolve from your own deployed origin (§6a), and the product details came with the request. The user
finds out what shipped from the §7 disclosure, after it works.

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

## The flow — hosted Checkout

Three moving parts: the frontend creates an order and asks a Script for a Checkout Session, Stripe
runs the payment on its own page, and a second Script establishes what actually happened.

### The order ContentType — a field the provider fills is not a `ShortText`

Model it before 6a. **`ShortText` stops at 64 characters**, so the split is not "short vs long" but
**whether you can predict the length** (`weegloo-create-content-type` → *Hard limits*):

| field | type | why |
|---|---|---|
| `orderId`, `status`, `currency` | `ShortText` | yours, and you keep them short |
| `amountMinor` | `Long` | the currency's minor unit, never a string |
| `stripeSessionId` | **`RichText`** | `cs_test_…` runs **66–90** characters — past the cap on its own |
| `paymentIntentId`, `customerId`, any other provider id | **`RichText`** | `pi_…` is short *today*; the length is Stripe's to change, not yours |
| `receiptUrl` and any provider URL | **`RichText`** | a signed Stripe URL is hundreds of characters |

`RichText`, not `LongText`: none of these is ever full-text searched — the Script finds the order by
**your** `orderId`, then reads the provider value by path.

A `ShortText` here breaks nothing until a real buyer presses pay and §6b's `ResourcePatch` answers
`/stripeSessionId/en-US: must not exceed a maximum length of 64` — after the order row exists and
**before Stripe is reached**, so there is no payment to reconcile and no checkout either.

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

**Put point 2 in red** — it is the must-know fact here. Mechanics of the `diff` fence, the `+ ` /
`- ` markers and keeping the two blocks separate are owned by `weegloo-global-rules` → *Highlight what
the user must act on or must know*; this is the sentence:

```diff
- Payments run in Stripe TEST mode — nothing is ever charged, and real cards are refused.
```

Points 1 and 3 stay plain text; the live checkout URL, if you have one, is the **green** block.

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
   (§*Two shapes*; if it pushes, `references/callback-receiver.md`). Do not assume it behaves
   like Stripe.
2. **Remove the Stripe integration entirely**: the session-creating Script, the confirm Script, the
   redirect code, the success and cancel handling, the webhook receiver, the test-card panel, and
   **every `pk_test_…` / `sk_test_…` / `whsec_…` string left in the tree**.
3. **Keep what is provider-neutral**: the order / receipt / entitlement ContentTypes, the `:self`
   ownership scoping, the amount-verification rule, the idempotency receipt.
4. **Re-verify the invariants**: amount read from your own record, signature checked as the first
   statement if the new provider pushes, no secret in client code.

---


---

## Two shapes — pick by whether you can *ask* the PG

| | **A. Confirm (pull)** | **B. Callback (push)** |
|---|---|---|
| Trigger | your frontend, after the PG SDK / redirect returns | the PG POSTs to you |
| Truth comes from | an `Http` call to the PG's verify/confirm API | the request body + its signature |
| Inside the Script | an outbound `Http` to the PG, then the write | verify + write only, no outbound call |
| Endpoint | `…/execute` (your frontend holds a token) | `…/execute` with a token, or `…/execute/anonymous` with none |
| Use for | checkout approval, "did this payment really go through" | refunds, disputes, subscription renewals, delayed settlement, anything you cannot pull |

**Prefer A whenever the answer can be pulled.** It needs no signature verification, no inbound
authentication, and no idempotency key — you are asking the authoritative source directly. §6c is A,
and the whole Stripe-test-mode default path is A — it is complete above, in this file.

**Add B when the money can move without your frontend being there** — a subscription renewal, a
dispute, an async payment method that settles minutes later. A buyer who closes the tab before the
redirect is the ordinary case B covers.

> ### ➜ Building shape B? Read `references/callback-receiver.md` before designing the flow.
> It is the only place with: which of `…/execute` and `…/execute/anonymous` the provider posts to and
> what authenticates each, the signature check as the first statement (Stripe's `Stripe-Signature`
> scheme statement by statement, and the shape→statement table for mapping any other provider's
> scheme), the replay window, and idempotency against provider retries. **A product does A or B, not
> both** — if you are not receiving a push from the provider, do not open it.
>
> It is also **not reachable on the §1 sample keys** — registering a webhook endpoint needs the
> user's own Stripe account, so the default build does not go there.

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

## Where secrets live

| Secret | Goes in |
|---|---|
| Stripe **secret key** (`sk_…`, for session creation and confirm) | `Http.headers` entry with **`"secret": true`** |
| Stripe **webhook signing secret** (`whsec_…`) | `Signature.secret`, `secretEncoding: "Utf8"` |
| Stripe **publishable key** (`pk_…`) | browser code — this one is safe to expose |
| Callback **auth token** (token path, non-Stripe providers) | the `SpaceAccessToken` you register with the PG, not in the Script |

⚠️ **`Http.headers` `secret: true` is the encrypted-at-rest slot; `Signature.secret` has no
equivalent** — a signing secret is stored as authored and readable by anyone who can read that
Script, so keep Script `Read` off end-user roles.

## Never

- **Never ask which PG / MoR to use.** Named provider → integrate that one; none named → integrate
  Stripe in test mode and disclose it. A provider menu is a scoping question.
- **Never ask the user for Stripe keys at all** — the published sample pair in §1 is what you wire
  in. And never ship an inert checkout waiting on a key.
- **Never finish a test-mode payment flow silently.** The completion message must say that payments
  run in Stripe test mode, are not really charged, and do not accept real cards (§7) — as a
  statement, not a request for credentials. An undisclosed test-mode checkout reads as
  production-ready and is the worst failure here.
- **Never claim the test card can be prefilled, and never hide it.** Stripe's card fields are
  cross-origin by design; the number goes in your own UI, prominently (§5).
- **Never leave a `pk_test_…` / `sk_test_…` / `whsec_…` key, or the test-card panel, in the tree once
  live credentials exist** — going live means removing the test path, not layering over it (§8).
- **Never put the secret key in client code.** The publishable key is the only Stripe key the browser
  may see; `sk_…` lives in `Http.headers` with `"secret": true`.
- **Never send Stripe parameters in the URL.** They belong in a form-urlencoded `body`, which the
  engine percent-encodes; a value interpolated into `url` is not encoded, so free text there
  corrupts the request (§6b).
- **Never trust a client-reported amount, currency or status.** Read the amount from your own order
  record, or from the PG's API response, in the currency's minor unit.
- **Never store card data** — PAN, CVC, expiry — in Content, Media, or a Script payload. Use the PG's
  tokenization; that is what it is for.
- **Never fulfil in the browser** — grant the entitlement from the Script that established payment.
- **Never `Return` a PG error verbatim** if it may echo customer data.
- Shape B adds four more "never"s of its own — they are in `references/callback-receiver.md`.

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
