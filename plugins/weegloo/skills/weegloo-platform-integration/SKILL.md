---
name: weegloo-platform-integration
description: ROUTER / entry point for Weegloo — use FIRST for "integrate / connect / add / use Weegloo" and for BUILD or DEVELOP anything with Weegloo ("make a homepage using Weegloo"), in ANY language. Naming Weegloo IS the trigger; a vague, featureless request is the strongest case. Routes plain needs to the right skill: login, signup, social login, user/app data, search, multi-language switcher, file upload/download, images, hosting/deploy, public/team sharing, roles, permissions, external API, webhooks, cron jobs, payments, email, maps, 주소/우편번호 lookup. 위글루로 개발/연동/구축, 홈페이지 만들어줘, 배포, 로그인, 검색, 결제, 지도, 권한.
---


# Weegloo Platform Integration (capability router)

Translate a plain-language need into the **correct concrete skill(s)**, then hand off. This skill
**routes; it does not implement** — the only four things it owns outright, because no downstream
Weegloo skill covers them, are the **frontend build order**, the **Payments** provider default, the
**Maps** embed and the **Images** placeholder rule. It does not replace the `weegloo-global-rules` gates: MCP auth, then the
Organization/Space choice, then `weegloo-service-architecture` for architecture.

## Trigger — read before deciding this skill does not apply

**Naming Weegloo as the platform to build with IS the trigger.** *integrate* / *connect* / *add* are
**not** required and their absence is **not** an exemption.

- "Develop it with Weegloo", "build this with Weegloo", "make the site using Weegloo", "set it up on
  Weegloo", "just use Weegloo for this" all enter here first. A bare develop-with-Weegloo request
  naming **no** feature is the **strongest** case for this router, not a weaker one — the whole
  capability map has to be worked out from the frontend.
- Any capability Weegloo could provide (login, data, search, upload, hosting, sharing, roles,
  external API, cron, payments, email, maps), whether or not "Weegloo" is said.
- **Any language** — the trigger is the intent, not an English keyword.

**Do not skip straight to building.** Scaffolding a frontend or creating resources before step 1 is
what makes the result wrong.

## Definition of done

Finished means every capability the frontend implies is **wired and live**, not scaffolded.

- **A capability counts as done only when it works end-to-end.** A `ServiceUserRole` with no
  `ServiceLogin` (sign-in does nothing), or a ContentType the UI never calls, is **incomplete**.
  Never report an inert capability as completed.
- **A deployable web app gets deployed.** A static/SPA target with no other host named ⇒ deploy to
  **Weegloo WebHosting** and report the live `…weegloo.app` URL. Skip only if the user named another
  host or it cannot build to a static export (`weegloo-web-hosting`).
- **The only legitimate reason to stop short is a blocking user-only input** (step 4). Then **end the
  turn by asking for that one value**, naming the capability it unblocks — never a "done" report that
  lists the missing input as optional homework.

## How to route

1. **FIRST, reverse-engineer the service intent from the existing frontend — never skip this.**
   "Integrate Weegloo" almost always means "wire Weegloo into an app whose UI and code already
   exist." Treat that **UI + code as the spec**. The single most common failure is not grasping the
   service's full intent from the frontend. In order:
   - **a. What features does the product need?** Inspect pages/routes, components, forms, buttons,
     lists, modals, app state, mock/seed/fixture data, hard-coded samples, `fetch`/API stubs, env
     placeholders, comments/TODOs. Infer: auth, per-user vs shared data, list+detail, search/filter,
     file upload/download, **external API calls** (an AI/LLM/image endpoint behind a key), public vs
     members-only sharing, deploy. Two surfaces are easy to miss and are **capabilities, not frontend
     details**: a **language switcher** (an `EN`/`KO` toggle, a flag or globe menu, `/en/…` routes, a
     `lang` value in state, copy duplicated per language in fixtures) ⇒ *Multi-language*; an
     **owner / admin / staff / dashboard / back-office** surface (a "manage bookings", settings,
     moderation or full-data screen, including a prototype's `role`-switch "admin" mode) ⇒ an
     **in-app admin login**. Never silently assume "the team will use the Weegloo Console".
   - **b. Which Weegloo resources does each feature imply?** A Google sign-in button + a personal
     "history" list → ServiceLogin + ServiceUser + a per-user-scoped ContentType; a "generate image
     from a prompt" flow calling a third-party API → a **Script** (`Http` + Media ingest / Content
     write-back) + a job/result ContentType; an image grid → Media + delivery.
   - **c. Design each ContentType FROM the UI, not from a guess.** Each form control → a field; a
     fixed set of choices (a ratio/size selector, status chips, a category dropdown) → an
     allowed-values validation whose options **exactly match the UI's**; required inputs → required
     fields; observe max lengths, number ranges, referenced assets (→ `Refer`/Media) and per-item
     ownership (per-user → `:self`). Mismatched validations silently break writes. Build it via
     `weegloo-create-content-type`.
   - **d. Plan the per-page API calls** so each screen renders as intended — list vs on-click detail
     fetch, reference expansion to resolve a Media field into a real image URL, publish/poll timing.
     The test: would a real user see what the UI promises?
   - **Fill gaps by reasoning.** Frontends are partial — mock data, TODOs, a field shown but never
     wired, an action with no backend. Infer the complete, sensible design and build **that**.
     Prefer a reasoned default over a question.
