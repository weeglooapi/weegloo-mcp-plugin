# Stripe — the whole integration, for when Stripe was named

Read this **only when** the provider is Stripe — named in the design, in the prompt, or by a
`pk_test_…` / `sk_test_…` already sitting in the repo / env. `SKILL.md` makes that call; once it
lands here, this file is the entire Stripe integration — keys, ContentTypes, Scripts, checkout
page, disclosure, go-live — and the Toss Payments sections of `SKILL.md` are not used alongside
it. Section numbers (§1 … §8) below refer to this file.

> **Nobody named Stripe? Stop — this is the wrong file.** A payment request that names no provider is
> the **Toss Payments** default in `SKILL.md`. Stripe is never this version's default or its fallback,
> and Stripe's published sample pair (§1) sitting in the tree names no provider. This file is the
> named-Stripe path only.

**This is about the product charging its own customers**, using Weegloo as the backend. Weegloo's own
subscription and plan billing is a different thing entirely and is not configured from here.

## The constraint that decides the architecture

Weegloo hosts no backend of yours. **The only place your server-side payment logic can run is a
Script** (`weegloo-script`) — which means:

> **The browser may never be what decides a payment succeeded — or what it costs.** Inside a
> Script, the amount and currency to charge come from the Script and rows the buyer cannot write,
> and the status from what the PG said. None of the three comes from the request payload, or from
> a row the buyer wrote: a server-side check against the buyer's own number checks nothing.

Everything below is a consequence of that one rule.

## Provider — decided before you got here, and never a key request

`SKILL.md` chose the provider: **you are reading this because Stripe was named** — in the design, by
the user, or by a Stripe key already in the repo / env. Do not reopen that choice, and do not ask
which PG / MoR to use. Named with no credentials sent is **still nothing to ask for**: the published
sample pair in §1 is what you wire in, and the only key conversation is §8, if *they* raise it.

---

## Stripe in test mode

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

- **Build the whole integration with these keys already wired in** — product and order
  ContentTypes, the buyer's role, checkout page, session Script, confirm Script, success and cancel
  pages. The flow then runs end to end for the user on delivery: no key request, no half-built
  checkout.
- **Never ask the user for keys.** Not up front, not as a closing "send me these two values and I'll
  continue". The only key conversation is §8, if *they* decide to go live or move to their own
  account.
- ⚠️ **That demo account is shared and public.** Anyone holding the published secret key can read
  what it holds, so treat everything the test flow sends to Stripe as public and never put real
  customer data through it. The order rows on the Weegloo side are yours and unaffected.
- **Shape B (webhook receiver) cannot run on it** — registering an endpoint and getting a
  `whsec_…` requires dashboard access to an account you own. Build **shape A** (§6c) on the sample
  keys; a webhook receiver waits for the user's own account (§8). It is not something you stop and
  ask for. **So this path never reads `references/stripe-callback-receiver.md` on the sample keys.**

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

There is no credential question on this path: the keys are in §1, `success_url` / `cancel_url`
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

Three moving parts: the frontend tells a Script what the buyer is buying, and that Script prices it
from the product row, creates the order and returns a Checkout Session; Stripe runs the payment on
its own page; and a second Script establishes what actually happened.

### The order ContentType — a field the provider fills is not a `ShortText`

Model it before 6a. **`ShortText` stops at 64 characters**, so the split is not "short vs long" but
**whether you can predict the length** (`weegloo-create-content-type` → *Hard limits*):

| field | type | why |
|---|---|---|
| `orderId`, `status`, `currency` | `ShortText` | yours, and you keep them short |
| `product` | `Refer` → Content (`referContentType`: the product type) | a relationship is a `Refer`, not an id in a `ShortText` (`weegloo-create-content-type`) |
| `amountMinor`, `quantity` | `Long` | integers, never strings — `amountMinor` in the currency's minor unit, **written only by the §6b Script** |
| `stripeSessionId` | **`RichText`** | `cs_test_…` runs **66–90** characters — past the cap on its own |
| `paymentIntentId`, `customerId`, any other provider id | **`RichText`** | `pi_…` is short *today*; the length is Stripe's to change, not yours |
| `receiptUrl` and any provider URL | **`RichText`** | a signed Stripe URL is hundreds of characters |

