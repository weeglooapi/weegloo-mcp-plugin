---
name: weegloo-payment
description: Wire any PaymentGateway (PG), Merchant-of-Record (MoR) or checkout provider into a Weegloo product. Use when taking payments, building a checkout, verifying a payment, receiving a PG/MoR webhook or callback, checking its signature, or handling refunds and subscription renewals. Covers the two backend-free shapes, CONFIRM (pull from the PG) and CALLBACK (the PG POSTs to a Script); inbound-callback auth; idempotency on retries; where the secret key lives; amount verification. No provider named ⇒ Toss Payments test keys. NOT Weegloo's own plan billing. 결제, 카드결제, 체크아웃, 결제 연동, 결제 검증, 결제 콜백, 환불, 정기결제, 토스페이먼츠, 결제위젯.
country: KR
---

# Weegloo — payments (PG / MoR)

**This is about the product charging its own customers**, using Weegloo as the backend. Weegloo's own
subscription and plan billing is a different thing entirely and is not configured from here.

## The constraint that decides the architecture

Weegloo hosts no backend of yours. **The only place your server-side payment logic can run is a
Script** (`weegloo-script`) — which means:

> **The browser may never be what decides a payment succeeded, or what it costs.** The amount is
> computed inside a Script from prices the buyer cannot write, and whether it was paid comes from
> what the PG said — never from the request payload, or from a row the buyer wrote.

Everything below is a consequence of that one rule.

## Which provider — never ask, decide from what the user already said

**Do not ask "which PG / MoR should I use?"** A provider question is a scoping question, and the same
rule that bans capability menus in `weegloo-platform-integration` (step 3) bans this one. Decide:

| What the user gave you | What you integrate |
|---|---|
| A named provider — Toss Payments, PortOne, NICEPAY, KG이니시스, Stripe, Paddle, Lemon Squeezy, … — or a contracted key already sitting in the repo / env | **That** provider. Toss → this file. **Stripe → `references/stripe.md`**, the whole integration. Any other → read **its** docs for shape, signature scheme and callback-header support. |
| Nothing — no provider named anywhere | **Toss Payments on documentation test keys**, silently, per *Default provider* below — then **disclose it** (§5, mandatory). **Never Stripe:** `references/stripe.md` is for a *named* Stripe only, and is not opened on this path. |

A payment need you inferred from the frontend (a checkout page, a `결제하기` / "Pay" button, a price, a
cart, a plan picker) means **the user asked for payments**. It does **not** mean they named a provider
— that is exactly the case the default is for.

**A named provider is binding — the Toss default does not apply to it, and is never a fallback.**
Three follow-on cases, if they named one but sent no credentials:

- **They named Stripe** — in the design or the prompt, or with **their own** Stripe key already in the
  repo / env → **read `references/stripe.md` and build from it, entirely; skip the Toss sections
  below.** It is the whole Stripe integration — its published sample key pair, ContentTypes,
  Scripts, checkout page, disclosure, go-live — so there is **nothing to ask for**.
  - ⚠️ **Stripe's published sample pair in the tree — `pk_test_TYooMQauvdEDq54NiTphI7jx` /
    `sk_test_BQokikJOvBiI2HlWgH4olfQ2` — names no provider.** It is Stripe's public demo key, which
    any Stripe-default build hardcodes, not a key the user holds or a choice they made. A payment
    build with nothing else named is still the Toss default.
- **They named a provider other than Toss or Stripe** (PortOne, NICEPAY, …) → its key **is** a genuine
  blocking input under `weegloo-platform-integration` step 4. Build everything that does not need it,
  then **stop and ask for that provider's credentials**. Do **not** substitute Toss because the keys
  have not arrived, and do **not** wire both "for now" — a provider the user did not choose is wrong
  work, not a head start.
- **They named Toss Payments itself** → use the documentation test keys below exactly as the default
  path does, and §5's disclosure **still applies**: it discloses *test keys / nothing charged*, which
  is true here too. Only the "why Toss" half of the disclosure drops, since they picked it.

---

## Default provider — Toss Payments, test keys

### Why this is not a blocking question

`weegloo-platform-integration` step 4 classes a third-party API key as a **blocking** user-only input:
stop, ask, wait. **Payments are the exception.** Toss Payments publishes working documentation test
keys, so a complete, clickable, end-to-end checkout is reachable with **zero input from the user**.
Build it. Do **not** stop to ask for a PG key, and do **not** leave checkout inert "until they send
credentials" — an inert capability is incomplete work.

- ⚠️ **The documentation keys are shared and public.** Anyone holding `test_gsk_docs_…` can look up
  what the test flow sent, so never put real customer data — a real name, email or phone number
  passed to `requestPayment` — through it. The order rows on the Weegloo side are yours and
  unaffected.
