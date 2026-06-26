---
name: weegloo-platform-integration
description: ENTRY-POINT / ROUTER for Weegloo. Use as the FIRST step whenever the user asks to "integrate Weegloo", "connect Weegloo", "add Weegloo", "use Weegloo", or requests ANY capability Weegloo could provide — especially broad, vague, or ambiguous requests that do not name a specific Weegloo feature (e.g. "integrate with Weegloo", "manage my data with Weegloo"). Maps a plain-language need (login, signup, social login, user/app data, search, file upload/download, web hosting/deploy, public/team sharing, roles, access control, external API/webhook) to the correct concrete Weegloo skill so the user never has to know Weegloo's internal feature names. This skill only identifies and routes — the concrete skill it points to does the real work.
---

# Weegloo Platform Integration (capability router)

When the user asks to integrate Weegloo, or requests functionality that can be provided by
Weegloo, automatically identify the appropriate Weegloo capabilities and configure them
without requiring the user to know specific Weegloo feature names.

This skill is a **router/dispatcher**. Its job is to translate a plain-language need into the
**correct concrete skill(s)**, then hand off. It does **not** implement features itself and it
does **not** replace the existing hard gates in `weegloo-global-rules` (e.g. architecture work
must still go through `weegloo-service-architecture`).

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
     An **owner / admin / staff / dashboard / back-office** surface in the UI (e.g. a "manage
     bookings", "settings", "moderation", or full-data overview screen, including a prototype's
     `role`-switch "admin" mode) is itself a capability — an **in-app admin login** for a Weegloo
     User (`weegloo-user-login`). Recognize it and auto-integrate it like any other leaf; do **not**
     silently assume "the team will use the Weegloo Console."
   - **b. Which Weegloo resources does each feature imply?** e.g. a Google sign-in button + a
     personal "history" list → ServiceLogin + ServiceUser + a per-user-scoped ContentType; a
     "generate image from a prompt" flow that calls a third-party API → a job ContentType +
     Webhook/WriteBack; an image grid → Media + delivery.
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
       keys, etc. When you reach the step that needs one, **stop, ask for it, and wait** — the
       capability is **not done** until you have the value and have actually created the resource with
       it. Do **not** downgrade to "I set up the role; add the key later" and move on: an inert
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
  `ContentType`, `ServiceUserRole`, `:self`, `ACMA`, `DeliveryAccessToken`, `WriteBack`, resource
  `sys.id`s, status codes (404), etc. are meaningless to them. Describe outcomes in plain language
  (e.g. "the site is live at …", not "WebHosting resource reached state COMPLETED").
- **No remaining-work tables or "give me these and I'll continue" wrap-ups** (per step 4, ask for a
  needed input at the moment it blocks you — not as a closing summary).
- Surface a link/URL the user can actually use when there is one; keep everything else terse.

This brevity rule is for the integration entry point. It does **not** silence the just-in-time
questions in step 4, and it does not apply when the user explicitly asks for detail or invokes a
specific concrete skill directly.

## Available capabilities

Each leaf maps to the concrete skill that actually does the work.

- **Authentication**
  - **Login** → identity model must be determined first (Weegloo has two separate ones):
    admin/staff = `weegloo-user-login`; product end-users = `weegloo-service-login`.
    If unsure which, route to `weegloo-service-architecture` to disambiguate.
  - **Signup** (open end-user sign-up) → `weegloo-service-login`
  - **Social Login** (OAuth providers — Google / GitHub / Facebook; browser SDK / wire protocol) →
    `weegloo-service-login-sdk` (provider-agnostic spine) + the chosen provider's setup skill
    `weegloo-service-login-<provider>` (e.g. `weegloo-service-login-google`). Pick the provider from
    the product's need; never assume Google.
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
    `weegloo-delivery-access-token`
- **External Service Integration**
  - **API Connection** (call third-party APIs without a backend) → `weegloo-webhook-writeback`
  - **Webhook** → `weegloo-webhook-writeback`

## Capability → skill quick table

| Need (plain language)        | → Concrete skill(s) to invoke                                             |
|------------------------------|--------------------------------------------------------------------------|
| Login                        | `weegloo-user-login` (admin) / `weegloo-service-login` (end-user); disambiguate via `weegloo-service-architecture` |
| Signup                       | `weegloo-service-login`                                                   |
| Social Login                 | `weegloo-service-login-sdk` (spine) + `weegloo-service-login-<provider>` (e.g. `-google`) |
| Admin / Owner / Staff UI (dashboard, settings, moderation, all-member data) | `weegloo-user-login` (in-app admin via console FE popup → CMA) |
| User Data (private/per-user) | `weegloo-service-architecture` + `weegloo-create-content-type` + `weegloo-space-role` |
| Application Data             | `weegloo-create-content-type` + `weegloo-cma-json-patch` + `weegloo-cda-publish` |
| Search (over content/Media)  | decide in-memory vs server-side (loaded array ≠ dataset); full-text `fields.*` → `X-Weegloo-Advanced-Search: true` → `weegloo-api-query-optimization` + `weegloo-list-pagination` |
| File Upload (product feature)| `weegloo-upload-api` (Upload REST API → CMA/ACMA Media / WebHosting create) |
| File Download                | `weegloo-cda-publish` (Media via CDA/ACDA)                               |
| Web Hosting (deploy a site)  | `weegloo-web-hosting` (+ `weegloo-upload-api` for the build upload)      |
| Public Sharing               | `weegloo-delivery-access-token` + `weegloo-cda-publish`                  |
| Team Sharing                 | `weegloo-space-role` + `weegloo-service-login`                           |
| Role Management              | `weegloo-space-role`                                                      |
| Access Control               | `weegloo-space-role` + `weegloo-delivery-access-token`                   |
| API Connection / Webhook     | `weegloo-webhook-writeback`                                              |

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

- **This skill never implements** — it identifies and routes. The pointed-to skill does the work.
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
  → `weegloo-delivery-access-token`; external-API jobs → `weegloo-webhook-writeback`; WebHosting
  deploy → `weegloo-web-hosting`.
- **Respect the two identity systems.** "Login/Signup" splits into Weegloo User (admin) vs Service
  User (end-user). Do not ask the user to choose — infer the right identity model from the request
  (and integrate both where both clearly apply), defaulting sensibly rather than prompting.
- **When unsure how a feature behaves, read the docs first** (per `weegloo-global-rules`); do not guess.

## Related

- `weegloo-service-architecture` — the primary downstream entry point (API + login + role per service type).
- `weegloo-global-rules` — global gates this router must respect.