`RichText`, not `LongText`: none of these is ever full-text searched — the Script finds the order by
**your** `orderId`, then reads the provider value by path.

A `ShortText` here breaks nothing until a real buyer presses pay and §6b's `ResourceCreate` answers
`/stripeSessionId/en-US: must not exceed a maximum length of 64` — **before the buyer is sent to
Stripe**, so there is no payment to reconcile and no checkout either.

### The product ContentType and the buyer's role — who may write a price

**The amount to charge is computed in the §6b Script from a product row the buyer cannot write.**
Skip any line below and every check in §6b and §6c still runs, and still passes — against a number
the buyer chose.

| product field | type | why |
|---|---|---|
| `name` | `LongText` | shown on Stripe's page; its length is the catalogue's, not yours |
| `priceMinor` | `Long` | the unit price in the currency's minor unit — the only price §6b charges |
| `stripePriceId` | `RichText` | optional — a Stripe `Price` id (§6b); a provider id, like `stripeSessionId` |

- **Staff write product rows** (console / CMA) **and publish them** — §6b reads the published copy,
  the same one the catalogue page shows. The buyer's role may `Read` them, never more.
- **The buyer's `ServiceUserRole` has no `Create`, `Edit`, `Delete` or `All` on the order ContentType**
  (nor the entitlement one): with `Create` a buyer posts any `amountMinor` for any product, or a row
  already `"paid"`; with `Edit` they rewrite it. `Read` scoped to `createdBy :self` is the most it
  gets (to read it over ACDA, the order ContentType needs `publishWithAuthor: true`).
- ⚠️ **A `createdBy :self` rule without a `contentType` — the usual member default — reaches the
  orders anyway.** A Script's writes are attributed to the buyer who ran it, so every order §6b
  creates is "theirs". Give every `Create`, `Edit`, `Delete` or `All` rule a `contentType`, and none
  of them the order's.
- **`script.Execute`, pinned with `self` to the session Script and the confirm Script** — the
  session Script is then the only way an order comes into existence. Author both as a Space admin;
  they read products and write orders with the author's authority (`weegloo-script` → *Secrets &
  auth*).

```json
"content": { "Read": { "Allow": [ {
    "contentType": { "sys": { "type": "Refer", "id": "<orderCtId>", "targetType": "ContentType" } },
    "createdBy":   { "sys": { "type": "Refer", "id": ":self", "targetType": "User" } } } ] } },
"script": { "Execute": { "Allow": [
    { "self": { "sys": { "type": "Refer", "id": "<sessionScriptId>", "targetType": "Script" } } },
    { "self": { "sys": { "type": "Refer", "id": "<confirmScriptId>", "targetType": "Script" } } } ] } }
```

### 6a. Client — send what is being bought, then redirect

```js
// 1. send WHAT is being bought — never a price, never an order row: the Script prices it and
//    creates the order (§6b). The id is made here because a Script has no randomness.
const orderId = crypto.randomUUID();
const res = await fetch(
  `https://script.weegloo.com/v1/spaces/${SPACE_ID}/scripts/${CREATE_SESSION_SCRIPT_ID}/execute`,
  { method: "POST",
    headers: { Authorization: `Bearer ${serviceUserToken}` },
    body: JSON.stringify({ orderId, productId, quantity }) }
);
const { url } = (await res.json()).return;