- **Anything that needs the user's own Toss account is not reachable on them** — registering a
  webhook (개발자센터 → 웹훅), or changing which payment methods the widget offers. It waits for their
  own account (§6) and is **not** something you stop and ask for.
- **The widget offers no 가상계좌 (virtual account) on them.** Toss: "가상계좌는 문서용 테스트 키로
  테스트할 수 없습니다" — it appears only on the store's own test key issued after the 전자결제
  contract. So the default build has no 가상계좌 order and no deposit notification. §4's 가상계좌
  branch is still built — it just never runs on them — and the deposit receiver in shape B waits
  until their keys offer it (§6).

### 1. Read the docs first — they outrank this file

**https://docs.tosspayments.com/guides/v2/payment-widget/integration** — 주문서형 결제, the product
formerly named 결제위젯. Read it before writing code, every time. Test keys rotate and SDK versions
move; the values in §2 are what that page said when this skill was written, not a substitute for it.
Where they disagree, **the page wins**.

**If that URL is dead or has moved — 404, a redirect somewhere unrelated, or a page that is no longer
the 주문서형 결제 integration guide — do NOT guess path variants.** Toss publishes a machine-readable
index; use it exactly the way `weegloo-global-rules` has you use Weegloo's own:

1. Fetch **https://docs.tosspayments.com/llms.txt**.
2. Take the **exact** path for the 주문서형 결제 / payment-widget integration guide from that index
   (as of writing, `…/guides/v2/payment-widget/integration.md`).
3. Fetch that path.

That index also lists a **LLM Quick Reference** (`…/guides/v2/get-started/llms-quick-reference.md`)
and a **배포 체크리스트** — both worth reading if the primary guide is unclear or you are about to hand
the integration over for real keys.

**Two fetch quirks, both real, both encountered:**

- **The rendered page gates narrow viewports** ("이 페이지는 PC에서만 이용할 수 있어요"). A plain
  page-text fetch can come back with that notice and nothing else — use a desktop-width browser
  viewport, or read the `.md` form.
- **The `.md` form does not contain the key values.** It renders them as unexpanded components —
  `<WidgetClientKey />`, `<WidgetSecretKey />` — because the real strings are injected client-side. So
  the `.md` is good for the *flow and steps* but **useless for reading or re-verifying the test keys**;
  for those you need the rendered page.

If the documentation test keys are genuinely **gone**, or the flow no longer runs without a signed
contract: do not improvise a different provider and do not ship a dead checkout — **stop and ask the
user for their contracted PG/MoR details.** The default's premise — published test keys — has failed,
so this is the one key conversation you start, and only then is it a genuine blocking input under
step 4.

### 2. What the page specifies

| | Value |
|---|---|
| SDK | `<script src="https://js.tosspayments.com/v2/standard"></script>`, or `npm i @tosspayments/tosspayments-sdk` |
| Test **client** key (browser) | `test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm` |
| Test **secret** key (Script only) | `test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6` |
| Confirm API | `POST https://api.tosspayments.com/v1/payments/confirm` |
| Confirm auth | `Authorization: Basic base64("{secretKey}:")` — **the trailing colon is required** |
| Confirm body | `paymentKey`, `orderId`, `amount` |
| Confirm deadline | **within 10 minutes** of the payment request — "결제 요청이 완료된 이후 10분 이내에 결제를 승인해야 됩니다" |
| `successUrl` query params | `paymentType`, `orderId`, `paymentKey`, `amount` |
| `failUrl` query params | `code`, `message`, `orderId` |
| Charging | test keys approve **virtually** — no card or account is ever debited |

### The order ContentType — a field the provider fills is not a `ShortText`

Model it before §3. **`ShortText` stops at 64 characters**, so the split is not "short vs long" but
**whether you can predict the length** (`weegloo-create-content-type` → *Hard limits*):

| field | type | why |
|---|---|---|
| `orderId`, `status` | `ShortText` | yours, and you keep them short — Toss's API reference requires `orderId` to be 6–64 characters of letters, digits, `-`, `_` |
| `amount` | `Long` | KRW has no minor unit; an integer, never a string — **written only by *The order Script*** |
| `product`, `quantity` | `Refer` → Content (`referContentType`: the `product` type), `Long` | what that Script priced — a relationship is a `Refer`, not an id in a `ShortText` (`weegloo-create-content-type`); fulfil from these, never from what the success page sends |
| `paymentKey` | **`RichText`** | Toss allows up to **200** characters — past the cap on its own |
| `receiptUrl` (`receipt.url`) and any provider URL | **`RichText`** | a provider URL is Toss's to shape, not yours |
| any other Toss id or token you store — never the 가상계좌 `secret` (§4) | **`RichText`** | the length is Toss's to change, not yours |

