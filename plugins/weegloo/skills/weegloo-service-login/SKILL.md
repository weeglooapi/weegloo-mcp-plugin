---
name: weegloo-service-login
description: Use BEFORE any general brainstorming for end-user sign-in features. ServiceLogin — the Space's own end-user sign-up/sign-in system, separate from Weegloo platform accounts. Covers ServiceLogin + ServiceUserRole + ServiceUser (roleOverride); Bearer Token for ACMA / ACDA / Upload (never CMA / CDA); current ServiceUser via ACMA GET /v1/me.
---

# Weegloo — ServiceLogin (end-user sign-up for the product)

## Where this skill sits — two login models in Weegloo

Weegloo has **two completely separate identity systems**. This skill is about model #2.

|  | **Weegloo User login** (`weegloo-user-login`) | **Service User login — this skill** |
|---|---|---|
| Who is the identity? | A **Weegloo platform account** — the human who owns or was **invited** to a Space. | An **end-user of the product** the Space ships. |
| User directory runs on… | **Weegloo**. | The **Space itself** (one ServiceLogin per Space, separate from Weegloo accounts). |
| Self sign-up? | **No** — it is a **login (authentication) feature only**, for a Weegloo User who **already** belongs to the Space; it has no registration step. (A Weegloo account is created on the Weegloo platform separately, and Space access is by ownership / invitation — not through this login.) | **Yes** — anyone may sign up via the configured OAuth provider(s). This is the whole point. |
| Perspective | **Admin / staff** of the product. | **Member / customer / reader** of the product. |
| Token grants access to… | **CMA**, **Upload**, **CDA**. | **ACMA**, **ACDA**, and **Upload**. Never CMA / CDA. Media uploads land via **Upload → ACMA** Media create. |

If you are wiring the **product owner's** admin tooling — they already have a Weegloo account on this Space — stop reading and go to **`weegloo-user-login`**. This skill is for the **end-users** the product accepts via sign-up.

## When to use

- A product needs **its own end-user membership** inside a **Space** — separate from the Weegloo platform accounts that own the Space (e.g. a members-only board, a paid-content portal, a community where readers must sign in).
- You need a **Bearer Token** that calls **ACMA** / **ACDA** as a specific app-managed member, not as a Weegloo User.
- Choosing between **per-member default permissions** (`sys.defaultRole`) vs **per-individual overrides** (`roleOverride`), or granting cross-member reach with a role that omits the `createdBy` filter.

## Tell the user the provider Redirect URI UP FRONT — before you build, and again at the end

