---
name: weegloo-service-login
description: Use BEFORE any general brainstorming for end-user sign-in. ServiceLogin — the Space's own end-user sign-up/sign-in, separate from Weegloo platform accounts. Covers ServiceLogin + ServiceUserRole + ServiceUser (roleOverride); its Bearer authorizes ACMA / ACDA / Upload, never CMA / CDA; current member via ACMA GET /v1/me. Also account deletion / withdrawal — a ServiceUser is deletable only in the console, so it is modelled as a request the member writes, the in-app deletion path the App Store and Play Store require. 회원가입, 소셜 로그인, 간편 로그인, 로그인 붙이기, 회원 탈퇴.
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
| Token grants access to… | **CMA**, **Upload**, **CDA**. | **ACMA**, **ACDA**, and **Upload**. Never CMA / CDA. |

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

**These are not Weegloo's built-in account model.** `SpaceRole` governs Weegloo platform accounts
managing the Space itself (CMA / Upload / CDA, plus the `DeliveryAccessToken` that fronts CDA);
`ServiceUser` + `ServiceUserRole` govern end-users of the product the Space ships. See the table at
the top of this skill for the full split.

## Sign-in flow (OAuth provider — Google, GitHub, Facebook, GitLab, LINE, Kakao, or Naver)

1. The Space enables **ServiceLogin** with one or more providers (Google, GitHub, Facebook, GitLab, LINE, Kakao, Naver) in the console.
2. The end user signs up / signs in through the configured provider in the product UI. Sign-up is open — anyone who reaches the screen can become a `ServiceUser` of this Space, subject to the provider's own checks.
3. Weegloo returns a **Bearer Token** that identifies the member as the corresponding **`ServiceUser`** in that Space.
4. The product stores the token (typically in browser storage for static sites; the same browser-security guidance — origin checks, prefer `sessionStorage` over `localStorage`, never log tokens — applies as in **`weegloo-user-login`**).
5. The product calls **ACMA** / **ACDA** with **`Authorization: Bearer <token>`**.

**Implementation:** the wire protocol on `auth.weegloo.com` (login redirect, `exchangeToken` POST exchange, refresh, logout), the official **`weegloo-service-user`** npm SDK, and the browser-specific gotchas (entry URL vs the provider redirect URI, GET-with-body limitation, `exchangeToken` URL stripping) live in the **`weegloo-service-login-client`** skill. Use that skill — and the SDK — instead of re-deriving the protocol when wiring a browser app.

**Native Android / iOS** apps use ServiceLogin too, via a deep link registered in
`ServiceLogin.allowedCallbackUrls` plus `redirect_uri` + PKCE; a browser app needs none of that.
Full mechanism: **`weegloo-service-login-client`**, which routes on to its native-app page.

## What the member's Bearer Token reaches

**ACMA** (management), **ACDA** (delivery read) and **Upload** — never **CMA** or **CDA**, which
belong to the Weegloo User identity. Base URLs, the Accept-header rule and the full token-boundary
table are in the always-loaded **`weegloo-api-endpoints`** rule.

Two consequences worth stating here:

- **Member-contributed media** (avatar, attachment, forum image) goes **Upload with the member's
  Bearer → ACMA Media create with the same Bearer**, so the Media is owned by that `ServiceUser` and
  the role's `createdBy` scope applies to it. Never CMA Media create — that would demand a Weegloo
  platform account, the wrong identity. Mechanics of the two-step call: **`weegloo-upload-api`**.
- **Current member:** **`GET https://acma.weegloo.com/v1/me`** with that Bearer. There is no
  space-prefixed `/v1/spaces/{spaceId}/me` on ACMA — that shape belongs to `auth.weegloo.com`.

## Deleting a member — console only, so model withdrawal as a request

**A `ServiceUser` can only be deleted from the Weegloo console.** The management endpoint requires a
console session and is **not exposed as an MCP tool**, so nothing the product runs — ACMA, a PAT, a
Script — can remove a member. Do not design a flow that deletes the account directly.

Model withdrawal as **a request the member files and an admin fulfils**:

1. **A ContentType for the request** — e.g. `account-deletion-request`, carrying the member's reason
   and a status the admin moves along (**`weegloo-create-content-type`**).
2. **The app writes one row through ACMA** as the signed-in `ServiceUser`, so `sys.createdBy` is that
   member. Grant the role `Create` + `Read` scoped with `createdBy.sys.id: ":self"` so members see
   only their own request — and **not** `Delete` (**`weegloo-space-role`**).
3. **The admin reviews the queue in the console** and, if it checks out, deletes the `ServiceUser`
   there.