// 2. hand the browser to Stripe — the Script has already created the order, session id included
window.location.href = url;          // a real navigation, not a client-side route
```

- **The browser never writes the order and never sends a price.** §6b reads the price from the
  product row and multiplies it by the checked `quantity` itself. An order row the buyer wrote is the
  buyer's own number with a server-side label: §6b would faithfully charge, and §6c faithfully
  confirm, an `amountMinor` of `100` on a 10,000 item.
- **The Script stores the session id, not the browser.** It writes `stripeSessionId` into the order
  it creates (§6b). Leaving that to the client opens a hole: the buyer is redirected to Stripe and
  pays, but the write never lands — and confirm then has no session id to look up, so a real payment
  is stuck unrecognised.
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
// the price comes from the product row — its published copy, which only staff write
{ "type": "ResourceRead", "name": "product", "resource": "Content", "from": "Published",
  "target": { "sys": { "id": "{ /payload/productId }" } } },

// a by-id read takes ANY Content id, so check the type; quantity and orderId are buyer input
// (10 = your own cap)
{ "type": "If",
  "condition": { "or": [
      { "!==": [ "{ /product/sys/contentType/sys/id }", "<productCtId>" ] },
      { "!": { ">": [ "{ /product/fields/priceMinor/en-US }", 0 ] } },
      { "<": [ "{ /payload/quantity }", 1 ] },
      { ">": [ "{ /payload/quantity }", 10 ] },
      { "!==": [ { "%": [ "{ /payload/quantity }", 1 ] }, 0 ] },
      { "!": "{ /payload/orderId }" } ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 400, "value": "invalid item" } ] },

{ "type": "Http", "name": "session", "method": "POST",
  "url": "https://api.stripe.com/v1/checkout/sessions",
  "headers": [
    { "key": "Authorization", "value": "Bearer { /secrets/STRIPE_SECRET_KEY }" },
    { "key": "Content-Type", "value": "application/x-www-form-urlencoded" } ],
  "body": {
    "mode": "payment",
    "client_reference_id": "{ /payload/orderId }",
    "success_url": "https://shop.weegloo.app/success?orderId={ /payload/orderId }",
    "cancel_url": "https://shop.weegloo.app/cart",
    "line_items": [ { "quantity": "{ /payload/quantity }", "price_data": {
        "currency": "krw",
        "unit_amount": "{ /product/fields/priceMinor/en-US }",
        "product_data": { "name": "{ /product/fields/name/en-US }" } } } ] },
  "timeoutMs": 10000 },

// the order is created HERE, by the Script, with the Script's number in it — see §6a
{ "type": "ResourceCreate", "resource": "Content", "locale": "en-US",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "fields": { "orderId": "{ /payload/orderId }", "status": "pending", "currency": "krw",
              "product": { "sys": { "type": "Refer", "id": "{ /product/sys/id }", "targetType": "Content" } },
              "quantity": "{ /payload/quantity }",
              "amountMinor": { "$*": [ "{ /product/fields/priceMinor/en-US }", "{ /payload/quantity }" ] },
              "stripeSessionId": "{ /session/body/id }" } },

{ "type": "Return", "value": { "url": "{ /session/body/url }" } }
```

- **The order create needs no `propagateEvents`** — that flag only fires Webhooks. §6c finds the
  order with a `ResourceFind` on the indexed copy, which picks the create up about a second later
  either way; the buyer is back from checkout long after that.
- **A cart** prices every line the same way — `Loop` over the lines with a declared
  `maxIterations`, each line priced from its own product row, `SetVar` to add them up
  (`weegloo-script`) — and stores the lines it priced; it never totals what the page sent.
- **Write the object, not the brackets.** `line_items` above goes out as
  `line_items[0][quantity]=2&line_items[0][price_data][currency]=krw&…` for a quantity of 2 —
  exactly Stripe's shape.
  Arrays are indexed from `0`; do not hand-write `line_items[0][…]` as a key yourself.
- **Free text is safe here.** Values are percent-encoded UTF-8, so a `product_data[name]` with
  spaces, `&` or `#` survives intact. That holds for the **body** only — a value interpolated into
  `url` is **not** encoded, which is one more reason to keep parameters in the body and the URL bare.