`RichText`, not `LongText`: none of these is ever full-text searched — the Script finds the order by
**your** `orderId`, then reads the provider value by path. A provider id you **query on** (a
`ResourceFind` keyed on it, such as an idempotency receipt) is the exception: queried ⇒ `LongText`.

A `ShortText` here breaks nothing until Toss issues a `paymentKey` longer than 64 characters; then
§4's `ResourcePatch` fails on `/paymentKey/en-US: must not exceed a maximum length of 64` **after**
the confirm call has already approved the payment — its `catch` answers `409` to every retry, the
money moved, and the order still reads `pending`.

### The order Script — the amount is priced here, never on the page

**The amount Toss is asked to approve is computed by a Script, from a price the buyer cannot
write.** A row the buyer writes is not server-side, whichever API it goes through: if the page
creates the order, a buyer stores `amount: 100` for a 10,000원 item, pays 100, and §4 compares 100
with 100 — the order reads `paid`, with no error anywhere. Set up three things before the first
order:

- **A `product` ContentType** — `name` (`LongText`) and `price` (`Long`, KRW) — written and
  published by staff in the console. The storefront reads it over CDA; the buyer's role needs no
  write on it, because this Script reads it with its author's authority.
- **This Script**, `method: "Post"`, authored as an admin (the author gate, `weegloo-script`). The
  page sends only *what* is bought — `orderId` (`crypto.randomUUID()` on the page: a Script has no
  source of randomness), `productId`, `quantity` — never what it costs:

  ```jsonc
  { "type": "ResourceRead", "name": "product", "resource": "Content",
    "target": { "sys": { "id": "{ /payload/productId }" } }, "from": "Published" },

  { "type": "If", "condition": { "or": [
        { "!==": [ "{ /product/sys/contentType/sys/id }", "<productCtId>" ] },
        { "!": { ">": [ "{ /product/fields/price/en-US }", 0 ] } },
        { "<": [ "{ /payload/quantity }", 1 ] },
        { ">": [ "{ /payload/quantity }", 99 ] },                        // your own cap
        { "!==": [ { "%": [ "{ /payload/quantity }", 1 ] }, 0 ] },
        { "!": "{ /payload/orderId }" } ] },
    "then": [ { "type": "Return", "isError": true, "statusCode": 400, "value": "invalid order" } ] },

  { "type": "ResourceCreate", "name": "order", "resource": "Content",
    "contentType": { "sys": { "id": "<orderCtId>" } }, "locale": "en-US",
    "fields": { "orderId": "{ /payload/orderId }", "status": "pending",
      "product": { "sys": { "type": "Refer", "id": "{ /product/sys/id }", "targetType": "Content" } },
      "quantity": "{ /payload/quantity }",
      "amount": { "$*": [ "{ /product/fields/price/en-US }", "{ /payload/quantity }" ] } } },

  { "type": "Return", "value": { "orderId": "{ /payload/orderId }",
      "orderName": "{ /product/fields/name/en-US }",
      "amount": { "$*": [ "{ /product/fields/price/en-US }", "{ /payload/quantity }" ] } } }
  ```

  - **Keep the ContentType check.** `ResourceRead` fetches any Content by id with the author's
    authority, so without it a buyer passes the id of another row that carries a `price` — one
    they wrote themselves included. An id that is no published product fails the read or the
    check, and nothing is created.
  - **No `propagateEvents` here** — that flag only fires Webhooks. §4 finds this order by
    searching the indexed copy, which picks the create up about a second later either way; the
    buyer is back from the payment window long after that.
  - **A cart** prices every line the same way — `Loop` over the lines with a declared
    `maxIterations`, `SetVar` to add them up (`weegloo-script`) — and stores the lines it priced;
    it never totals what the page sent.
- **The buyer's `ServiceUserRole`** — at most `Read` on their own orders (over ACDA the order type
  needs `publishWithAuthor: true`), `Execute` on this Script and §4's, and no `Create`, `Edit` or
  `All` on the order, `product` or entitlement type:

  ```json
  "content": { "Read": { "Allow": [ {
      "contentType": { "sys": { "type": "Refer", "id": "<orderCtId>", "targetType": "ContentType" } },
      "createdBy": { "sys": { "type": "Refer", "id": ":self", "targetType": "User" } } } ] } },
  "script": { "Execute": { "Allow": [
      { "self": { "sys": { "type": "Refer", "id": "<orderScriptId>", "targetType": "Script" } } },
      { "self": { "sys": { "type": "Refer", "id": "<confirmScriptId>", "targetType": "Script" } } }
  ] } }
  ```

⚠️ **Each of these reopens the hole, silently:** any `Create`, `Edit` or `All` that reaches the
order type — the buyer then writes their own `amount`, or `status: "paid"` without paying —
including a `createdBy :self` rule with no `contentType`, because a row this Script writes is the
buyer's by `sys.createdBy` (§4); any write on the `product` type; a price taken from
`{ /payload/… }`; and a guest checkout that writes orders with a token instead of calling this
Script.

