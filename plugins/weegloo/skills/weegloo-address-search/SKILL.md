---
name: weegloo-address-search
description: Wire a SOUTH KOREAN address / postcode lookup into a form — a signup or profile address, a checkout shipping address, a saved address book, a branch or store an admin registers, a "주소 찾기" / 우편번호 button, a zonecode / zipcode / postcode field, a 도로명·지번 pair, 배송지 주소 입력. Always the Kakao (Daum) Postcode widget — one CDN script, client-side, no API key. Covers popup open() vs embedded embed(), the oncomplete result fields and their two traps, the 참고항목 composition, the mandatory 상세주소 detail input, and modelling the result in Weegloo as private per-member data. South Korea only.
---

# Address & postcode lookup — Kakao (Daum) Postcode (South Korea only)

A form that has to capture **where to ship it / where the member is** — a signup or profile address,
a checkout shipping address, a saved address book, a branch or store an admin registers — gets the
**Kakao Postcode** widget (long known as the *Daum 우편번호 서비스*). Guide:
https://postcode.map.kakao.com/guide

This is not a Weegloo resource: Weegloo has no address service, and none is needed. The widget is the
whole implementation, and the only thing that touches Weegloo is the final save.

**A widget, not an API.** One `<script>` from Kakao's CDN, one object, and the search UI runs
entirely in the visitor's browser — no SDK build step, no server call, no Weegloo call, no Script
execution, and **no files added** to the ≤300-entry WebHosting ZIP. It therefore works unchanged on a
static Weegloo WebHosting deploy (`weegloo-web-hosting`).

## South Korea only — that is the whole scope of this tool

It searches the **South Korean government address database** (Ministry of the Interior and Safety):
road-name (도로명) and lot-number (지번) addresses and their 5-digit postcodes, and **nothing else**.
No US, Japanese or European address resolves in it.

- **Korean-facing product ⇒ wire it.** A `우편번호` / `주소 찾기` button, a `zonecode` / `zipcode` /
  `postcode` field, a 도로명·지번 pair, a Korean shipping or member form — all of it lands here.
- **Non-Korean addresses ⇒ wrong tool, and this skill offers no substitute.** Ship a plain free-text
  address field (with a country field), say in one line — in **red**, per `weegloo-global-rules` —
  that automatic lookup was Korea-only and so was not wired, and let the user name an international
  provider if they want one. Do **not** bolt the Korean widget onto a form that will hold foreign
  addresses.
- **A multi-country form gets it on the Korea branch only** — country = KR reveals the lookup button,
  every other country falls back to free text.

## No key, no registration — and never ask for one

The Postcode widget takes **no API key, no appkey and no sign-up**, is free for commercial use, and
has no documented call cap. So an address lookup is **never** a blocking input — do not ask the user
for a Kakao key, do not emit a `YOUR_APP_KEY` placeholder, and do not read a key from an env var a
static build cannot inject.

**Kakao's OTHER products are where the key confusion comes from.** The Maps JS SDK
(`//dapi.kakao.com/v2/maps/sdk.js?appkey=…`) needs a JavaScript key, and the Local REST API address
search (`//dapi.kakao.com/v2/local/search/address.json`) needs a REST key — both are different
products, and neither is what an address field needs. The postcode bundle below carries no key at
all. Reaching for one of those, or asking the user for a key because "it's Kakao", is the mistake to
avoid.

## Load it

```html
<script src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
```

- The guide prints this protocol-relative (`//t1.kakaocdn.net/…`); write **`https://`** so a
  `file://` preview of the build does not silently fail.
- The global is **`kakao.Postcode`**. `daum.Postcode` is the same object under its old name — the
  bundle aliases `window.daum` and `window.kakao` to each other — so legacy code keeps working, but
  write new code against `kakao.Postcode`.
- If the page also loads the Kakao **Maps** SDK, the two share the `kakao` namespace safely in either
  load order; just do not assume `kakao.maps` exists merely because `kakao` does.
- Load it from that CDN URL as-is. **Self-hosting or editing the script, or hiding the widget's
  footer/logo, voids Kakao's terms** and gets the service restricted.

## Popup (`open`) or embedded layer (`embed`)

```js
// popup — simplest; MUST be called inside the click handler or the popup blocker eats it
findBtn.addEventListener('click', () => {
  new kakao.Postcode({
    oncomplete: (data) => {
      form.postcode.value = data.zonecode;            // 5-digit postcode
      form.address.value  = composeAddress(data);     // see below
      form.addressDetail.focus();                     // the user types the rest
    },
  }).open();
});
```

```js
// embedded layer — preferred in an SPA and on mobile: no popup blocker, no window management
const layer = document.querySelector('#postcodeLayer');  // must already be in the DOM and visible
layer.style.display = 'block';
new kakao.Postcode({
  oncomplete: (data) => { fill(data); layer.style.display = 'none'; },
  onresize:   (size) => { layer.style.height = size.height + 'px'; },  // else an inner scrollbar
  onclose:    () => { layer.style.display = 'none'; },                 // the ✕ inside the widget
  width: '100%', height: '100%',
}).embed(layer);
```