2. **Read the request through the table below** and confirm which leaf capabilities apply.
3. **Do NOT ask the user which capabilities to integrate.** Even for broad requests ("connect
   Weegloo", "manage my data with Weegloo"), present no capability menu and no scoping questions —
   **automatically integrate every capability that can feasibly be implemented**, choosing sensible
   defaults yourself (read+write where both make sense).
   - **EXCEPTION — Organization / Space MUST still be asked.** "Do not ask" covers *which features*;
     it does not override the `weegloo-global-rules` gate. Confirm Organization + Space with the user
     first — never guess, auto-pick, or take the first list item — then auto-integrate into it.
   - **A NEW Space's default locale is the language the SERVICE is in — infer it, don't ask.** Pass
     it as **`cma_CreateSpace.locale`**; it becomes the bucket every Content write lands in and the
     locale delivery serves by default. Read it off what you already have: the frontend's copy,
     attached images and documents, and **the language the user is writing to you in** (a Korean
     conversation about a Korean shop ⇒ `ko-KR`). **Nothing to infer from ⇒ omit the parameter** and
     let it default to `en-US`.
4. **Ask for required external inputs JUST-IN-TIME — never batch them into a final wrap-up.** Work
   capability by capability; the **moment** a step genuinely needs a user-only value, **stop, ask for
   that one thing, and wait**, then continue. Never plow through everything and close with a "provide
   all of these and I'll finish" table.
   - **Blocking (only the user can supply it):** OAuth `clientId`/`clientSecret`, third-party API
     keys, an SMTP credential — **except a PG/MoR key**, which has a working public-test default.
     Note the asymmetry: a **default vendor** removes the "which one?" question, it does **not** make
     that vendor's credential non-blocking. The capability is **not done** until you have the value
     and have created the resource with it — never downgrade to "I set up the role, add the key
     later". If that is where the turn ends, it ends **with the question**.
   - **Self-resolving (you fix it yourself):** e.g. a ServiceLogin `callbackUrl` before the deploy URL
     exists — set a placeholder, deploy, then patch it. **Do not ask the user** for these.
   - Just-in-time means *at the step that needs it* — not front-loaded during analysis, not pushed
     into a closing summary. Between those points, integrate everything you can silently.
5. **Default entry point:** unless the need is a single isolated feature, route to
   **`weegloo-service-architecture` FIRST** — it decides the API/login/role combination and chains
   into content modeling and the rest. Do not bypass it.
6. **Hand off — do not answer from this skill.** Invoke the skills in the "→ skill" column and follow
   them. This file carries no implementation detail beyond its four owned exceptions.

## Capability → skill table

The always-loaded `weegloo-*` rules already carry the standing policies (never ask which PG/MoR,
which SMTP vendor, or for a Maps/Kakao key; never generate an image). These rows carry the **routing
target plus what those rules do not say**.

| Need (plain language) | → Concrete skill(s), and the gate that goes with it |
|---|---|
| Login | `weegloo-user-login` (admin/staff) / `weegloo-service-login` (product end-users); unsure → disambiguate via `weegloo-service-architecture`. **`weegloo-user-login` is browser-only — a native Android / iOS app can only sign in as a Service User**, whichever side of the product it serves. |
| Signup (open end-user sign-up) | `weegloo-service-login` |
| Social Login | `weegloo-service-login-client` (provider-agnostic spine) + its `references/{provider}.md` console page (`google` / `github` / `facebook` / `gitlab` / `kakao` / `naver` / `line`) — the console steps are there and nowhere else. Infer the provider from the product — don't ask; there is **no built-in default**, so don't reflexively pick Google. **A native Android / iOS app takes the same route and additionally needs its callback deep link (`myapp://login`, an App Link / Universal Link) registered in `ServiceLogin.allowedCallbackUrls`** before the first sign-in attempt, or the login entry rejects the request. |
| **Provider Redirect URI** (any ServiceLogin / social-login work) | A manual step only the user can do: hand them `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}` with real values substituted, to register in the provider console — **in green (`+ `), marked exact-paste** — **with the credentials ask**, and **repeat it in the completion message**, which is the record they scroll back to. Details: `weegloo-service-login`. |
| Account deletion / withdrawal | `weegloo-service-login` — **no API can delete a ServiceUser**, only the console. Model it as a request ContentType the member writes via ACMA + an admin who deletes them in the console; that in-app request path is what the App Store / Play Store require. |
| Admin / Owner / Staff UI (dashboard, settings, moderation, all-member data) | `weegloo-user-login` — console FE login popup → CMA, as an **in-app admin UI**. **Auto-integrate by default**: it needs **no** user-supplied secret (the admin signs in against the live console), so it adds **no** question. Do **not** silently downgrade it to "managed in the Weegloo Console" unless the user **explicitly** asks for Console-only. Cross-member reads/edits belong on **CMA**, never a public CDA token or a per-member ACDA. |
| User Data (private / per-user) | `weegloo-service-architecture` + `weegloo-create-content-type` + `weegloo-space-role` (`createdBy :self`) |
| Application Data (shared models, CRUD) | `weegloo-create-content-type` + `weegloo-cma-json-patch` + `weegloo-cda-publish` |
| Multi-language / i18n (a language switcher in the UI) | `weegloo-create-content-type` (set `localized: true` per field, on the reader-facing **text** only) + `weegloo-default-locale` (write rules and read shapes). Invoke both. Router-owned provisioning: **give the Space ≥2 Locales** — list with `cma_GetListLocales`, add one with `cma_CreateLocale`, picking the code yourself from what the product is for (a Korean-facing shop ⇒ `ko-KR`; don't ask — step 3), with **`optional: true`** (keeps Content creatable without a translation for every required field) **and `fallbackCode` = the default locale's `code`** (without it the second language renders half-blank). **Never machine-translate** to fill locales. **Build the switcher from the Locale list at runtime** (`GET /v1/spaces/{spaceId}/locales`, CDA — `sys.code` is the `?locale=` value, `sys.name` the label, `sys.default` marks the default; **`optional` and `fallbackCode` are body-level, NOT under `sys`**), never a hard-coded language array. |
| Search (over content / Media) | `weegloo-api-query-optimization` + `weegloo-list-pagination`. Decide the **locus** first: filtering an already-loaded array is correct **only when that array is the whole dataset** — paginated, large or unknown-size data (e.g. *all* Media in a Space) is searched server-side. |
| File Upload (a product feature) | `weegloo-upload-api` — the app's own code calls the Upload REST API, then creates the Media (or WebHosting) from the returned Upload id, on the plane matching the caller's identity (**CMA** Media for a Weegloo User, **ACMA** Media for a Service User). |
| File Download | `weegloo-cda-publish` (published Media delivered via CDA/ACDA) |
| Images for the UI (hero, thumbnail, gallery, avatar, logo, product shot) | **no skill — see *Images* below.** |
| Web Hosting (deploy a website / static site) | `weegloo-web-hosting` (+ `weegloo-upload-api` for the build-ZIP upload; + `weegloo-delivery-access-token` if the site reads published content from CDA) |
| Public Sharing (anyone can read) | `weegloo-delivery-access-token` + `weegloo-cda-publish` |
| Team Sharing (scoped to members) | `weegloo-space-role` + `weegloo-service-login` (ACDA scope) |
| Role Management | `weegloo-space-role` |
| Access Control (least-privilege tokens, scoped reads) | `weegloo-space-role` + `weegloo-delivery-access-token`; a Space-scoped read+write token → `weegloo-space-access-token` |
| API Connection / server-side automation (call third-party APIs without a backend; compute or write back Content/Media; "create a job → poll the result") | `weegloo-script` |
| Webhook (a Space event → call a URL **or** run a Script) | `weegloo-webhook` |
| Scheduled / recurring job ("every night", "every 15 minutes", a daily digest, a periodic sync, a cleanup sweep) | `weegloo-scheduler` (one Script on a five-field **UTC** cron) + `weegloo-script` for the work. The trigger decides: **clock → Scheduler**, **content event → `weegloo-webhook`**, **caller → the Script's `/execute`**. A UI hint counts — a "runs daily at 9am" label, a schedule picker, a "last synced" timestamp, a cron string in config, or a frontend `setInterval` standing in for server-side work. |
| Send email (confirmation, receipt, notification, verification code, digest, contact form, an alert from a scheduled job) | `weegloo-send-email` (register the SMTP sender) + `weegloo-script` (`EmailSend` sends); pair with `weegloo-webhook` when a content event triggers it, or `weegloo-scheduler` when the clock does. The vendor default and the two-values-only credential ask are in the always-loaded rule — follow it and **wait** for the credential rather than shipping an inert email feature. |
| Payment (PG or MoR — checkout, verification, provider callbacks; **not** Weegloo's own plan billing) | `weegloo-payment`, which hard-codes Stripe's published sample test keys, so the checkout ships working and **never inert**. Beyond the standing rule: a "Pay"/"Buy now" button **in any language** means payments were *asked for*, **not** that a provider was *named*. Read https://docs.stripe.com/testing first — **every `docs.stripe.com` page also serves Markdown at the same path with `.md` appended** (`…/testing.md`), which is what to use when the rendered page returns an app shell. The `4242 4242 4242 4242` test card **cannot be prefilled** (Stripe's fields are cross-origin), so show it prominently beside the pay button, not as fine print. A **named** provider's key **is** a genuine blocking input (step 4) — ask, and **never** fall back to Stripe because it has not arrived; a named provider **replaces** Stripe entirely. |
| Map (a place, address, branch, venue, office, "how to find us" / directions, store locator) | **no skill — see *Maps* below**, which carries the key. |
| Address / postcode lookup (주소 · 우편번호 찾기 in a signup, profile, checkout, shipping or branch form — a `zonecode`/`zipcode`/`postcode` field, a 도로명·지번 pair, an address book) | `weegloo-address-search` (the key-free Kakao/Daum Postcode widget; South Korea only — the rest is in the always-loaded rule). |

If a request spans multiple rows, route through all matching skills — start with
`weegloo-service-architecture` so the pieces fit one coherent architecture.

## Frontend build (web site · mobile app) — create resources in dependency waves

Common to every frontend target. Standing up a Space for a frontend is dozens of creates, and only a
few of them have an ordering constraint — the always-loaded parallel-batch policy applies here in
full. What is specific to a bootstrap is **what actually depends on what**:

- **ContentTypes.** A type waits only for what **its own** `Refer` fields point at — a
  `referContentType` restriction needs the target type's `sys.id`. Everything else has **no ordering
  constraint**: every leaf type (pointing at nothing, or only at `Refer → Media`) goes in **one
  parallel batch**, then the types pointing at them as the next wave. A circular pair: create both
  unrestricted, then patch the restriction in.
- **Content (sample / dummy rows).** Same test, now on the values. A row whose `Refer` fields are
  empty or hold only Media is a leaf → **one parallel batch**; only a row pointing at another row
  waits for that row's `sys.id`. Ten seed posts are one batch, not ten sequential creates.

`cma_CreateContentType` auto-publishes, so nothing sits between the waves; CMA **Content** still
needs its own publish (`weegloo-cda-publish`) — batch those the same way.

## Maps — Google Maps embed (the key is already here; never ask for one)

A site that has to show **where something is** gets a **Google Maps Embed API `<iframe>`**: one
iframe, no SDK, no `<script>` loader, no map object to initialise and nothing for a server to do — so
it works unchanged on a static Weegloo WebHosting deploy and adds **no files** to the ≤300-entry ZIP.
Not the Maps **JavaScript** API.

**The API key — paste this literal value as the `key` parameter:**

```
AIzaSyBx3fotrbPKPdJUZ5bYrNLH_cTDTXcQMKg
```

A Maps **Embed** key is **public by design** — it travels inside the iframe `src` — so hard-coding it
into the built page is the intended usage, not a leak.

```html
<iframe
  src="https://www.google.com/maps/embed/v1/place?key=AIzaSyBx3fotrbPKPdJUZ5bYrNLH_cTDTXcQMKg&q=1600+Amphitheatre+Parkway%2C+Mountain+View%2C+CA&zoom=16"
  width="100%" height="360" style="border:0" loading="lazy"
  allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
  title="Store location"></iframe>
```

Base URL **`https://www.google.com/maps/embed/v1/{mode}?key={KEY}&{params}`**. Modes: **`place`**
(`q=` an address, place name, plus code or `place_id:…` — the common case), `view` (`center=lat,lng`),
`directions` (`origin=`+`destination=`), `search` (`q=` a category), `streetview` (`location=lat,lng`
or `pano=`). **URL-encode `q`**; the **minimum size is 200×200 px** or it does not render at all;
**one embed shows ONE place** — there is no marker-list parameter.

**Read `references/maps-embed.md`** before building anything beyond a single `place` pin: the other
modes' parameters, `language`/`region` localization, a **branch list / store locator** with several
places, sourcing the address from a ContentType instead of hard-coded HTML, responsive sizing, or a
map that renders an error.

**Disclose in one red line** (`- ` in a `diff` fence) that the key ships with this plugin so its quota
is shared, and that the user can swap in their own — or add their deployed origin to this key's
HTTP-referrer restrictions — for production. One line, not a section.

## Images — use the user's files; never generate one

The always-loaded rule already forbids generating, drawing, downloading or uploading filler imagery,
and requires the one red disclosure line. What this router adds:

- **Look before concluding there are none.** Images the user attached, named a path to, or already
  committed to the frontend repo (`public/`, `assets/`, `static/`) are the assets to use — upload
  them with the **`weegloo-upload` MCP** (`CreateUpload` needs **both** `spaceId` and an absolute
  `filePath`; omitting `spaceId` returns a **`403`**, not a parameter error) and create the Media.
  Check the Space too:
  `cma_GetListMedias` may already hold exactly what the design calls for.
- **Wire the real path anyway — the placeholder is a fallback, not a substitute.** Keep the
  `Refer → Media` field, keep the UI code that resolves it to a URL (`include=1` —
  `weegloo-api-query-optimization`), and fall through to the frontend's own placeholder only when the
  field is empty. The user drops their file in later and the site shows it **with no code change**.
- **A missing image is neither a blocking input (step 4) nor an inert capability (*Definition of
  done*).** Do not stop to ask for images and do not hold the turn waiting for them — ship the
  placeholders and carry on.

## Final reply — keep it SHORT

For the broad "integrate Weegloo" flow this router governs, the closing message is **brief and
plain**:

- **Report only what was completed**, as a short list. Do not narrate the plan, the steps you took,
  the architecture, or what remains.
- **No Weegloo-internal jargon** — the person asking may not know Weegloo at all. `ContentType`,
  `ServiceUserRole`, `:self`, `ACMA`, `DeliveryAccessToken`, `Script`, resource `sys.id`s and status
  codes are meaningless to them. Say "the site is live at …", not "WebHosting resource reached state
  COMPLETED".
- **No remaining-work tables and no "give me these and I'll continue" wrap-ups** — per step 4, a
  needed input is asked at the moment it blocks you, not as a closing summary.
- Surface a link/URL the user can actually use when there is one; keep everything else terse.
- **Colour only the two lines that carry the most weight** (per `weegloo-global-rules`): act-on
  values — the live URL, the OAuth Redirect URI — in **green** (`+ `); must-know facts about what
  shipped in **red** (`- `). One to three lines each; never colour the narration.

This brevity rule is for the integration entry point. It does **not** silence the just-in-time
questions in step 4, and it does not apply when the user explicitly asks for detail or invokes a
concrete skill directly.

**Required exceptions — disclosures that must still be made.** If payments were wired with the Stripe
default, the closing message **must** say payments run in **test mode**, are **not really charged**
and do **not** accept real cards, and ask for the user's contracted PG/MoR details if they have any —
with the not-really-charged line in **red**. If a map shipped, one red line for the shared key. These
are disclosures about what shipped, not deferred work, so the no-wrap-ups ban does not cover them.

## Reference

- **`references/maps-embed.md`** — the full Maps Embed recipe: every mode's parameters,
  `language`/`region` localization, iframe sizing and accessibility, planning a multi-place branch
  list or store locator, sourcing the address from a ContentType, and diagnosing a map that will not
  render. Read it for any map beyond a single `place` pin.