### 3. Client — render, then request

```js
const tossPayments = TossPayments("test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm");
const widgets = tossPayments.widgets({ customerKey });   // guests: TossPayments.ANONYMOUS

await widgets.setAmount({ currency: "KRW", value: listedPrice * quantity });   // display only
await Promise.all([
  widgets.renderPaymentMethods({ selector: "#payment-method", variantKey: "DEFAULT" }),
  widgets.renderAgreement({ selector: "#agreement", variantKey: "AGREEMENT" }),
]);

// on 결제하기, only after the UI has rendered — the order Script prices it, Toss is asked for that
// createOrder = POST https://script.weegloo.com/v1/spaces/{spaceId}/scripts/{orderScriptId}/execute
//               with the buyer's Bearer, reading `.return` off the response
const order = await createOrder({ orderId: crypto.randomUUID(), productId, quantity });
await widgets.setAmount({ currency: "KRW", value: order.amount });
await widgets.requestPayment({ orderId: order.orderId, orderName: order.orderName,
                               successUrl, failUrl });
```

- **The order Script writes the order — `status: "pending"` — BEFORE `requestPayment()`; the page
  never does.** Toss requires `orderId` + `amount` to be stored server-side first, and that stored
  row is the *only* amount you may trust at confirm time (§4) — trustworthy because a Script priced
  it. The first `setAmount` is display only; the second passes Toss the amount the Script returned,
  which is the one §4 confirms.
- **`customerKey`** — a stable, unguessable per-buyer string for a signed-in Service User; never an
  email, a sequential id, or anything a stranger could type.
- **`successUrl` / `failUrl` must be absolute and actually reachable.** On Weegloo WebHosting that is
  the deployed `…weegloo.app` origin — a **self-resolving** value in step 4's sense: set a placeholder,
  deploy, then patch it. **Do not ask the user for it.**
- These are **real navigations**. A hash-only SPA router will 404 on them — add the routes to the
  static export, or configure the SPA fallback, before you call the flow done.
- **The success page calls the confirm Script at once.** The payment must be approved within 10
  minutes of the request (§2); a success page that waits for a click, or a confirm that never runs,
  lets that window lapse. On a `409` or `503` (`"retry"`) it calls again, a few times with a growing
  delay — safe, because every call settles from what Toss records (§4).

### 4. Server — the confirm Script

Toss is a **pull** provider, so this is **shape A**, unchanged in substance — same order read, same
amount comparison, same write-back:

```jsonc
{ "type": "ResourceFind", "name": "order", "resource": "Content",
  "contentType": { "sys": { "id": "<orderCtId>" } },
  "where": { "createdBy": ":self", "fields.orderId": "{ /payload/orderId }" } },

{ "type": "If", "condition": { "==": [ "{ /order }", null ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 404, "value": "unknown order" } ] },

// a search reads the indexed copy, which need not hold this Script's patch — read the row by id
{ "type": "ResourceRead", "name": "current", "resource": "Content",
  "target": { "sys": { "id": "{ /order/sys/id }" } } },

// confirmed before — paid, or a 가상계좌 awaiting its deposit: never send Toss a second confirm
{ "type": "If", "condition": { "!==": [ "{ /current/fields/status/en-US }", "pending" ] },
  "then": [ { "type": "Return", "value": { "status": "{ /current/fields/status/en-US }" } } ] },

// nothing reads the reply; a timeout, which can lose an approval, only asks the page to call again
{ "type": "Try", "body": [
    { "type": "Http", "method": "POST", "url": "https://api.tosspayments.com/v1/payments/confirm",
      "headers": [
        { "key": "Authorization", "value": "Basic { /secrets/TOSS_BASIC_AUTH }" },
        { "key": "Content-Type", "value": "application/json" } ],
      "body": { "paymentKey": "{ /payload/paymentKey }", "orderId": "{ /payload/orderId }",
                "amount": "{ /order/fields/amount/en-US }" },
      "timeoutMs": 10000, "ignoreStatusCode": true } ],
  "catch": [ { "type": "Return", "isError": true, "statusCode": 503, "value": "retry" } ] },

// 결제 조회 — what Toss recorded decides, on the first call and on every retry
{ "type": "Try", "body": [
    { "type": "Http", "name": "payment", "method": "GET",
      "url": "https://api.tosspayments.com/v1/payments/{ /payload/paymentKey }",
      "headers": [ { "key": "Authorization", "value": "Basic { /secrets/TOSS_BASIC_AUTH }" } ],
      "timeoutMs": 5000, "ignoreStatusCode": true } ],
  "catch": [ { "type": "Return", "isError": true, "statusCode": 503, "value": "retry" } ] },

// IN_PROGRESS (authenticated, not yet approved) or a failed 결제 조회 is not an answer yet
{ "type": "If", "condition": { "or": [
      { "===": [ "{ /payment/body/status }", "IN_PROGRESS" ] },
      { ">=": [ "{ /payment/status }", 500 ] } ] },
  "then": [ { "type": "Return", "isError": true, "statusCode": 503, "value": "retry" } ] },

{ "type": "If",
  "condition": { "and": [
      { "===": [ "{ /payment/body/status }", "DONE" ] },
      { "===": [ "{ /payment/body/orderId }", "{ /order/fields/orderId/en-US }" ] },
      { "===": [ "{ /payment/body/totalAmount }", "{ /order/fields/amount/en-US }" ] } ] },
  "then": [ { "type": "Try",
              "body": [ { "type": "ResourcePatch", "resource": "Content",
                          "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
                          "version": "{ /current/sys/version }",
                          "fields": { "status": "paid",
                                      "paymentKey": "{ /payment/body/paymentKey }" } } ],
              "catch": [ { "type": "Return", "isError": true, "statusCode": 409,
                           "value": "retry" } ] } ],
  "else": [ { "type": "Return", "isError": true, "statusCode": 402, "value": "payment not confirmed" } ] }
```