Registering the Redirect URI is **the user's job, done by hand, in a console you cannot reach.** It is
also the single most common reason a finished ServiceLogin integration cannot sign anybody in
(`redirect_uri_mismatch` on the very first attempt). And it does **not** depend on your app being
deployed — the URI is fully determined the moment the **Space** and the **provider** are known:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/{provider}
```

Both of those are settled **before any code is written**: the Space is a `weegloo-global-rules` hard
gate, and the provider is *inferred from the product*, not asked (`weegloo-service-login-client`). So the
moment ServiceLogin enters the plan, **tell the user the URI** — with the real `spaceId` and provider
already substituted, never the `{…}` template — and name the console field it goes in.

- **It runs in parallel with your work.** The user clicks through the provider console while you
  build, instead of discovering a manual errand after you have already said "done".
- **It is a precondition, not a postscript.** The mismatch failure is entirely prevented by the user
  having pasted the right URI before the first sign-in attempt.

**Then say it again in the completion message**, next to the now-real `callbackUrl` and the live app
URL — the closing summary is the durable record the user scrolls back to. Announcing early **replaces
nothing**; it is an addition, at both ends.

**Presentation:** green, with the exact-paste caveat, per `weegloo-global-rules` → *Highlight what the
user must act on or must know*. The `+ ` is the green-rendering marker and is **not** part of the URI.

**This is not the credentials ask.** `clientId` / `clientSecret` stay **just-in-time** — requested at
the step that needs them, per `weegloo-platform-integration` step 4. You may add one sentence noting
that the same console visit will also yield them, so the user can collect everything in one trip, but
that is a heads-up: do **not** stop and wait for credentials up front, and do **not** turn this
message into a secrets checklist.

## Resource model

ServiceLogin is a **Space-scoped feature**. Three resources work together; their `sys.id`s are referenced via Weegloo's standard `Refer` shape.

| Resource | Purpose |
|----------|---------|
| **`ServiceLogin`** | The Space's per-product login configuration (e.g. enabled OAuth providers, redirect/origin settings). Holds **`sys.defaultRole`** → a `Refer` to the **`ServiceUserRole`** assigned by default to every new member. |
| **`ServiceUserRole`** | Permission rule set applied to app-managed members. Defines what those members may read/write through **ACMA** / **ACDA**. Multiple roles may exist per Space. Optional filters on **`content`**, **`contentType`**, **`media`** include **`createdBy.sys.id`** (fixed id or **`:self`** = current member). See **`weegloo-space-role`**. |
| **`ServiceUser`** | One record per app-managed member of the Space (i.e. one end-user account in the product). Optional **`roleOverride`** (a `Refer` to a different **`ServiceUserRole`**) overrides `ServiceLogin.sys.defaultRole` for **that** member. |

**Caller permission:** creating or editing any of the three requires the **`SETTING_SERVICE_LOGIN`**
action on the caller's `SpaceRole` `settings` list (**`weegloo-space-role`**) — `SETTING_APP` gates
market-app install and does **not** cover these. A **`SpaceAccessToken`** cannot manage them at all,
whatever its role — use a console session or a PAT (**`weegloo-space-access-token`**).

**Important:** these are **not** the same as Weegloo's built-in account model.

- **Weegloo platform accounts + `SpaceRole`** → manage **the Space itself** (CMA / Upload / CDA). The Weegloo User login mechanisms (PAT and console FE login popup) are documented in **`weegloo-user-login`**. DeliveryAccessToken for **CDA** also references **`SpaceRole`** (see **`weegloo-delivery-access-token`**).
- **`ServiceUser` + `ServiceUserRole`** → end-users **of the product the Space ships**. Their tokens reach **ACMA** / **ACDA** (and **Upload**, for member-contributed media — see below), never the Weegloo-side management plane (**CMA** / **CDA**).

## Sign-in flow (OAuth provider — Google, GitHub, Facebook, GitLab, LINE, Kakao, or Naver)

1. The Space enables **ServiceLogin** with one or more providers (Google, GitHub, Facebook, GitLab, LINE, Kakao, Naver) in the console.
2. The end user signs up / signs in through the configured provider in the product UI. Sign-up is open — anyone who reaches the screen can become a `ServiceUser` of this Space, subject to the provider's own checks.
3. Weegloo returns a **Bearer Token** that identifies the member as the corresponding **`ServiceUser`** in that Space.
4. The product stores the token (typically in browser storage for static sites; the same browser-security guidance — origin checks, prefer `sessionStorage` over `localStorage`, never log tokens — applies as in **`weegloo-user-login`**).
5. The product calls **ACMA** / **ACDA** with **`Authorization: Bearer <token>`**.

**Implementation:** the wire protocol on `auth.weegloo.com` (login redirect, `exchangeToken` POST exchange, refresh, logout), the official **`weegloo-service-user`** npm SDK, and the browser-specific gotchas (entry URL vs the provider redirect URI, GET-with-body limitation, `exchangeToken` URL stripping) live in the **`weegloo-service-login-client`** skill. Use that skill - and the SDK - instead of re-deriving the protocol when wiring a browser app.

### Native apps (Android / iOS)

ServiceLogin is **not browser-only** — native mobile apps can use it too. The app's own deep link (`myapp://login`, or an App Link / Universal Link) **must be registered in `ServiceLogin.allowedCallbackUrls`**; the app then starts the flow with `redirect_uri` + PKCE and is returned straight into that deep link with the one-time `exchangeToken`, which it exchanges itself. A browser app is unaffected — it keeps using `callbackUrl` and needs none of this. Full mechanism (registration, entry parameters, error returns): **`weegloo-service-login-client`** → *Native apps (Android / iOS)*.

## Token capability - ACMA / ACDA / Upload

