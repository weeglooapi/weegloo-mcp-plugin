---
name: weegloo-platform-integration
description: ENTRY-POINT / ROUTER for Weegloo. Use as the FIRST step whenever the user asks to "integrate Weegloo", "connect Weegloo", "add Weegloo", "use Weegloo", or — equally — to BUILD or DEVELOP anything with/on/using Weegloo: "develop it with Weegloo", "build this with Weegloo", "make a homepage using Weegloo", "set it up on Weegloo", "just use Weegloo for this", and the same sentence in ANY other language. Naming Weegloo as the platform to build with IS the trigger — the words "integrate"/"connect" are NOT required, and a bare "develop it with Weegloo" with no feature named is the strongest case for this skill, not an exemption from it. Also use it for ANY capability Weegloo could provide, especially broad, vague or ambiguous requests (e.g. "manage my data with Weegloo"). Maps a plain-language need (login, signup, social login, user/app data, search, multi-language — a language switcher in the UI means Weegloo Locales plus per-field localized, never a frontend-only concern — file upload/download, web hosting/deploy, public/team sharing, roles, access control, external API/webhook, scheduled or recurring jobs, payments — where no named PG/MoR means Toss Payments test keys rather than a question — sending email, where no named email service or SMTP vendor means Google/Gmail SMTP and a request for the user's Google App Password rather than a "which vendor?" question — and maps, where showing a place on a map means a Google Maps EMBED iframe with the API key already hard-coded in this skill rather than a question) to the correct concrete Weegloo skill so the user never has to know Weegloo's internal feature names. This skill only identifies and routes — the concrete skill it points to does the real work (the Payments provider default and the Maps embed are the two exceptions it carries itself). English only.
---

# Weegloo Platform Integration (capability router)

When the user asks to integrate Weegloo, or requests functionality that can be provided by
Weegloo, automatically identify the appropriate Weegloo capabilities and configure them
without requiring the user to know specific Weegloo feature names.

This skill is a **router/dispatcher**. Its job is to translate a plain-language need into the
**correct concrete skill(s)**, then hand off. It does **not** implement features itself — the only
two exceptions are the standing **Payments** provider default and the **Maps** embed below, neither
of which has a downstream Weegloo skill to hand off to — and it does **not** replace the existing
hard gates in `weegloo-global-rules` (e.g. architecture work must still go through
`weegloo-service-architecture`).

## What counts as a trigger — read this before deciding the skill does not apply

**Naming Weegloo as the platform to build with IS the trigger.** The words *integrate* / *connect* /
*add* are **not** required, and their absence is **not** an exemption:

- **"Develop it with Weegloo"**, "build this with Weegloo", "make the site using Weegloo", "set it
  up on Weegloo", "just use Weegloo for this" — **every one of these enters here first.** A bare
  *develop-with-Weegloo* request is the **strongest** case for this router, not a weaker one: it names
  no feature, so the entire capability map below is what has to be worked out from the frontend.
- Any request for a capability Weegloo could provide — login, data, search, upload, hosting, sharing,
  roles, external API, cron, payments, **maps** — whether or not the word "Weegloo" is even said.
- **Any language.** The trigger is the *intent* — *make something, on Weegloo* — not an English
  keyword. The same request written in Korean, Japanese or any other language enters here identically;
  `weegloo-global-rules` carries the literal non-English phrasings.

**Do not skip straight to building.** On such a request, scaffolding a frontend or creating resources
before step 1 (reading the existing frontend as the spec) is what makes the result wrong. The
`weegloo-global-rules` gates — MCP auth, then the Organization/Space choice — still run first.

## Definition of done — what "integrate Weegloo" means (read this FIRST)

"Integrate Weegloo" is **not** finished when the pieces are *scaffolded* — it is finished when every
capability the frontend implies is **actually wired and live**. Hold the whole flow to this contract:

- **A capability counts as done only when it is switched on and works end-to-end** — not when its
  supporting resource exists but the feature is inert. Creating a `ServiceUserRole` but never creating
  the `ServiceLogin` (so sign-in does nothing), or modelling a ContentType the UI never gets wired to
  call, is **incomplete work** — not "done, finish the rest later." **Never report an inert capability
  as completed.**
- **A deployable web app gets deployed.** If the integration target is a runnable static/SPA site and
  the user has not named another host, deploying it to **Weegloo WebHosting** and reporting the live
  `…weegloo.app` URL is part of finishing — running it only locally is **not** a deliverable. (Skip the
  deploy *only* if the user specified another host, or the app genuinely cannot build to a static
  export — see `weegloo-web-hosting`.)
- **The only legitimate reason to stop short of a wired-and-live capability is a blocking user-only
  input** (step 4). When that happens, **end the turn by asking for that one value** and naming the
  capability it unblocks — do **not** end with a "done" report that lists the missing input as optional
  future homework. Asking and waiting is the correct finish here; silently deferring is the failure to
  avoid.

## How to use this skill

1. **FIRST, reverse-engineer the service intent from the existing frontend — never skip this.**
   "Integrate Weegloo" almost always means "wire Weegloo into an app whose UI and code already
   exist." Treat that **UI + code as the spec** for what the backend must provide, and read it
   systematically *before* routing or creating anything. The single most common failure is not
   grasping the service's full intent from the frontend — work through these in order:
   - **a. What features does the product need?** Inspect pages/routes, components, forms, buttons,
     lists, modals, app state, mock/seed/fixture data, hard-coded sample values, `fetch`/API stubs,
     `config`/env placeholders, and comments/TODOs. From those, infer the capabilities in play:
     auth (login/signup), per-user vs shared data, list+detail views, search/filter, file
     upload/download, **calls to an external API** (e.g. an AI/LLM/image endpoint behind a key),
     public vs members-only sharing, deploy/hosting. Map each to the capability list below.
     A **language switcher** — `English` / `한국어` buttons, a flag or globe menu, `/en/…` routes, a
     `lang` / `locale` value in state or config — means the product is **multi-language**; that is a
     capability too (*Localization* below), not a frontend detail.
     An **owner / admin / staff / dashboard / back-office** surface in the UI (e.g. a "manage
     bookings", "settings", "moderation", or full-data overview screen, including a prototype's
     `role`-switch "admin" mode) is itself a capability — an **in-app admin login** for a Weegloo
     User (`weegloo-user-login`). Recognize it and auto-integrate it like any other leaf; do **not**
     silently assume "the team will use the Weegloo Console."
   - **b. Which Weegloo resources does each feature imply?** e.g. a Google sign-in button + a
     personal "history" list → ServiceLogin + ServiceUser + a per-user-scoped ContentType; a
     "generate image from a prompt" flow that calls a third-party API → a **Script** (external `Http`
     call + Media ingest / Content write-back) + a job/result ContentType; an image grid → Media +
     delivery.
   - **c. Design each ContentType FROM the UI, not from a guess.** Read the actual inputs and
     outputs the UI binds to and derive fields, types, and validations: each form control → a field;
     a fixed set of choices (a ratio/size selector, status chips, a category dropdown) → an
     enum/allowed-values validation whose options **exactly match the UI's**; required inputs →
     required fields; observe max lengths, number ranges, referenced assets (→ Refer/Media), and
     per-item ownership (per-user → `:self`). Mismatched validations silently break writes, so align
     them to the code. Then build it via `weegloo-create-content-type`.
   - **d. Plan the per-page API calls so each screen renders as the user intended.** For every view,
     decide exactly which endpoint and shape to call and when — list vs on-click **detail** fetch,
     reference expansion to resolve a Media field into a real image URL, publish/poll timing. A
     list/sidebar shows a lightweight label; opening an item fetches its detail (see
     `weegloo-api-query-optimization`). The test is: would a real user see what the UI promises?
   - **Fill gaps by reasoning — do not model only what is literally spelled out.** Frontends are
     usually partial: mock data, TODOs, a field shown but never wired, an action with no backend.
     When the UI implies something the code doesn't fully express, infer the **complete, sensible**
     design and build that — capture the service's *intent*, not just its current stubs. Prefer a
     reasoned default over a question; reserve questions for the unavoidable user-only inputs
     (secrets/credentials and the Organization/Space choice — see steps 4–5).
2. **Read the request through the capability map below** and confirm which leaf capabilities apply,
   using what step 1 surfaced.
3. **Do NOT ask the user which capabilities to integrate.** Even for broad/ambiguous requests
   (e.g. "connect Weegloo", "manage data with Weegloo"), do not present a capability menu and do
   not ask scoping questions about which features to include. Instead, **automatically integrate
   every capability that can feasibly be implemented** for the request — treat the full capability
   map below as in-scope by default and wire up each leaf that applies. Choose sensible defaults
   yourself (e.g. read+write where both make sense) rather than asking the user to decide.
   - **EXCEPTION — Organization / Space MUST still be asked.** "Do not ask" applies only to *which
     capabilities/features* to integrate. It does **not** override the `weegloo-global-rules` hard
     gate: the target **Organization** and **Space** must always be decided **with the user** before
     any space-scoped work — never guess, auto-pick, or use the first item from a list. Confirm the
     Organization + Space first, then auto-integrate every feasible capability into it.
4. **Ask for required external inputs JUST-IN-TIME — never batch them into a final wrap-up.**
   Some capabilities need a value only the user can supply (e.g. a Google OAuth Client ID/Secret
   for ServiceLogin, a third-party API key for a Webhook). Do **not** plow through everything and
   then conclude with a summary table that asks the user to "provide all of these and I'll finish"
   — that pattern is wrong. Instead, work capability-by-capability and the **moment** you reach a
   step that genuinely needs such an input, **stop and ask for that one thing**, then continue once
   you have it. Integrate everything you *can* without user input silently; surface a question only
   at the exact point it blocks the next concrete action, and ask only for what that step needs.
   - **Two kinds of missing input — handle them differently:**
     - **Blocking (only the user can supply it):** OAuth `clientId` / `clientSecret`, third-party API
       keys, an SMTP credential — on the Google email default, a **Google App Password** plus the
       Google address it belongs to (see **Email** below) — etc. — **except a PG / MoR key**, which has
       a working public-test-key default and is therefore *not* blocking (see **Payments** below).
       Note the asymmetry: a *default vendor* removes the "which one?" question, it does **not** make
       that vendor's credential non-blocking. When you reach the step that needs a truly
       blocking value, **stop, ask for it, and wait** — the capability is **not done** until you have
       the value and have actually created the resource with it. Do **not** downgrade to "I set up the role; add the key later" and move on: an inert
       auth/login/webhook feature is *incomplete* (see *Definition of done*). So if this is where the
       turn ends, it ends **with the question**, not with a completion report.
     - **Self-resolving (you can supply a placeholder and fix it yourself):** e.g. a ServiceLogin
       `callbackUrl` before the deploy URL exists — set a placeholder, deploy, then patch it. **Do not
       ask the user** for these; resolve them yourself.
   - **Just-in-time means *at the step that needs it* — not earlier, not at the end.** Do not
     front-load a blocking question during analysis before you actually reach the step, and do not
     push it past the step into a closing summary. Between those points, integrate everything you
     *can* without user input silently.
   - This does not reintroduce capability menus or scoping questions (step 3 still holds). It only
     governs *how* you collect the unavoidable per-capability inputs: incrementally, in context.
5. **Default entry point:** almost every "integrate Weegloo" request is really "build something on
   Weegloo", so unless the need is a single isolated feature, route to **`weegloo-service-architecture`
   FIRST** — it decides the API/login/role combination, then chains into content modeling and the
   rest. Do not bypass it.
6. **Hand off — do not answer from this skill.** Invoke the concrete skill(s) in the
   "→ skill" column and follow them. This file deliberately contains no implementation detail.

## Keep the final reply SHORT (integration flow only)

This applies specifically to a broad **"integrate Weegloo"** request — the entry-point flow this
skill governs. When you finish, the user-facing message must be **brief and plain**:

- **Report only what was completed**, as a short list. Do not narrate the plan, the steps you took,
  the architecture, or what work remains/comes next.
- **No Weegloo-internal jargon.** The person asking may not know Weegloo at all — terms like
  `ContentType`, `ServiceUserRole`, `:self`, `ACMA`, `DeliveryAccessToken`, `Script`, resource
  `sys.id`s, status codes (404), etc. are meaningless to them. Describe outcomes in plain language
  (e.g. "the site is live at …", not "WebHosting resource reached state COMPLETED").
- **No remaining-work tables or "give me these and I'll continue" wrap-ups** (per step 4, ask for a
  needed input at the moment it blocks you — not as a closing summary).
- Surface a link/URL the user can actually use when there is one; keep everything else terse.
- **Colour the two lines that carry the most weight** (`weegloo-global-rules` → *Highlight what the
  user must act on or must know*): act-on values — the live URL, an OAuth Redirect URI to register —
  in **green** (`+ ` in a `diff` fence); must-know facts about what shipped — payments on test keys,
  say — in **red** (`- `). One to three lines each, never colour the narration.

This brevity rule is for the integration entry point. It does **not** silence the just-in-time
questions in step 4, and it does not apply when the user explicitly asks for detail or invokes a
specific concrete skill directly.

**One required exception — a test-key payment flow.** If payments were wired with the Toss Payments
default (see *Payments*), the closing message **must** still say that payments run on Toss test keys
and are **not really charged**, and ask for the user's contracted PG/MoR details if they have any.
That is a disclosure about what shipped, not deferred work, so the "no give-me-these wrap-ups" ban
does not cover it. A few plain sentences — never omit it, and put the not-really-charged line in
**red** (`- ` in a `diff` fence) so it cannot be skimmed past.

**A map ships with the same kind of disclosure**, in one red line: the Google Maps embed runs on the
API key built into this plugin, so its quota is shared, and the user can swap in their own key (or
restrict this one to their own origin) for production. One line — not a section.

## Available capabilities

Each leaf maps to the concrete skill that actually does the work.

- **Authentication**
  - **Login** → identity model must be determined first (Weegloo has two separate ones):
    admin/staff = `weegloo-user-login`; product end-users = `weegloo-service-login`.
    **`weegloo-user-login` is browser-only — a native Android / iOS app can only sign in as a
    Service User**, whichever side of the product it serves.
    If unsure which, route to `weegloo-service-architecture` to disambiguate.
  - **Signup** (open end-user sign-up) → `weegloo-service-login`
  - **Social Login** (OAuth providers — Google / GitHub / Facebook / GitLab / LINE / Kakao / Naver;
    browser SDK / wire protocol; **native Android / iOS apps take the same route and additionally
    need their callback deep link registered in `ServiceLogin.allowedCallbackUrls`**) →
    `weegloo-service-login-client` (provider-agnostic spine); for Google, also `weegloo-service-login-google`,
    for GitHub, `weegloo-service-login-github`, for Kakao, `weegloo-service-login-kakao`, for Naver,
    `weegloo-service-login-naver`, for LINE, `weegloo-service-login-line` (Facebook and GitLab: follow the
    spine's generic shape — no dedicated skill). Infer the provider
    from the product — don't ask; if none is indicated, reason the best-fit provider (no built-in
    default — don't reflexively pick Google).
  - **The provider Redirect URI is announced UP FRONT, not only at the end.** Any ServiceLogin /
    social-login work: as soon as it enters the plan, tell the user the
    `https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}` URI (real values
    substituted) to register in the provider console — **in green**, marked exact-paste — so they can
    do that manual step while you build, then **repeat it in the completion message**. It is
    deploy-independent, so nothing blocks saying it early. Details: `weegloo-service-login`.
  - **Admin / Owner / Staff surface** (an in-product dashboard, settings, moderation, or
    back-office screen — anything where staff read or edit *all* members' data, not just their own)
    → `weegloo-user-login` (console FE login popup → CMA, an **in-app admin UI**). **Auto-integrate
    by default**, exactly like any other capability: it needs **no** user-supplied secret (the admin
    signs in against the live Weegloo console), so it adds **no** question. Do **not** silently
    downgrade an admin/owner surface to "managed in the Weegloo Console" — build it in-app unless the
    user **explicitly** asks for Console-only. Cross-member reads/edits belong here (CMA), **not** on
    a public CDA token or per-member ACDA.
- **Data Management**
  - **User Data** (per-user / private, member-owned) → `weegloo-service-architecture` +
    `weegloo-create-content-type` + `weegloo-space-role` (`createdBy :self` scoping)
  - **Application Data** (shared content models, CRUD, updates) → `weegloo-create-content-type` +
    `weegloo-cma-json-patch` + `weegloo-cda-publish`
  - **Search** (a search box / filter over content or Media) → first decide the **locus**: filtering
    an already-loaded in-memory array is correct **only when that array is the whole dataset**; if the
    data is paginated, large, or of **unknown size** (e.g. *all* Media in a Space — visible items are
    not the full set), search **server-side** via the list API, not `Array.filter`. Full-text search
    over `fields.*` text (e.g. a title) needs the **Advanced Search** header
    `X-Weegloo-Advanced-Search: true` (plain `eq` is exact-match only); RichText/Json aren't
    searchable. → `weegloo-api-query-optimization` + `weegloo-list-pagination`
- **Localization (multi-language)**
  - **A language switcher in the UI means the product is multi-language** — `English` / `한국어` /
    `日本語` buttons, a flag or globe menu, `/en/…` routes, a `lang` value in state, or the same copy
    duplicated per language in fixtures. Weegloo covers it with **`Locale`** (the Space's languages)
    plus the per-field **`localized`** flag → `weegloo-create-content-type` (setting the flag) **+
    `weegloo-default-locale`** (write rules and read shapes). Invoke both; do not model from memory.
  - **Give the Space at least two Locales.** List them first (`cma_GetListLocales`) — a Space with
    only its default leaves the switcher nothing to switch. Add one with `cma_CreateLocale`, choosing
    the code yourself from what the product is for (a Korean-facing shop ⇒ `ko-KR`) — **don't ask**,
    step 3 — and create it with **`optional: true`** and **`fallbackCode` = the default locale's
    `code`**. Both settings matter: `optional: true` keeps Content creatable without a
    translation for every required field, and `fallbackCode` is what shows the default language where a
    translation is missing.
  - **`fallbackCode` is not decoration — Weegloo does NOT fall back to the default on its own.** A
    Locale without it returns **empty** for anything it does not itself hold — including every
    `localized: false` field (price, image, id), which is stored under the default locale only. Omit it
    and the second language renders half-blank.
  - **Set `localized: true` field by field, from the service.** Ask of each field: *would a reader in
    another language need a different value here?* Yes → the text a reader sees (title, body,
    description, category or button label) → `localized: true`. No → prices, dates, counts, status
    enums, slugs and ids, and a `Refer → Media` that is the same asset in every language → leave it
    `false`. That usually lands on the text fields, but decide it per field, never by type alone.
  - **Never machine-translate to fill the other locales.** Write the **default-locale** value and stop
    there; `fallbackCode` covers the rest until the user supplies real translations. Inventing
    translations is wrong work, not helpfulness.
  - **Read one language at a time — `?locale=<code>` on every delivery read**
    (`…/contents?locale=ko-KR`), matching the switcher's current choice and re-fetched when it changes.
    Delivery then returns that language **flattened** — `fields.title` is the string itself, **not**
    `fields.title["ko-KR"]` — which is both the smaller payload and the shape the UI wants. Reserve
    **`locale=*`** (every language at once, **no fallback applied**) for an editor-style screen that
    shows all languages side by side.
  - **Build the switcher from the Locale list, not a hard-coded array** — `GET /v1/spaces/{spaceId}/locales`
    (CDA). Each item carries **`sys.code`** (the value for `?locale=`), **`sys.name`**
    ("Korean (South Korea)") for the label, and **`sys.default`**; `optional` and `fallbackCode` are
    body-level, not under `sys`.
    **Render the options from that response at runtime — never a fixed language array in the code — so
    a Locale added to or deleted from the Space appears or disappears on screen with no code change.**
- **File Storage**
  - **Upload** (a file-upload feature in the user's own product) → `weegloo-upload-api` (the app's
    code calls the **Weegloo Upload REST API**, then creates Media/WebHosting from the returned
    Upload id, on the matching plane: CMA Media for Weegloo Users, ACMA Media for Service Users).
    The `weegloo-upload` MCP is **not** the implementation path for a product's upload feature — see
    the note below.
  - **Download** (deliver stored files to clients) → published Media via CDA/ACDA;
    see `weegloo-cda-publish`.
- **Hosting & Deployment**
  - **Web Hosting** (deploy a website / static site to a Weegloo subdomain over HTTPS) →
    `weegloo-web-hosting` (uses `weegloo-upload-api` to upload the build ZIP; add
    `weegloo-delivery-access-token` if the site reads published content from CDA)
- **Sharing**
  - **Public Sharing** (anyone can read) → `weegloo-delivery-access-token` + `weegloo-cda-publish`
  - **Team Sharing** (scoped to members) → `weegloo-space-role` + `weegloo-service-login` (ACDA scope)
- **Permissions**
  - **Role Management** → `weegloo-space-role`
  - **Access Control** (least-privilege tokens, scoped reads) → `weegloo-space-role` +
    `weegloo-delivery-access-token`; Space-scoped read+write token →
    `weegloo-space-access-token`
- **External Service Integration**
  - **API Connection / server-side automation** (call third-party APIs without a backend; compute or
    write-back Content/Media; "create a job → poll the result") → `weegloo-script` (Weegloo **Script**)
  - **Webhook** (react to a Space event → call a URL **or** run a Script) → `weegloo-webhook`
- **Scheduled / Recurring Work**
  - **Scheduled job** (anything that must run **on a clock** rather than on a request or an event —
    a cron entry, "every night", "every 15 minutes", a daily digest, a periodic sync with a
    third-party API, a cleanup / expiry sweep, polling an external queue) → **`weegloo-scheduler`**
    (a **Scheduler** runs one **Script** on a five-field UTC cron) **+ `weegloo-script`** for the work
    itself. Distinguish by trigger: **clock → Scheduler**, **content event → `weegloo-webhook`**,
    **caller → the Script's `/execute`**. A UI hint counts — a "runs daily at 9am" label, a schedule
    picker, a "last synced" timestamp, a cron string in config, or a `setInterval` in the frontend
    standing in for server-side work.
- **Email**
  - **Send email** (a confirmation or receipt, a notification, a verification code or magic link, a
    digest, a contact form that must reach the owner, an alert from a scheduled job) →
    **`weegloo-send-email`** (register the SMTP sender) **+ `weegloo-script`** (`EmailSend` does the
    sending); pair with `weegloo-webhook` when a content event triggers it, or `weegloo-scheduler`
    when the clock does.
  - **Which SMTP vendor — do NOT ask.** If the user **named** a service or SMTP vendor (Gmail, Naver,
    Resend, Brevo, SendGrid, Mailgun, SES, their own server…), or a credential for one already sits in
    the repo/env, use that one. If they named **none**, send through **Google (Gmail SMTP)** — a
    standing default like Toss under *Payments*, not a question.
  - **The credential IS blocking, though** (unlike a PG key): there is no public test account. On the
    Google default, ask for exactly two values and wait — a **Google App Password** created at
    **https://myaccount.google.com/apppasswords**, and the **real Google address it belongs to** (never
    an arbitrary or invented address — Gmail rewrites the From to the authenticated account). Ask for
    an App Password, **never** the account password, and say in the same breath that they should tell
    you if they would rather use a different SMTP service.
  - **Those two are the ONLY inputs.** The rest you fill in yourself: `smtp.gmail.com` / `587` /
    `StartTls` is fixed, the login and the From address are both that same Google address verbatim, and
    the From display name plus the console label you derive from the product. Never ask about a host,
    port, security mode, label, or display name.
  - **Registering the sender delivers a real test message** to that inbox — say so before creating it.
    Full mechanics: `weegloo-send-email`.
- **Payments**
  - **Payment** (take money from the product's own customers through any PG or MoR — checkout,
    verification, provider callbacks) → `weegloo-payment`. **Not** Weegloo's own subscription/plan
    billing.
  - **Which provider — do NOT ask.** "Which PG / MoR should I use?" is a scoping question and step 3
    bans it. If the user **named** a provider (or a contracted key already sits in the repo/env),
    integrate that one. If they named **none**, integrate **Toss Payments on its public documentation
    test keys** — read
    **https://docs.tosspayments.com/guides/v2/payment-widget/integration** first and follow
    `weegloo-payment`. **If that URL is dead or moved, take the current path from
    https://docs.tosspayments.com/llms.txt rather than guessing variants** (same discipline as the
    Weegloo docs rule in `weegloo-global-rules`). A checkout page or a "결제하기" button in the frontend
    means payments were *asked for*; it does **not** mean a provider was *named*.
  - **A PG key is therefore NOT a blocking input** (contrast step 4): the Toss test keys are public,
    so a clickable end-to-end checkout needs **nothing** from the user. Do not stop to ask for a PG
    key, and do not leave checkout inert pending credentials. Only if the documented test keys are
    gone does this become a real blocking question.
    - **This non-blocking exception belongs to the Toss path only.** If the user **named** a different
      provider, that provider's key is genuinely blocking again — ask for it (step 4) and **never**
      fall back to Toss because it has not arrived. A provider the user did not choose is wrong work.
  - **Disclosure is mandatory** once it works: tell the user payments were wired with Toss Payments,
    that test keys mean **nothing is actually charged**, and ask for their contracted PG/MoR details
    if they have any — then **replace Toss entirely** when those arrive. This is the one required
    exception to the brevity rule below. Put the **nothing-is-actually-charged** line in **red**
    (`- ` in a `diff` fence, per `weegloo-global-rules`) — it is the fact most costly to miss.
- **Location & Maps**
  - **Map** (a place, address, branch, venue, office, or a "how to find us" / directions block shown
    on a map) → a Google **Maps Embed API** `<iframe>`, with the API key **already hard-coded here**.
    **Never ask the user for a Maps key** — exactly like the Toss default under *Payments*, this is a
    standing default, not a question, so a map is **not** a blocking input (step 4). Full recipe:
    *Maps* below — there is no separate Weegloo skill for this.

## Maps — Google Maps embed (the key is already here; never ask for one)

A site that has to show **where something is** — a store or branch address, a "how to find us" /
directions block, an office location, a venue on an event page, a store locator or "nearest branch"
list — gets a **Google Maps Embed API `<iframe>`**. Reference:
https://developers.google.com/maps/documentation/embed/get-started

**This is one of the two places the router carries implementation detail itself** (the other is the
Payments provider default), because a map is not a Weegloo resource — there is no downstream Weegloo
skill to hand off to. Everything needed is in this section.

**Embed, not the Maps JavaScript API.** An embed is one `<iframe>`: no SDK, no `<script>` loader, no
map object to initialise, and nothing for a server to do — so it works unchanged on a **static
Weegloo WebHosting** deploy (`weegloo-web-hosting`) and adds **no files** to the ≤300-entry ZIP.

### The API key — use this literal value

```
AIzaSyB54VpjqEyb32wturlTzVQj_zkCmLLtJfI
```

Paste it verbatim as the `key` parameter. **Do not** emit a `YOUR_API_KEY` placeholder, **do not**
read it from an env var that a static build has no way to inject, and **do not** ask the user for
their own key. A Maps **Embed** key is **public by design** — it travels inside the iframe `src` and
is visible to every visitor — so hard-coding it into the built page is the intended usage, not a
leak.

**It is a shared key that ships with this plugin, so its quota is shared too.** Say so in one line
when you report a finished site (in **red**, per `weegloo-global-rules`), and mention that the user
can swap in their own key — or add their deployed origin to this key's HTTP-referrer restrictions in
the Google Cloud console — for production.

### Pick the mode from what the UI actually shows

Base URL: **`https://www.google.com/maps/embed/v1/{mode}?key={KEY}&{params}`**

| UI intent | `{mode}` | Required parameter |
|---|---|---|
| **one place / address on a map** (the common case) | `place` | `q=` place name, address, plus code, or `place_id:…` |
| a bare coordinate view, no pin | `view` | `center=lat,lng` |
| a directions / route block ("how to get here") | `directions` | `origin=` + `destination=` |
| "nearby X" / a category of results | `search` | `q=` search term (optionally location-restricted) |
| a street-level look at the frontage | `streetview` | `location=lat,lng` **or** `pano=` |

Every mode also accepts `zoom` (0–21), `maptype=roadmap` / `satellite`, `language`, `region`
(two-character ccTLD) and `center`. `directions` adds `waypoints` (pipe-separated, max 20),
`mode=driving` / `walking` / `bicycling` / `transit` / `flying`, `avoid=tolls` / `ferries` /
`highways`, and `units=metric` / `imperial`. `streetview` adds `heading` (-180–360), `pitch`
(-90–90), `fov` (10–100), `radius` and `source`.

**Localize the map to the site's audience** with `language=` and `region=` — e.g.
`language=ko&region=KR`, `language=ja&region=JP` — so map labels and search behaviour match what
the visitor expects. Omit both for an English/global site.

### The iframe

```html
<iframe
  src="https://www.google.com/maps/embed/v1/place?key=AIzaSyB54VpjqEyb32wturlTzVQj_zkCmLLtJfI&q=1600+Amphitheatre+Parkway%2C+Mountain+View%2C+CA&zoom=16"
  width="100%" height="360" style="border:0" loading="lazy"
  allowfullscreen referrerpolicy="strict-origin-when-cross-origin"
  title="Store location"></iframe>
```

- **URL-encode `q` / `origin` / `destination`.** Spaces become `+` or `%20`. An un-encoded non-ASCII
  address often still resolves, but encode it anyway — build the value with `encodeURIComponent`
  when the address comes from content.
- **Minimum size is 200×200 px.** Below that the map does not render at all — a compact mini-map
  card must still clear it.
- Keep `loading="lazy"` and `referrerpolicy="strict-origin-when-cross-origin"` (Google's recommended
  attributes), and give every iframe a `title` for screen readers.
- Prefer a **responsive wrapper** (`aspect-ratio`, or a `position:relative` padding box) over a fixed
  pixel height, so the map survives mobile.
- Prefer **`q=place_id:…`** when the exact business is known: an address string can resolve to a
  neighbouring pin, a place ID cannot.

### One embed shows ONE place — plan a list accordingly

The Embed API takes **no marker list** — there is no parameter for an arbitrary set of custom pins.
So for a **branch list / store locator / venue gallery**, either render **one small iframe per
card** (each with its own `q`), or use **`search` mode** when the pins genuinely are a search result
(`q=coffee+shops+in+Seattle`). Do **not** reach for the Maps **JavaScript** API for multi-marker —
that pulls an SDK, a script loader and a different quota into a static site. If the design truly
requires clustered custom markers, **say so and ask** before switching.

### Where the address comes from

If the places are content the user manages, the address belongs in a **ContentType field**, not in
hard-coded HTML: model `name` and `address` (ShortText), plus `lat` / `lng` / `placeId` when the
design needs them (`weegloo-create-content-type`), read them over CDA, and build the iframe `src` in
the browser from the field value. Hard-code an address **only** for a single fixed location that is
part of the site's chrome — a footer, a contact page.

### If the map does not render

Google renders its own error **inside** the iframe. The usual causes: the **Maps Embed API** is not
enabled on the key's project, the key's HTTP-referrer restriction does not cover the deployed origin,
or a malformed `q`. Report Google's message rather than silently dropping the map — do not swap in a
static image and call it done.

## Capability → skill quick table

| Need (plain language)        | → Concrete skill(s) to invoke                                             |
|------------------------------|--------------------------------------------------------------------------|
| Login                        | `weegloo-user-login` (admin) / `weegloo-service-login` (end-user); disambiguate via `weegloo-service-architecture` |
| Signup                       | `weegloo-service-login`                                                   |
| Social Login                 | `weegloo-service-login-client` (spine) + `weegloo-service-login-google` (Google), `weegloo-service-login-github` (GitHub), `weegloo-service-login-kakao` (Kakao), `weegloo-service-login-naver` (Naver), `weegloo-service-login-line` (LINE); Facebook/GitLab: spine's generic shape. Infer provider from product; no default; don't ask. |
| Admin / Owner / Staff UI (dashboard, settings, moderation, all-member data) | `weegloo-user-login` (in-app admin via console FE popup → CMA) |
| User Data (private/per-user) | `weegloo-service-architecture` + `weegloo-create-content-type` + `weegloo-space-role` |
| Application Data             | `weegloo-create-content-type` + `weegloo-cma-json-patch` + `weegloo-cda-publish` |
| Multi-language / i18n (a language switcher in the UI) | `weegloo-create-content-type` (`localized: true` on the per-language text fields only) + `weegloo-default-locale`. Space needs **≥2 Locales** — add one with `optional: true` and `fallbackCode` = the default's `code` (without it the second language renders blank). Never machine-translate to fill locales; read with **`?locale=<code>`**. |
| Search (over content/Media)  | decide in-memory vs server-side (loaded array ≠ dataset); full-text `fields.*` → `X-Weegloo-Advanced-Search: true` → `weegloo-api-query-optimization` + `weegloo-list-pagination` |
| File Upload (product feature)| `weegloo-upload-api` (Upload REST API → CMA/ACMA Media / WebHosting create) |
| File Download                | `weegloo-cda-publish` (Media via CDA/ACDA)                               |
| Web Hosting (deploy a site)  | `weegloo-web-hosting` (+ `weegloo-upload-api` for the build upload)      |
| Public Sharing               | `weegloo-delivery-access-token` + `weegloo-cda-publish`                  |
| Team Sharing                 | `weegloo-space-role` + `weegloo-service-login`                           |
| Role Management              | `weegloo-space-role`                                                      |
| Access Control               | `weegloo-space-role` + `weegloo-delivery-access-token`; scoped write → `weegloo-space-access-token` |
| API Connection / server-side automation | `weegloo-script` (Script; call external APIs + write results back to Content/Media) |
| Webhook (event → URL or Script) | `weegloo-webhook`                                                     |
| Scheduled / recurring job (cron — "every night", "every 15 min", daily digest, periodic sync, cleanup sweep) | `weegloo-scheduler` (Scheduler runs one Script on a five-field **UTC** cron) + `weegloo-script` for the work. Trigger decides: clock → Scheduler, content event → `weegloo-webhook`, caller → `/execute`. |
| Payment (PG or MoR — checkout, verification, provider callbacks) | `weegloo-payment`. **Never ask which provider**: one named → that one; **none named → Toss Payments on documentation test keys** (read the Toss integration guide first) — not a blocking input, then **disclose** “test keys, nothing really charged” + ask for the contracted PG/MoR. NOT Weegloo's own plan billing. |
| Send email (notify, receipt, verify, digest, contact form) | `weegloo-send-email` (register the SMTP sender first — creating one sends a real test message) + `weegloo-script` (`EmailSend`). **Never ask which vendor**: one named → that one; **none named → Google (Gmail SMTP)** — then ask for the two blocking values, an App Password from https://myaccount.google.com/apppasswords and the real Google address it belongs to, and say another SMTP is one word away. |
| Map (place, address, branch, venue, "how to find us", store locator) | **no skill — see *Maps* above**: a Google Maps Embed `<iframe>` with the key hard-coded in this skill. **Never ask for a Maps key**; not a blocking input. `place` for one address, `directions` for a route, `search` for a category; one embed = one pin. |

If a request spans multiple rows, route through all matching skills — start with
`weegloo-service-architecture` so the pieces fit one coherent architecture.

## File Storage — Upload API (product feature) vs the `weegloo-upload` MCP

These are two different things; do not confuse them. Full mechanics and the create payloads live in
**`weegloo-upload-api`** — invoke it for any file-upload work.

- **A file-upload feature inside the user's own product** → **`weegloo-upload-api`**: the
  application code calls the **Weegloo Upload REST API**, then creates the **Media** (or
  **WebHosting**) from the returned Upload id, on the plane that matches the caller's identity
  (**CMA Media** for a Weegloo User, **ACMA Media** for a Service User; never route Service-User
  media through CMA). This is the path to guide for any user-facing upload feature.
- **The `weegloo-upload` MCP server** is a tool for the **agent/LLM itself** to upload local files
  (e.g. while seeding content or deploying a WebHosting ZIP during a chat). It is **not** the
  implementation of the product's upload feature — do not wire the user's app to depend on it, and
  do not present it as the app's upload path.

## Hard rules

- **A "develop it with Weegloo" request enters here — always**, in any language. "Build this with
  Weegloo" names no feature, which makes it the **strongest** trigger for this router — not a reason
  to skip it and start coding (see *What counts as a trigger*).
- **This skill never implements** — it identifies and routes. The pointed-to skill does the work. The
  two exceptions it owns outright, because no Weegloo skill covers them: the **Payments** provider
  default and the **Maps** embed.
- **Analyze the existing frontend BEFORE routing or creating anything** (step 1). Derive features,
  required resources, ContentType fields/validations, and per-page API calls from the actual UI and
  code — and fill the inevitable gaps by reasoning about the service's intent, not by modeling only
  the literal stubs. Do not design from the user's request sentence alone — base every decision on
  the analyzed frontend (UI + code), treating that as the real spec.
- **Finish the job — done means wired-and-live, not scaffolded (see *Definition of done*).** A
  capability whose resource exists but whose feature is inert (e.g. a role created but no
  `ServiceLogin`) is **incomplete**, and a runnable static/SPA app left running only locally is
  **not deployed**: with no other host named, deploy it to Weegloo WebHosting and report the live URL.
- **Collect required inputs just-in-time, never as a closing batch.** When a step needs a
  user-only **blocking** value (OAuth `clientId`/`clientSecret`, API keys), stop and **ask for that
  one value and wait** — the capability is not done until you have it and create the resource; do not
  downgrade to "scaffolded the role, add the key later," and do not finish with a summary that hands
  the user a list of secrets to supply. **Self-resolving** values (e.g. a pre-deploy `callbackUrl`)
  you fix yourself with a placeholder — never ask the user for those.
- **Do not bypass existing gates.** Architecture → `weegloo-service-architecture`; ContentType
  design → `weegloo-create-content-type` (+ `weegloo-default-locale` for multi-locale); CDA tokens
  → `weegloo-delivery-access-token`; external-API / server-side automation → `weegloo-script`,
  event triggers → `weegloo-webhook`, clock/cron triggers → `weegloo-scheduler`; payments
  → `weegloo-payment`; WebHosting deploy → `weegloo-web-hosting`.
- **Payments: never ask which PG/MoR, and never hide the test keys.** No provider named ⇒ integrate
  **Toss Payments** with its documentation test keys (`weegloo-payment`) rather than asking or
  stalling — a PG key is *not* a blocking input. Then the completion message **must** disclose that
  nothing is really charged and ask for the contracted PG/MoR, and that provider **replaces** Toss
  when it arrives.
- **Maps: never ask for a Google Maps key.** A place/address on a map ships as a **Maps Embed
  `<iframe>`** using the key hard-coded in *Maps* above — not a placeholder, not an env var, not a
  question, and not the Maps JavaScript API. Disclose in one line that the key is shared with the
  plugin and can be swapped for the user's own.
- **Respect the two identity systems.** "Login/Signup" splits into Weegloo User (admin) vs Service
  User (end-user). Do not ask the user to choose — infer the right identity model from the request
  (and integrate both where both clearly apply), defaulting sensibly rather than prompting.
- **When unsure how a feature behaves, read the docs first** (per `weegloo-global-rules`); do not guess.

## Related

- `weegloo-service-architecture` — the primary downstream entry point (API + login + role per service type).
- `weegloo-global-rules` — global gates this router must respect.