- **`amount` comes from `{ /order/… }`, never from `{ /payload/amount }`.** The `successUrl` query
  param is client-controlled — comparing it to itself proves nothing. If the page changed the
  widget amount anyway, Toss refuses this confirm, because it differs from the amount the buyer
  authenticated; handle that like its other failure codes (below). Nothing is charged — approval,
  not authentication, is what debits.
- **Precompute the `Basic` value and keep it a Script secret.** A Script cannot base64-encode an
  arbitrary string, so encode `secretKey + ":"` at authoring time and declare the result in the
  Script's `definition.secrets` — `{ "key": "TOSS_BASIC_AUTH", "value":
  "dGVzdF9nc2tfZG9jc19PYVB6OEw1S2RtUVhrelJ6M3k0N0JNdzY6", "description": "Toss secret key, base64 of
  key + ':'" }` — never as a literal in the statements. Both `Http` statements read the same secret:
  a refused 결제 조회 leaves an approved payment `pending`. That value is exactly
  `base64("test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6:")` — recompute it if you use a different key.
- **Store `paymentKey`** — Toss's, from 결제 조회, not the payload's — beside the order's `orderId`;
  they are what later lookup and cancellation need.
- **Grant once.** A rerun — a reloaded success page, a retried call — must not pass the check a
  second time, and 결제 조회 answers `DONE` to every one of them. Hence the `ResourceRead` by id —
  the find reads the indexed copy, which need not hold this Script's patch; `ResourceRead` never
  uses the index — and the early `Return` for an order no longer `pending`, before the confirm is
  re-sent. A concurrent second call that reaches the patch as well is sent to the `catch` by the
  `version` lock (`409`; called again, it answers `status: "paid"`) instead of granting twice.
- **That early `Return` skips the grant too**, so a grant that fails after the patch is never
  retried. Put the grant after the `paid` patch's `Try`, in a `Try` of its own whose `catch` patches
  `status` back to `pending` and answers `503` (`"retry"`), so the page's next call passes the guard
  again and settles from 결제 조회 like the first. Keep the grant one write, or key it on the order,
  so a rerun cannot duplicate part of it. Never revert in the patch's `catch`: that call lost the
  race, and would undo the winner's `paid`.
- **결제 조회 decides, not the confirm's reply.** Toss can approve a confirm whose reply is then lost
  — a timeout, a run that dies before the patch — leaving the order `pending`, and no Toss page says
  what the next call's confirm of that approved payment answers. So nothing reads the reply (Toss's
  quick reference, too, checks a failed confirm with 결제 조회 first). The `paymentKey` in the lookup
  is the buyer's: keep both the `orderId` and the amount check, and a key from another payment, or a
  junk one, answers `402` and writes nothing.