A Bearer Token issued by ServiceLogin may be used with:

- **ACMA** (`https://acma.weegloo.com`) - app-managed members' content management.
- **ACDA** (`https://acda.weegloo.com`) - app-managed members' delivery (read).
- **Upload** (`https://upload.weegloo.com`) - file uploads as the member. Follow with an **ACMA** Media create call to attach the resulting asset (see *Member-contributed media* below). **CMA** Media create is still off-limits for this token.

It **must not** be used against:

- **CMA** (`https://cma.weegloo.com`) — that requires a **Weegloo User** session (PAT or console FE login). See **`weegloo-user-login`**. This includes **CMA Media** create / update / delete; member-uploaded media must be created via **ACMA**.
- **CDA** (`https://cda.weegloo.com`) — public delivery uses a **`DeliveryAccessToken`** referencing a `SpaceRole` (a Weegloo User token also works on CDA but is over-privileged for browser distribution — see **`weegloo-delivery-access-token`**).

## Member-contributed media — Upload → ACMA Media create

When a ServiceUser uploads a file (avatar, attachment, forum image, etc.):

1. Call **Upload** (`https://upload.weegloo.com`) with **`Authorization: Bearer <ServiceLogin token>`** to receive the upload reference for the file.
2. Call **ACMA** Media create with the same Bearer, passing that upload reference, so the Media resource is owned by the calling ServiceUser. The role's `createdBy` scope below then applies to that Media.

Do **not** create the Media via **CMA** — CMA is Weegloo-User-only and the member would need a Weegloo platform account, which is the wrong identity model. The Upload step is the only shared surface between the two identities; the Media resource itself stays partitioned (CMA Media for Weegloo Users, ACMA Media for ServiceUsers).

Base URLs and Accept-header rules: **`weegloo-api-endpoints`** rule.

## Current ServiceUser — ACMA **`GET /v1/me`**

To fetch the **`ServiceUser`** for the active ServiceLogin session (profile, `roleOverride`, etc.):

- **Correct:** **`GET https://acma.weegloo.com/v1/me`** with **`Authorization: Bearer`** and the ServiceLogin access token.

**Wrong (do not use):** **`GET https://acma.weegloo.com/v1/spaces/{spaceId}/me`**. ACMA does **not** expose the current member at a space-prefix path. **`auth.weegloo.com`** correctly uses **`/v1/spaces/{spaceId}/...`** for OAuth, which invites the mistaken pattern—but on **ACMA** the identity endpoint is **`/v1/me`** only.

## Permission resolution per ServiceUser

For any ACMA / ACDA request, the effective role of the calling member is resolved in this order:

1. If **`ServiceUser.roleOverride`** is set → use **that** `ServiceUserRole`.
2. Otherwise → use **`ServiceLogin.sys.defaultRole`**.

**The default role is what every member gets, so scope it deliberately.** `ServiceLogin.sys.defaultRole` applies to every new sign-up, and the lever that separates "a member who touches only their own rows" from "a member who touches everyone's" is the **`createdBy` filter** on the role's `content` / `media` maps: with **`createdBy.sys.id: ":self"`** a member reaches only what they created, and with the filter **left off** they reach every member's rows. Give the open-sign-up default the `:self` form, and keep any wider role out of `defaultRole` — attach it per person via **`ServiceUser.roleOverride`**. Shapes and recipes: **`weegloo-space-role`**.

That single resolved role is the whole answer — ACMA and ACDA consult nothing else.

## ACMA - what an app-managed member may do

ACMA accepts read, create, update, delete from a ServiceUser, **scoped by the effective role and by nothing else**:

- **The role is the only scope.** ACMA does not compare the caller against `sys.createdBy` by itself, so whatever the effective `ServiceUserRole` allows is exactly what the member can do.
- **Own-data members:** put **`"createdBy": { "sys": { "id": ":self" } }`** on the role's `content` / `media` map. Without it the member reaches every other member's rows for every action the role grants — update and delete included.
- **Moderators:** the same role shape **without** the `createdBy` filter, narrowed by action instead (e.g. `Read` + `Delete`), handed to that one person through **`ServiceUser.roleOverride`**. Keep it out of `defaultRole`.

