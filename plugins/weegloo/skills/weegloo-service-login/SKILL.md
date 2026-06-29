---
name: weegloo-service-login
description: Use BEFORE any general brainstorming for end-user sign-in features. ServiceLogin — the Space's own end-user sign-up/sign-in system, separate from Weegloo platform accounts. Covers ServiceLogin + ServiceUserRole + ServiceUser (roleOverride, isAdmin); Bearer Token for ACMA / ACDA / Upload (never CMA / CDA); current ServiceUser via ACMA GET /v1/me.
---

# Weegloo — ServiceLogin (end-user sign-up for the product)

## Where this skill sits — two login models in Weegloo

Weegloo has **two completely separate identity systems**. This skill is about model #2.

|  | **Weegloo User login** (`weegloo-user-login`) | **Service User login — this skill** |
|---|---|---|
| Who is the identity? | A **Weegloo platform account** — the human who owns or was **invited** to a Space. | An **end-user of the product** the Space ships. |
| User directory runs on… | **Weegloo**. | The **Space itself** (one ServiceLogin per Space, separate from Weegloo accounts). |
| Self sign-up? | **No** — invitation only; not for the general public. | **Yes** — anyone may sign up via the configured OAuth provider(s). This is the whole point. |
| Perspective | **Admin / staff** of the product. | **Member / customer / reader** of the product. |
| Token grants access to… | **CMA**, **Upload**, **CDA**. | **ACMA**, **ACDA**, and **Upload**. Never CMA / CDA. Media uploads land via **Upload → ACMA** Media create. |

If you are wiring the **product owner's** admin tooling — they already have a Weegloo account on this Space — stop reading and go to **`weegloo-user-login`**. This skill is for the **end-users** the product accepts via sign-up.

## When to use

- A product needs **its own end-user membership** inside a **Space** — separate from the Weegloo platform accounts that own the Space (e.g. a members-only board, a paid-content portal, a community where readers must sign in).
- You need a **Bearer Token** that calls **ACMA** / **ACDA** as a specific app-managed member, not as a Weegloo User.
- Choosing between **per-member default permissions** (`sys.defaultRole`) vs **per-individual overrides** (`roleOverride`), or granting cross-member **delete** rights via `isAdmin`.

## Resource model

ServiceLogin is a **Space-scoped feature**. Three resources work together; their `sys.id`s are referenced via Weegloo's standard `Refer` shape.

| Resource | Purpose |
|----------|---------|
| **`ServiceLogin`** | The Space's per-product login configuration (e.g. enabled OAuth providers, redirect/origin settings). Holds **`sys.defaultRole`** → a `Refer` to the **`ServiceUserRole`** assigned by default to every new member. |
| **`ServiceUserRole`** | Permission rule set applied to app-managed members. Defines what those members may read/write through **ACMA** / **ACDA**. Multiple roles may exist per Space. Optional filters on **`content`**, **`contentType`**, **`media`** include **`createdBy.sys.id`** (fixed id or **`:self`** = current member). See **`weegloo-space-role`**. |
| **`ServiceUser`** | One record per app-managed member of the Space (i.e. one end-user account in the product). Optional **`roleOverride`** (a `Refer` to a different **`ServiceUserRole`**) overrides `ServiceLogin.sys.defaultRole` for **that** member. Optional **`isAdmin: true`** elevates the member (see below). |

**Important:** these are **not** the same as Weegloo's built-in account model.

- **Weegloo platform accounts + `SpaceRole`** → manage **the Space itself** (CMA / Upload / CDA). The Weegloo User login mechanisms (PAT and console FE login popup) are documented in **`weegloo-user-login`**. DeliveryAccessToken for **CDA** also references **`SpaceRole`** (see **`weegloo-delivery-access-token`**).
- **`ServiceUser` + `ServiceUserRole`** → end-users **of the product the Space ships**. Their tokens reach **ACMA** / **ACDA** (and **Upload**, for member-contributed media — see below), never the Weegloo-side management plane (**CMA** / **CDA**).

## Sign-in flow (OAuth provider — Google, GitHub, or Facebook)

1. The Space enables **ServiceLogin** with one or more providers (Google, GitHub, Facebook) in the console.
2. The end user signs up / signs in through the configured provider in the product UI. Sign-up is open — anyone who reaches the screen can become a `ServiceUser` of this Space, subject to the provider's own checks.
3. Weegloo returns a **Bearer Token** that identifies the member as the corresponding **`ServiceUser`** in that Space.
4. The product stores the token (typically in browser storage for static sites; the same browser-security guidance — origin checks, prefer `sessionStorage` over `localStorage`, never log tokens — applies as in **`weegloo-user-login`**).
5. The product calls **ACMA** / **ACDA** with **`Authorization: Bearer <token>`**.

**Implementation:** the wire protocol on `auth.weegloo.com` (login redirect, `exchangeToken` POST exchange, refresh, logout), the official **`weegloo-service-user`** npm SDK, and the browser-specific gotchas (entry URL vs the provider redirect URI, GET-with-body limitation, `exchangeToken` URL stripping) live in the **`weegloo-service-login-sdk`** skill. Use that skill - and the SDK - instead of re-deriving the protocol when wiring a browser app.

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
2. Call **ACMA** Media create with the same Bearer, passing that upload reference, so the Media resource is owned by the calling ServiceUser. The own-resource CRUD and `isAdmin` rules below then apply to that Media.