- **`IN_PROGRESS` is not an answer yet.** Toss defines it as authenticated and not yet approved —
  the state a confirm completes. Right after this Script's confirm it means Toss is still
  processing one (a retry can arrive while a timed-out call's approval is in flight) or failed one
  with a 5xx, so the `IN_PROGRESS` check answers `503`, as it does for a 결제 조회 that fails with
  a 5xx, and the page calls again (§3). A `402` there would end those retries on a payment that
  can still go through, or already has.
- **A 가상계좌 confirm succeeds without paying.** The documentation keys never reach this branch
  (they offer no 가상계좌), but build it anyway, so that §6 stays a key swap. 결제 조회 answers
  `status: "WAITING_FOR_DEPOSIT"`, not `DONE` — the account was issued and nothing was deposited.
  So replace the `else` above with one that takes this case first: after the same `orderId` and
  amount checks, patch `status: "awaiting_deposit"` **and `paymentKey`** (the deposit receiver asks
  Toss about the payment by it — the notification carries none) under the same `version` lock,
  `Return` only what the buyer deposits into, and answer `402` otherwise:

  ```jsonc
  "else": [ { "type": "If",
      "condition": { "and": [
          { "===": [ "{ /payment/body/status }", "WAITING_FOR_DEPOSIT" ] },
          { "===": [ "{ /payment/body/orderId }", "{ /order/fields/orderId/en-US }" ] },
          { "===": [ "{ /payment/body/totalAmount }", "{ /order/fields/amount/en-US }" ] } ] },
      "then": [
        { "type": "Try",
          "body": [ { "type": "ResourcePatch", "resource": "Content",
                      "target": { "sys": { "id": "{ /order/sys/id }" } }, "locale": "en-US",
                      "version": "{ /current/sys/version }",
                      "fields": { "status": "awaiting_deposit",
                                  "paymentKey": "{ /payment/body/paymentKey }" } } ],
          "catch": [ { "type": "Return", "isError": true, "statusCode": 409,
                       "value": "retry" } ] },
        { "type": "Return", "value": {
            "bankCode": "{ /payment/body/virtualAccount/bankCode }",
            "accountNumber": "{ /payment/body/virtualAccount/accountNumber }",
            "dueDate": "{ /payment/body/virtualAccount/dueDate }",
            "amount": "{ /order/fields/amount/en-US }" } } ],
      "else": [ { "type": "Return", "isError": true, "statusCode": 402,
                  "value": "payment not confirmed" } ] } ]
  ```

  `bankCode` is Toss's two-digit bank code, not a bank name. Mark the order paid only from the
  deposit notification (shape B). A rerun on this order answers only its `status` (the guard
  above) and never re-sends the confirm, so the account goes out once, from this `Return`; if a
  reload must show it again, store those three fields in this patch (`RichText`, like any Toss
  value) and return them from the guard — never the `secret`.
- ⚠️ **Never store the Payment object's `secret`, and never `Return` `{ /payment/body }`, which
  carries it** — nor the confirm's reply, which carries it too. Toss's docs verify the deposit
  notification against a stored copy of that value — the one step of theirs not to follow here.
  Whoever holds it can post a `DONE` for an order nobody paid, and no row keeps it from the buyer by
  default: they read their own order, and a row this Script writes is theirs by `sys.createdBy` too
  (it runs as them), so a `createdBy :self` rule without a `contentType` reaches it, silently. The
  receiver asks Toss's 결제 조회 API instead and needs no copy (`references/callback-receiver.md` →
  *The Toss 가상계좌 deposit*).
- **Guest checkout** has no caller to resolve `:self` against — drop the `createdBy` filter and match
  on `orderId` alone, which then has to be long and random rather than sequential. The order still
  comes from *The order Script*, which uses no `:self` — never from a token that can create orders.
  With no buyer Bearer, the page calls both Scripts with a `SpaceAccessToken` whose `SpaceRole`
  holds only `script.Execute`, pinned with `self` to the two Scripts — and no `Read` on orders:
  every guest shares that token's `:self`, so such a rule would show each guest every guest's order.
- Toss's own failure codes (`NOT_FOUND_PAYMENT_SESSION`, `REJECT_CARD_COMPANY`, `UNAUTHORIZED_KEY`, …)
  arrive in the confirm's `4XX` reply, which nothing reads: 결제 조회 decides instead — `402` from the
  `else` once it shows a final state, `503` while it still reads `IN_PROGRESS`. A `402` on every
  attempt points at the `Basic …` value. Never echo a Toss message to the buyer.

### 5. Tell the user — MANDATORY, not optional

The moment the flow works, say three things plainly, in the user's own language:

1. Payments were wired with **Toss Payments**, chosen because no provider was specified.
2. It runs on **Toss's test keys, so nothing is ever actually charged** — the whole flow completes,
   but no card or account is debited.
3. The keys are **Toss Payments' public documentation test keys**, not theirs — moving to their own
   Toss account, or to a contracted PG/MoR, is the swap in §6. **State that it is available; do not
   ask for credentials.** If they want it, they will say so.

If the user asked for 가상계좌, add one plain sentence: the documentation keys do not offer it, and
it appears once their own Toss keys from a 전자결제 contract are in (§6).

**Put point 2 in red** — it is the must-know fact here. Mechanics of the `diff` fence, the `+ ` /
`- ` markers and keeping the two blocks separate are owned by `weegloo-global-rules` → *Highlight what
the user must act on or must know*; this is the sentence, in the user's own language:

```diff
- 결제는 토스페이먼츠 테스트 키로 동작합니다 — 실제로 청구되는 카드나 계좌는 없습니다.
```

Points 1 and 3 stay plain text; the live checkout URL, if you have one, is the **green** block.