- **A `Price` id instead of inline `price_data`** — a line item `"price":
  "{ /product/fields/stripePriceId/en-US }"`, with the order recording `"amountMinor":
  "{ /session/body/amount_total }"` — fits a fixed catalogue on the user's **own** Stripe account
  (§8): Stripe owns the price, so it cannot drift from the charge. The §1 sample account holds no
  Prices of yours, so a sample-key build prices inline from `priceMinor`. Either way it is read from
  the **product** row — a price or Price id taken from the payload or the order is one the buyer
  picked.
- **Amounts are in the currency's minor unit.** `1000` = 10 USD; for a **zero-decimal** currency such
  as JPY (and KRW), `500` = 500 — no multiplication. Store the minor-unit integer on the product row
  so the Script never has to convert, and check the zero-decimal list on the currencies page rather
  than assuming. Stripe also enforces a per-currency minimum (0.50 USD, 50 JPY, 50 KRW).
- **The secret key is a Script secret**, never a literal in the statements. Declare it in this
  Script's `definition.secrets` — `{ "key": "STRIPE_SECRET_KEY", "value":
  "sk_test_BQokikJOvBiI2HlWgH4olfQ2", "description": "Stripe secret key" }` — and send it as
  `Authorization: Bearer { /secrets/STRIPE_SECRET_KEY }`: no base64, no Basic. Secrets belong to one
  Script, so the confirm Script (§6c) declares the same entry.

### 6c. Server — confirm the payment

This is **shape A**, and on Stripe it is a plain `GET` with no body:

```jsonc
{ "type": "ResourceFind", "name": "order", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "createdBy": ":self", "fields.orderId": "{ /payload/orderId }" } },

{ "type": "If", "condition": { "==": [ "{ /order }", null ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 404, "value": "unknown order" } ] },

// a search reads the indexed copy, which need not hold the `paid` patch — read the row by id
{ "type": "ResourceRead", "name": "current", "resource": "Content",
  "target": { "sys": { "id": "{ /order/sys/id }" } } },

{ "type": "If", "condition": { "===": [ "{ /current/fields/status/en-US }", "paid" ] },
  "then": [ { "type": "Return", "value": "already paid" } ] },

{ "type": "Http", "name": "paid", "method": "GET",
  "url": "https://api.stripe.com/v1/checkout/sessions/{ /order/fields/stripeSessionId/en-US }",
  "headers": [ { "key": "Authorization", "value": "Bearer { /secrets/STRIPE_SECRET_KEY }" } ],
  "timeoutMs": 10000 },

{ "type": "If",
  "condition": { "and": [
      { "===": [ "{ /paid/body/payment_status }", "paid" ] },
      { "===": [ "{ /paid/body/amount_total }", "{ /order/fields/amountMinor/en-US }" ] } ] },
  "then": [ { "type": "Try",
              "body": [ { "type": "ResourcePatch", "resource": "Content",
                          "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
                          "version": "{ /current/sys/version }",
                          "fields": { "status": "paid",
                                      "paymentIntentId": "{ /paid/body/payment_intent }" } } ],
              "catch": [ { "type": "Return", "isError": true, "statusCode": 409,
                           "value": "retry" } ] } ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 402,
              "value": "payment not confirmed" } ] }