**This is what the mobile app stores expect.** Apple and Google require an account-deletion path the
user can **start from inside the app**; neither requires the removal itself to be immediate or
automatic, so an in-app request plus manual fulfilment satisfies them. What fails review is having no
in-app path at all — or a queue nobody drains.

**Keep any record you need outside the member's own rows** — the request Content is authored by the
member, so it can be swept away with them when the account goes.

## Effective role — one role decides everything

For any ACMA / ACDA request: **`ServiceUser.roleOverride` if set, otherwise
`ServiceLogin.sys.defaultRole`.** That single resolved role is the whole answer — ACMA and ACDA
consult nothing else, and nothing is layered on top of it.

Design consequences (the mechanics of `createdBy` / `:self` / moderator overrides are in the
always-loaded **`weegloo-api-endpoints`** rule):

- **`defaultRole` is what every open sign-up gets, so it must carry `:self`.** Any wider role is
  attached per person through `roleOverride`, never made the Space default.
- **ACDA's result set is per member**, unlike CDA where every holder of the DeliveryAccessToken sees
  the same published set. That is the lever for tiers (free vs paid), entitlements and beta cohorts:
  a different `ServiceUserRole` via `roleOverride` shows a different subset. Published-only delivery
  still applies — **`weegloo-cda-publish`**.
- **Contrast with CMA**, where a Weegloo console user with a broad enough `SpaceRole` acts on every
  resource in the Space regardless of who created it.

## Decision aid — which login model fits

| Need | Use |
|------|-----|
| End-users sign up to the product itself and create/read app data | **ServiceLogin** + **ACMA** / **ACDA** (this skill) |
| Space owner / invited staff edit content through a custom admin UI | **Weegloo User login** → **CMA** / **Upload** (**`weegloo-user-login`**) |
| Anyone may read public content with no sign-in | **DeliveryAccessToken** + **CDA** (**`weegloo-delivery-access-token`**) |

A product may combine all three — see **`weegloo-service-architecture`** for service-type recipes.

## Author of member content — set `publishWithAuthor` at modeling time

If the product will **display or filter by the author** of member content — comment/post byline, a "my posts" list, per-member **`:self`**, moderation — the ContentType needs **`publishWithAuthor: true`** (set it when you model the ContentType, before members post). Full details and the ACMA-vs-ACDA gotcha: **`weegloo-create-content-type`** → *`publishWithAuthor`*.

## Configuration responsibilities (LLM checklist)

When wiring ServiceLogin for a product:

1. Define one or more **`ServiceUserRole`**s that match the product's permission tiers (e.g. `member-reader`, `paid-member`, `moderator`). Keep them **least-privilege**. For “only this member’s rows” on a ContentType, set **`createdBy.sys.id`** to **`:self`** on the role’s **`content`** (and/or **`media`**) rules — see **`weegloo-space-role`**.
   - **⚠️ A `:self` rule needs `publishWithAuthor: true` on the ContentType to work on ACDA** — see *Author of member content* above.
2. Pick the **default** role and set **`ServiceLogin.sys.defaultRole`** to its `Refer`.
3. Configure the OAuth provider(s) and the product origin(s) so callbacks reach the app.
4. In product code, on successful provider sign-in, capture the **Bearer Token** and call **ACMA** / **ACDA** with it.
5. For tier upgrades or moderation, set or clear the member's **`ServiceUser.roleOverride`** — do **not** mutate `ServiceLogin.sys.defaultRole` to change one member's access.

## Security notes

- The Bearer Token represents a **specific app-managed member**. Treat it like any other user session token: short-lived where possible, scoped per device/tab, never logged in production builds.
- `ServiceUserRole`s used for **read** access must still be **least-privilege**: ACDA exposes whatever the role allows, just narrowed by per-member assignment.
- A role without the `createdBy` filter is a sharp tool — attach it through `roleOverride` to named moderators only, and clear the override when it no longer applies.
- Browser storage and origin checks for the token follow the same rules as the Weegloo User console token in **`weegloo-user-login`** (origin allowlist on `postMessage`, prefer `sessionStorage`).

## Related

- **Wire protocol + official browser SDK (`weegloo-service-user`):** **`weegloo-service-login-client`** skill (provider-agnostic spine).
- **Per-provider console setup (obtain `clientId`/`clientSecret`):** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-facebook`** (Facebook), **`weegloo-service-login-gitlab`** (GitLab), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
- **Base URLs / Accept header / API docs:** **`weegloo-api-endpoints`** rule.
- **Picking the API combo per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — CMA, Upload, CDA):** **`weegloo-user-login`** skill.
- **Public read tokens for CDA:** **`weegloo-delivery-access-token`** skill.
- **Role permission filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Published-only delivery model:** **`weegloo-cda-publish`** skill.