This is a **disclosure about what shipped, not a request** — it asks for nothing, so it does not
collide with `weegloo-platform-integration`'s ban on "give me these and I'll continue" wrap-ups.
Keep it to a few plain sentences with no Weegloo or Toss jargon, and never end it with a
credentials list. **Never let a test-key checkout pass for production-ready by saying nothing.**

### 6. Going live, or swapping the provider

**Their own Toss keys** are a swap, not a rewrite — the integration is identical:

1. Replace the client key in the browser and the secret key behind the confirm Script with the
   결제위젯 pair (`…_gck_…` / `…_gsk_…`) from their own 개발자센터, and **recompute the precomputed
   `Basic …` value** (§4) from the new secret key into the confirm Script's `TOSS_BASIC_AUTH` secret
   — the statements stay as they are.
2. Delete every `test_gck_docs_…` / `test_gsk_docs_…` string left in the tree.
3. The account-only work is now reachable. **If their keys offer 가상계좌** — a store's own test key
   issued after the 전자결제 contract does; the documentation keys never did — build the 가상계좌
   deposit receiver (shape B; it calls Toss's 결제 조회 API with the same new `Basic …` value) and
   register it as the deposit webhook, or turn 가상계좌 off.
4. Walk the **배포 체크리스트** listed in `llms.txt` (§1) before taking real payments.

**A different provider** is a replacement, not a layer:

1. **Read that provider's docs first** — shape, signature scheme, callback-header support (§*Two
   shapes*; if it pushes, `references/callback-receiver.md`; Stripe: `references/stripe.md`, all of
   it). Do not assume it behaves like Toss.
2. **Remove the Toss integration entirely**: the SDK script tag / package, the widget render and
   `requestPayment` code, Toss-specific `successUrl` / `failUrl` handling, the confirm Script's two
   Toss `Http` statements and their `Basic …` header — and the 가상계좌 deposit receiver Script, which
   holds the same header, if one was built — and **every `test_gck_…` / `test_gsk_…` string left in
   the tree**. No dead Toss path, no orphan test key.
3. **Keep what is provider-neutral**: the product / order / receipt / entitlement ContentTypes, the
   order Script and the buyer's read-only role on orders, the `:self` ownership scoping, the
   amount-verification rule, the idempotency receipt.
4. **Re-verify the invariants**: amount priced by the order Script and read from the order row,
   signature checked as the first statement if the new provider pushes, no secret in client code.

---

## Two shapes — pick by whether you can *ask* the PG

| | **A. Confirm (pull)** | **B. Callback (push)** |
|---|---|---|
| Trigger | your frontend, after the PG SDK / redirect returns | the PG POSTs to you |
| Truth comes from | an `Http` call to the PG's verify/confirm API | the request body + its signature |
| Inside the Script | an outbound `Http` to the PG, then the write | verify + write only, no outbound call |
| Endpoint | `…/execute` (your frontend holds a token) | `…/execute` with a token, or `…/execute/anonymous` with none |
| Use for | checkout approval, "did this payment really go through" | refunds, disputes, subscription renewals, virtual-account deposits, anything you cannot pull |

**Prefer A whenever the answer can be pulled.** It needs no signature verification, no inbound
authentication, and no idempotency key — you are asking the authoritative source directly, though
granting only once is still yours (*A. Confirm* step 5). §4 is A, and the Toss test-key default path
is A, complete above in this file.

**Add B when the money can move without your frontend being there** — a 가상계좌 deposit that lands
hours later, a subscription renewal, a dispute. Card checkout stays A. **The Toss 가상계좌 deposit is
B's trigger with A's truth:** its body carries no signature and no amount, so the receiver treats it
as a trigger only and asks Toss's 결제 조회 API before it writes — the one receiver that calls out.

> ### ➜ Building shape B? Read `references/callback-receiver.md` before designing the flow.
> It is the only place with: which of `…/execute` and `…/execute/anonymous` the provider posts to and
> what authenticates each, the signature check as the first statement, the shape→statement table for
> mapping a provider's signature scheme, the replay window, and idempotency against provider
> retries. On the Toss documentation keys you never need it — they offer no 가상계좌; once their own
> keys do, you need it for the **가상계좌 deposit notification** (§4). If you are not receiving a push
> from the provider, do not open it.

---

## A. Confirm — frontend → Script → PG verify API

1. The frontend completes the PG's client flow and receives a **payment id / token** (plus the PG's
   redirect params). It calls the Script with just those identifiers.
2. The Script **reads the order a Script created earlier** (`ResourceRead` / `ResourceFind` with
   `where: { "createdBy": ":self" }`) to learn the **expected amount** — priced from records the
   buyer cannot write (*The order Script*); an order the buyer wrote hands their own number back.
3. `Http` GET/POST to the PG's verify endpoint, the secret key read from **`{ /secrets/<key> }`** in
   a header.