- **Construct a fresh `kakao.Postcode` on every open** — that is what the guide's own samples do; do
  not cache one instance and re-embed it.
- `open()` also takes `q` (pre-filled query), `popupKey` (blocks a duplicate popup), `popupTitle`,
  `left` / `top`, and `autoClose` (default `true` — the popup closes itself after a selection; in
  embed mode *you* hide the layer in `oncomplete`).
- `onclose(state)` distinguishes `FORCE_CLOSE` (user dismissed) from `COMPLETE_CLOSE` (after a pick).
- Other constructor options worth knowing: `theme` (colours), `maxSuggestItems`, `hideEngBtn` /
  `hideMapBtn`, `alwaysShowEngAddr`, `shorthand`, `autoMapping`. Defaults are fine — reach for them
  only when the design asks.

## Reading the result — two traps

| field | example | use |
|---|---|---|
| **`zonecode`** | `13529` | **the postcode — store this one** |
| `address` | `경기 성남시 분당구 판교역로 166` | the line shown first, in the type the user searched |
| `roadAddress` / `jibunAddress` | 도로명 / 지번 form | may be **empty** on a 1:N mapping (trap 2) |
| `autoRoadAddress` / `autoJibunAddress` | same | the auto-mapped counterpart, filled in that case |
| `userSelectedType` | `R` / `J` | which form the user actually picked |
| `bname`, `buildingName`, `apartment` | `백현동`, `카카오 판교 아지트`, `Y` | the 참고항목 suffix |
| `sido`, `sigungu`, `sigunguCode`, `bcode` | `경기`, `성남시 분당구` | pre-split region — useful as filter fields |
| `…English` twins (`addressEnglish`, `roadAddressEnglish`, `sidoEnglish`, …) | | an English-facing UI |

1. **`data.postcode` is NOT the postcode.** `postcode`, `postcode1`, `postcode2` and `postcodeSeq`
   are the old 6-digit scheme and have shipped **empty since 2020-03-09**. Naming the form field
   `postcode` is fine; reading `data.postcode` returns `""`. Always read **`data.zonecode`**.
2. **`roadAddress` / `jibunAddress` can come back empty** when the two forms map 1:N — fall back to
   `autoRoadAddress` / `autoJibunAddress` (both filled unless `autoMapping: false`).

```js
function composeAddress(data) {
  const road = data.userSelectedType !== 'J';
  const addr = road ? (data.roadAddress  || data.autoRoadAddress)
                    : (data.jibunAddress || data.autoJibunAddress);
  if (!road) return addr;
  let extra = '';                                        // 참고항목 — road-name form only
  if (data.bname && /[동로가]$/.test(data.bname)) extra = data.bname;
  if (data.buildingName && data.apartment === 'Y') extra += (extra ? ', ' : '') + data.buildingName;
  return extra ? `${addr} (${extra})` : addr;
}
```

**Always render a second input for the detail address (상세주소).** The widget returns the building,
never the unit, floor or door — so a form with one address box is unshippable. Keep the looked-up
address read-only (or clearly re-searchable) and focus the detail input in `oncomplete`.

## Storing it in Weegloo

Model the pieces as separate fields (`weegloo-create-content-type`), never one blob:

- `postcode` — **ShortText**, `data.zonecode`. Never a Number: postcodes carry leading zeros.
- `address` — ShortText, the composed value above.
- `addressDetail` — ShortText, what the user typed. The one freely-filled field here, so give the
  input a **`maxlength` of 64**: past that the save is refused, not the keystroke.
- Add `roadAddress` / `jibunAddress` / `sido` / `sigungu` **only** when a screen really filters or
  displays them (`weegloo-minimal-load`).

All of these are **`localized: false`** — a Korean address is one value, not one per language
(`weegloo-default-locale`). The single exception: an English-facing UI that must show both, where the
address field goes `localized: true` with the Korean value in the default locale and
`roadAddressEnglish` in the English one.

**A member's address is personal data.** A shipping or profile address is per-user private Content —
scope it with `createdBy :self` (`weegloo-space-role`) and let the member write it over ACMA
(`weegloo-service-architecture`). Never expose an address ContentType through a public CDA delivery
token.

## Do not roll your own

No server-side proxy, no scraping of the postcode site, no home-made postcode table, and no paid
address API unless the user names one.

## If it does not work

- **Popup never appears** → `open()` ran outside a user gesture (on load, or after an `await`) and
  the browser blocked it. Move it into the click handler, or switch to `embed`.
- **`kakao is not defined`** → the script tag is missing, comes after your code, or the
  protocol-relative URL was kept and the page is on `file://`.
- **Embedded widget is blank** → the target element was not in the DOM, was hidden, or had zero
  height when `embed()` ran.
- **Scrollbar inside the widget** → wire `onresize`.
- The service needs the public internet; intranet / offline deployments are not supported.

## Related

- `weegloo-platform-integration` — the router that sends an address field here.
- `weegloo-create-content-type` — modelling the postcode / address / detail fields.
- `weegloo-space-role` + `weegloo-service-architecture` — keeping a member's address private
  (`createdBy :self`, ACMA).
- `weegloo-web-hosting` — the static deploy this widget runs on unchanged.