Compare to **CMA**, where a Weegloo console user with a sufficiently broad `SpaceRole` can act on every resource in the Space.

## ACDA - what an app-managed member may read

ACDA returns published resources, but restricted to **what the calling member is permitted to see**:

- Only resources **assigned to** that `ServiceUser` (per product logic and role rules) are returned.
- Per-member customization: a different `ServiceUserRole` can be assigned via **`ServiceUser.roleOverride`** so different members see different subsets - useful for tiers (free vs paid), entitlements, beta cohorts, etc.
- This differs from **CDA**, where every visitor with the **DeliveryAccessToken** sees the **same** set of published resources allowed by the token's `SpaceRole`.

Publish semantics still apply: ACDA only returns **published** snapshots - see **`weegloo-cda-publish`** skill.

## Decision aid - which login model fits

| Need | Use |
|------|-----|
| End-users sign up to the product itself and create/read app data | **ServiceLogin** + **ACMA** / **ACDA** (this skill) |
| Space owner / invited staff edit content through a custom admin UI | **Weegloo User login** → **CMA** / **Upload** (**`weegloo-user-login`**) |
| Anyone may read public content with no sign-in | **DeliveryAccessToken** + **CDA** (**`weegloo-delivery-access-token`**) |

A product may combine all three - see **`weegloo-service-architecture`** for service-type recipes.

## Author of member content — set `publishWithAuthor` at modeling time

If the product will **display or filter by the author** of member content — comment/post byline, a "my posts" list, per-member **`:self`**, moderation — the ContentType needs **`publishWithAuthor: true`** (set it when you model the ContentType, before members post). Full details and the ACMA-vs-ACDA gotcha: **`weegloo-create-content-type`** → *`publishWithAuthor`*.

## Configuration responsibilities (LLM checklist)

When wiring ServiceLogin for a product:

1. Define one or more **`ServiceUserRole`**s that match the product's permission tiers (e.g. `member-reader`, `paid-member`, `moderator`). Keep them **least-privilege**. For “only this member’s rows” on a ContentType, set **`createdBy.sys.id`** to **`:self`** on the role’s **`content`** (and/or **`media`**) rules — see **`weegloo-space-role`**.
   - **⚠️ A `:self` rule needs `publishWithAuthor: true` on the ContentType to work on ACDA** — see *Author of member content* above.
2. Pick the **default** role and set **`ServiceLogin.sys.defaultRole`** to its `Refer`.
3. Configure the OAuth provider(s) and the product origin(s) so callbacks reach the app.
4. In product code, on successful provider sign-in, capture the **Bearer Token** and call **ACMA** / **ACDA** with it.
5. For tier upgrades or moderation, set or clear the member's **`ServiceUser.roleOverride`** - do **not** mutate `ServiceLogin.sys.defaultRole` to change one member's access.

## Security notes

- The Bearer Token represents a **specific app-managed member**. Treat it like any other user session token: short-lived where possible, scoped per device/tab, never logged in production builds.
- `ServiceUserRole`s used for **read** access must still be **least-privilege**: ACDA exposes whatever the role allows, just narrowed by per-member assignment.
- A role without the `createdBy` filter is a sharp tool — attach it through `roleOverride` to named moderators only, and clear the override when it no longer applies.
- Browser storage and origin checks for the token follow the same rules as the Weegloo User console token in **`weegloo-user-login`** (origin allowlist on `postMessage`, prefer `sessionStorage`).

## Related

- **Wire protocol + official browser SDK (`weegloo-service-user`):** **`weegloo-service-login-client`** skill (provider-agnostic spine).
- **Per-provider console setup (obtain `clientId`/`clientSecret`):** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE); Facebook and GitLab follow the same shape — see the spine's *Configuration responsibilities*.
- **Base URLs / Accept header / API docs:** **`weegloo-api-endpoints`** rule.
- **Picking the API combo per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — CMA, Upload, CDA):** **`weegloo-user-login`** skill.
- **Public read tokens for CDA:** **`weegloo-delivery-access-token`** skill.
- **Role permission filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Published-only delivery model:** **`weegloo-cda-publish`** skill.