4. **Compare** the PG's reported amount + currency + order id against step 2. Mismatch ⇒ `Return`
   with `isError: true` and do not fulfil.
5. `ResourcePatch` the order → paid, and only then grant the entitlement — **once**: a verify call
   that consumes nothing passes again when replayed, so re-read the order by id (a search reads the
   indexed copy, which need not hold the patch), skip it if it already reads paid, and patch with
   that read's `sys.version` as `version`, so a concurrent second call fails instead of granting
   twice. If the grant then fails, patch the order back to unpaid so the next call grants again.
   Where the verify call is the approval itself, as Toss's confirm is, decide from the PG's lookup
   API instead: an approval's reply can be lost after it succeeded, and a repeated approval need not
   say whether the first went through. A lookup that still shows that approval in progress is a
   retry, not a failure (§4).

- **Send or compare the amount you recorded, not the amount the caller sent.** A verify call that the
  provider itself amount-checks only protects you if the amount you sent came from your own record,
  priced by a Script — a row the buyer wrote is the amount the caller sent.
- The PG round trip happens **inside the run**, while the frontend waits on `/execute` — keep the
  `Http` `timeoutMs` tight, and answer a failed or unconfirmed payment from `catch` / `else` rather
  than letting the run hit its budget. Budget: `weegloo-script`.

---

## Where secrets live

| Secret | Goes in |
|---|---|
| PG **API/secret key** (for confirm and inquiry calls) | each calling Script's `definition.secrets` (Toss: `TOSS_BASIC_AUTH`), sent as `Basic { /secrets/TOSS_BASIC_AUTH }` |
| Toss's per-payment 가상계좌 `secret` (in the Payment object the confirm and 결제 조회 return) | **nowhere** — the deposit receiver asks Toss instead (§4) |
| **Webhook signing secret** (shape B) | the receiver Script's `definition.secrets`, read by `Signature.secret` / inside `Hash.value` — `references/callback-receiver.md` B-2 / B-3 |
| Callback **auth token** (token path, shape B) | the `SpaceAccessToken` you register with the PG, not in the Script — `references/callback-receiver.md` B-1 |

⚠️ **Reading a Script returns its `secrets` in plaintext** to anyone with Script `Read`, so keep
Script `Read` off end-user roles, and treat a secret as compromised if an end-user role can already
read that Script (`weegloo-script` → *Secrets & auth*).

## Never

- **Never ask which PG / MoR to use.** Named provider → integrate that one; none named → integrate
  the Toss Payments test-key default — never Stripe — and disclose it. A provider menu is a scoping
  question.
- **Never ask the user for Toss keys, or for Stripe keys** — the documentation pair in §2 (Toss) and
  the published sample pair in `references/stripe.md` §1 (Stripe) are what you wire in (the one
  exception: those keys are gone, §1). And never ship an inert checkout waiting on a key.
- **Never finish a test-key payment flow silently.** The completion message must say that payments run
  on Toss test keys and are not really charged (§5) — as a statement, not a request for credentials.
  An undisclosed test-key checkout reads as production-ready and is the worst failure here.
- **Never leave a `test_gck_…` / `test_gsk_…` key in the tree once their own credentials exist** —
  going live or replacing a provider means removing the test path, not layering over it (§6).
- **Never put a secret key, or its `Basic …` header, in client code.** The client key is the only Toss
  key the browser may see; the secret key lives in the Script's `definition.secrets`.
- **Never trust a client-reported amount, currency or status — a row the buyer wrote is
  client-reported.** The amount comes from *The order Script*; the PG's response says what was
  paid, and must equal it. The buyer's role never writes the order or `product` type.
- **Never store card data** — PAN, CVC, expiry — in Content, Media, or a Script payload. Use the PG's
  tokenization; that is what it is for.
- **Never fulfil in the browser** — grant the entitlement from the Script that established payment.
- **Never `Return` a PG error verbatim** if it may echo customer data.
- Shape B adds two more "never"s of its own — they are in `references/callback-receiver.md`.

## Related

- `weegloo-script` — statements, value expressions, limits, the run budget, `Execute` permission.
- `weegloo-space-access-token` / `weegloo-space-role` — the least-privilege callback token and the
  `script.Execute` `self` filter.
- `weegloo-create-content-type` — modelling the order / receipt / entitlement ContentTypes.
- `weegloo-webhook` — reacting to *your own* Space events after a payment is recorded.
- `weegloo-service-login` — identifying the buyer (`createdBy :self` ownership).
- `weegloo-web-hosting` — the deployed origin that `successUrl` / `failUrl` must point at.
- `weegloo-platform-integration` — the router whose step 3 (don't ask scoping questions), step 4
  (just-in-time blocking inputs) and brevity rule this skill's default-provider policy specialises.