```

- **`amount_total` is compared against `{ /order/… }`, never against anything the caller sent** —
  and that row is worth comparing against only because §6b wrote it from the product row. Against an
  order row the buyer could write, this check compares the buyer's number with itself.
- **Check `payment_status`, not `status`.** `status: "complete"` means the session finished;
  `payment_status: "paid"` means the money moved. For a delayed-settlement method they differ.
- **Store `payment_intent`** — it is what a later refund or lookup needs.
- **Grant once.** The verify `GET` consumes nothing, so a replayed call passes the check again and
  would re-run whatever you grant after the patch. Hence the `ResourceRead` by id — a search reads
  the indexed copy, which need not hold the `paid` patch; `ResourceRead` never uses the index — and
  the early `Return` for an order that already reads paid, before any `Http`. The `version` lock
  sends a concurrent second call to the `catch` (`409`; called again, it answers `already paid`)
  instead of granting twice.
- **That early `Return` skips the grant too**, so a grant that fails after the patch is never
  retried. Put the grant after the `Try`, in a `Try` of its own whose `catch` patches `status` back
  to `pending` and returns an error — the next call then verifies and grants again. Keep the grant
  one write, or key it on the order, so a rerun cannot duplicate part of it. Never revert in the
  patch's `catch`: that call lost the race, and would undo the winner's `paid`.
- **Guest checkout** has no caller to resolve `:self` against — drop the `createdBy` filter and match
  on `orderId` alone, which then has to be long and random rather than sequential (§6a's
  `crypto.randomUUID()` is). The `SpaceAccessToken` a guest calls with gets `script.Execute` on the
  two Scripts and nothing on orders — no write, and not the buyer's `Read` either: every guest shares
  that token's `:self`, so that rule would show each guest every guest's order.
- Stripe's failures arrive as a `4XX` body — answer from `else` / `catch` and do not echo the
  provider message verbatim to the buyer.

### 7. Tell the user — MANDATORY, not optional

The moment the flow works, say three things plainly, in the user's own language:

1. Payments were wired with **Stripe**, because the design / the user named it.
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
   least-privilege reasoning as `weegloo-delivery-access-token`. Only the `STRIPE_SECRET_KEY`
   secret's value changes, in both Scripts; the statements stay as they are.
2. **Re-register the webhook endpoint in live mode and put the new `whsec_…` in the receiver
   Script's `STRIPE_WEBHOOK_SECRET`** — signing secrets are per-endpoint *and* per-mode, so the test
   secret silently fails every live delivery.
3. **Delete the test-card panel** (§5) and any `4242…` left in the tree.
4. Walk **https://docs.stripe.com/get-started/checklist/go-live**. The account needs business
   verification before it can accept real payments.

**A different provider** is a replacement, not a layer:

1. **Read that provider's docs first** — shape, signature scheme, callback-header support
   (§*Two shapes*; if it pushes, `references/stripe-callback-receiver.md`). Do not assume it behaves
   like Stripe.
2. **Remove the Stripe integration entirely**: the session Script's Stripe `Http` call and
   `stripeSessionId` write (keep its product read, guard and order create), the confirm Script, the
   redirect code, the success and cancel handling, the webhook receiver, the test-card panel, and
   **every `pk_test_…` / `sk_test_…` / `whsec_…` string left in the tree**.
3. **Keep what is provider-neutral**: the product / order / receipt / entitlement ContentTypes, the
   buyer's role (no write on orders), the `:self` ownership scoping, the amount-verification rule,
   the idempotency receipt.
4. **Re-verify the invariants**: the amount priced by a Script from product rows the buyer cannot
   write, the order created by that Script, signature checked as the first statement if the new
   provider pushes, no secret in client code.

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
authentication, and no idempotency key — you are asking the authoritative source directly, though
granting only once is still yours (*A. Confirm* step 5). §6c is A, and the whole Stripe test-mode
path is A — it is complete above, in this file.

**Add B when the money can move without your frontend being there** — a subscription renewal, a
dispute, an async payment method that settles minutes later. A buyer who closes the tab before the
redirect is the ordinary case B covers.

> ### ➜ Building shape B? Read `references/stripe-callback-receiver.md` before designing the flow.
> It is the only place with: which of `…/execute` and `…/execute/anonymous` the provider posts to and
> what authenticates each, the signature check as the first statement (Stripe's `Stripe-Signature`
> scheme statement by statement, and the shape→statement table for mapping any other provider's
> scheme), the replay window, and idempotency against provider retries. **A product does A or B, not
> both** — if you are not receiving a push from the provider, do not open it.
>
> It is also **not reachable on the §1 sample keys** — registering a webhook endpoint needs the
> user's own Stripe account, so a sample-key build does not go there.

---

## A. Confirm — frontend → Script → PG verify API

1. The frontend completes the PG's client flow and receives a **payment id / token** (plus the PG's
   redirect params). It calls the Script with just those identifiers.
2. The Script **reads the order a Script created earlier** (`ResourceRead` / `ResourceFind` with
   `where: { "createdBy": ":self" }`) to learn the **expected amount** — priced from rows the
   buyer cannot write (§6b), never an order row the buyer wrote.
3. `Http` GET/POST to the PG's verify endpoint, the secret key read from **`{ /secrets/<key> }`** in
   a header.
4. **Compare** the PG's reported amount + currency + order id against step 2. Mismatch ⇒ `Return`
   with `isError: true` and do not fulfil.
5. `ResourcePatch` the order → paid, and only then grant the entitlement — **once**: a verify call
   that consumes nothing passes again when replayed, so re-read the order by id (a search reads the
   indexed copy, which need not hold the patch), skip it if it already reads paid, and patch with
   that read's `sys.version` as `version`, so a concurrent second call fails instead of granting
   twice. If the grant then fails, patch the order back to unpaid so the next call grants again.
   Where the verify call is the approval itself — a capture or approve call rather than a read —
   decide from the PG's lookup API instead: an approval's reply can be lost after it succeeded, and
   a repeated approval need not say whether the first went through. A lookup that still shows that
   approval in progress is a retry, not a failure.

- **Send or compare the amount you recorded, not the amount the caller sent** — and an order row the
  caller wrote *is* the amount the caller sent. A verify call that the provider itself amount-checks
  only protects you if the amount you sent was priced server-side.
- The PG round trip happens **inside the run**, while the frontend waits on `/execute` — keep the
  `Http` `timeoutMs` tight, and answer a failed or unconfirmed payment from `catch` / `else` rather
  than letting the run hit its budget. Budget: `weegloo-script`.

---

## Where secrets live

| Secret | Goes in |
|---|---|
| Stripe **secret key** (`sk_…`, for session creation and confirm) | each of those Scripts' `definition.secrets` (`STRIPE_SECRET_KEY`), sent as `Authorization: Bearer { /secrets/STRIPE_SECRET_KEY }` |
| Stripe **webhook signing secret** (`whsec_…`) | the receiver Script's `definition.secrets` (`STRIPE_WEBHOOK_SECRET`), read by `Signature.secret`, `secretEncoding: "Utf8"` |
| Stripe **publishable key** (`pk_…`) | browser code — this one is safe to expose |
| Callback **auth token** (token path, non-Stripe providers) | the `SpaceAccessToken` you register with the PG, not in the Script |

⚠️ **Reading a Script returns its `secrets` in plaintext** to anyone with Script `Read`, so keep
Script `Read` off end-user roles (`weegloo-script` → *Secrets & auth*).

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
  may see; `sk_…` lives in the Script's `definition.secrets`.
- **Never send Stripe parameters in the URL.** They belong in a form-urlencoded `body`, which the
  engine percent-encodes; a value interpolated into `url` is not encoded, so free text there
  corrupts the request (§6b).
- **Never trust a client-reported amount, currency or status** — and an order row the buyer wrote, or
  can edit, is client-reported. The amount to charge is priced inside a Script from product rows the
  buyer cannot write; the PG's response says what was paid, and must equal it; minor units
  throughout.
- **Never store card data** — PAN, CVC, expiry — in Content, Media, or a Script payload. Use the PG's
  tokenization; that is what it is for.
- **Never fulfil in the browser** — grant the entitlement from the Script that established payment.
- **Never `Return` a PG error verbatim** if it may echo customer data.
- Shape B adds four more "never"s of its own — they are in `references/stripe-callback-receiver.md`.

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