Do **not** create the Media via **CMA** — CMA is Weegloo-User-only and the member would need a Weegloo platform account, which is the wrong identity model. The Upload step is the only shared surface between the two identities; the Media resource itself stays partitioned (CMA Media for Weegloo Users, ACMA Media for ServiceUsers).

Base URLs and Accept-header rules: **`weegloo-api-endpoints`** rule.

## Current ServiceUser — ACMA **`GET /v1/me`**

To fetch the **`ServiceUser`** for the active ServiceLogin session (profile, `roleOverride`, `isAdmin`, etc.):

- **Correct:** **`GET https://acma.weegloo.com/v1/me`** with **`Authorization: Bearer`** and the ServiceLogin access token.

**Wrong (do not use):** **`GET https://acma.weegloo.com/v1/spaces/{spaceId}/me`**. ACMA does **not** expose the current member at a space-prefix path. **`auth.weegloo.com`** correctly uses **`/v1/spaces/{spaceId}/...`** for OAuth, which invites the mistaken pattern—but on **ACMA** the identity endpoint is **`/v1/me`** only.

## Permission resolution per ServiceUser

For any ACMA / ACDA request, the effective role of the calling member is resolved in this order:

1. If **`ServiceUser.roleOverride`** is set → use **that** `ServiceUserRole`.
2. Otherwise → use **`ServiceLogin.sys.defaultRole`**.

`isAdmin` is an **additional, narrow** flag on top of the resolved role; it does not replace the role. On **ACMA**, it adds **delete** of other members' resources within the role's permitted operations - nothing more. It does **not** grant cross-member **update** or **read-for-write**, and it does **not** widen ACDA's per-member read assignment.

## ACMA - what an app-managed member may do

ACMA accepts read, create, update, delete from a ServiceUser - but **scoped to that member's own data**:

- **Default behavior:** a `ServiceUser` may **only** CRUD **resources they created**. Resources created by other ServiceUsers are out of reach for update or delete - regardless of what the assigned `ServiceUserRole` permits in general.
- **Cross-member delete (`isAdmin: true`):** a ServiceUser whose **`isAdmin`** is **`true`** may **additionally delete** resources created by **other** ServiceUsers, **within** what their `ServiceUserRole` permits. This is **delete only** - `isAdmin` does **not** also grant cross-member **update** or **read-for-write**. The member keeps their full own-resource CRUD; `isAdmin` simply **adds** delete-of-others on top.
- **`isAdmin` is narrow.** Think of it as a moderation flag: *"this member may take down content posted by other members."* It does not turn the member into a content editor for others, and it does not elevate them to Weegloo console / CMA admin.

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

## Configuration responsibilities (LLM checklist)

When wiring ServiceLogin for a product:

1. Define one or more **`ServiceUserRole`**s that match the product's permission tiers (e.g. `member-reader`, `paid-member`, `moderator`). Keep them **least-privilege**. For “only this member’s rows” on a ContentType, set **`createdBy.sys.id`** to **`:self`** on the role’s **`content`** (and/or **`media`**) rules — see **`weegloo-space-role`**.
2. Pick the **default** role and set **`ServiceLogin.sys.defaultRole`** to its `Refer`.
3. Configure the OAuth provider(s) and the product origin(s) so callbacks reach the app.
4. In product code, on successful provider sign-in, capture the **Bearer Token** and call **ACMA** / **ACDA** with it.
5. For tier upgrades or moderation, update the member's **`ServiceUser.roleOverride`** (set/clear) or **`ServiceUser.isAdmin`** - do **not** mutate `ServiceLogin.sys.defaultRole` to change one member's access.

## Security notes

- The Bearer Token represents a **specific app-managed member**. Treat it like any other user session token: short-lived where possible, scoped per device/tab, never logged in production builds.
- `ServiceUserRole`s used for **read** access must still be **least-privilege**: ACDA exposes whatever the role allows, just narrowed by per-member assignment.
- `isAdmin: true` is a sharp tool — grant only to product moderators; revoke when the role no longer applies.
- Browser storage and origin checks for the token follow the same rules as the Weegloo User console token in **`weegloo-user-login`** (origin allowlist on `postMessage`, prefer `sessionStorage`).

## Related

- **Wire protocol + official browser SDK (`weegloo-service-user`):** **`weegloo-service-login-sdk`** skill (provider-agnostic spine).
- **Per-provider console setup (obtain `clientId`/`clientSecret`):** **`weegloo-service-login-google`** (Google; GitHub/Facebook follow the same shape — see the spine's *Configuration responsibilities*).
- **Base URLs / Accept header / API docs:** **`weegloo-api-endpoints`** rule.
- **Picking the API combo per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo User login (admin / platform account — CMA, Upload, CDA):** **`weegloo-user-login`** skill.
- **Public read tokens for CDA:** **`weegloo-delivery-access-token`** skill.
- **Role permission filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
- **Published-only delivery model:** **`weegloo-cda-publish`** skill.
