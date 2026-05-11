---
name: weegloo-service-login
description: Weegloo ServiceLogin (app-managed members) — per-Space self-hosted member directory separate from Weegloo accounts; ServiceUserRole + ServiceUser (roleOverride, isAdmin); Bearer Token usable ONLY against ACMA / ACDA (never CMA / CDA). Use when designing member sign-up/sign-in for a Space's own product (e.g. members-only board, paid content), wiring OAuth providers for end users, or reasoning about per-user permissions on app-owned resources.
---

# Weegloo — ServiceLogin (app-managed members)

## When to use

- A product needs **its own end-user membership** inside a **Space** — separate from the Weegloo console accounts that own the Space (e.g. a members-only board, a paid-content portal, a community where readers must sign in).
- You need a **Bearer Token** that calls **ACMA** / **ACDA** as a specific app-managed member, not as a Weegloo console user.
- Choosing between **per-member default permissions** (`sys.defaultRole`) vs **per-individual overrides** (`roleOverride`), or granting cross-member **delete** rights via `isAdmin`.

## Resource model

ServiceLogin is a **Space-scoped feature**. Three resources work together; their `sys.id`s are referenced via Weegloo's standard `Refer` shape.

| Resource | Purpose |
|----------|---------|
| **`ServiceLogin`** | The Space's per-product login configuration (e.g. enabled OAuth providers, redirect/origin settings). Holds **`sys.defaultRole`** → a `Refer` to the **`ServiceUserRole`** assigned by default to every new member. |
| **`ServiceUserRole`** | Permission rule set applied to app-managed members. Defines what those members may read/write through **ACMA** / **ACDA**. Multiple roles may exist per Space. |
| **`ServiceUser`** | One record per app-managed member of the Space (i.e. one end-user account in the product). Optional **`roleOverride`** (a `Refer` to a different **`ServiceUserRole`**) overrides `ServiceLogin.sys.defaultRole` for **that** member. Optional **`isAdmin: true`** elevates the member (see below). |

**Important:** these are **not** the same as Weegloo's built-in account model.

- **Weegloo console accounts + `SpaceRole`** → manage **the Space itself** (CMA, console FE login via **`weegloo-web-hosting-fe-login`**). DeliveryAccessToken for **CDA** also references **`SpaceRole`** (see **`weegloo-delivery-access-token`**).
- **`ServiceUser` + `ServiceUserRole`** → end-users **of the product the Space ships**. Their tokens only reach **ACMA** / **ACDA**, never the management plane.

## Sign-in flow (e.g. Google OAuth 2.0)

1. The Space enables **ServiceLogin** with one or more providers (Google, etc.) in the console.
2. The end user signs in through the configured provider in the product UI.
3. Weegloo returns a **Bearer Token** that identifies the member as the corresponding **`ServiceUser`** in that Space.
4. The product stores the token (typically in browser storage for static sites; see **`weegloo-web-hosting-fe-login`** for storage and origin-check patterns — the same browser security rules apply to this token).
5. The product calls **ACMA** / **ACDA** with **`Authorization: Bearer <token>`**.

## Token capability — ACMA / ACDA only

A Bearer Token issued by ServiceLogin **may only** be used with:

- **ACMA** (`https://acma.weegloo.com`) — app-managed members' content management.
- **ACDA** (`https://acda.weegloo.com`) — app-managed members' delivery (read).

It **must not** be used against:

- **CMA** (`https://cma.weegloo.com`) — that requires a Weegloo console session (PAT or OAuth via console FE login).
- **CDA** (`https://cda.weegloo.com`) — that requires a **DeliveryAccessToken** referencing a `SpaceRole`.

Base URLs and Accept-header rules: **`weegloo-api-endpoints`** rule.

## Permission resolution per ServiceUser

For any ACMA / ACDA request, the effective role of the calling member is resolved in this order:

1. If **`ServiceUser.roleOverride`** is set → use **that** `ServiceUserRole`.
2. Otherwise → use **`ServiceLogin.sys.defaultRole`**.

`isAdmin` is an **additional, narrow** flag on top of the resolved role; it does not replace the role. On **ACMA**, it adds **delete** of other members' resources within the role's permitted operations — nothing more. It does **not** grant cross-member **update** or **read-for-write**, and it does **not** widen ACDA's per-member read assignment.

## ACMA — what an app-managed member may do

ACMA accepts read, create, update, delete from a ServiceUser — but **scoped to that member's own data**:

- **Default behavior:** a `ServiceUser` may **only** CRUD **resources they created**. Resources created by other ServiceUsers are out of reach for update or delete — regardless of what the assigned `ServiceUserRole` permits in general.
- **Cross-member delete (`isAdmin: true`):** a ServiceUser whose **`isAdmin`** is **`true`** may **additionally delete** resources created by **other** ServiceUsers, **within** what their `ServiceUserRole` permits. This is **delete only** — `isAdmin` does **not** also grant cross-member **update** or **read-for-write**. The member keeps their full own-resource CRUD; `isAdmin` simply **adds** delete-of-others on top.
- **`isAdmin` is narrow.** Think of it as a moderation flag: *"this member may take down content posted by other members."* It does not turn the member into a content editor for others, and it does not elevate them to Weegloo console / CMA admin.

Compare to **CMA**, where a Weegloo console user with a sufficiently broad `SpaceRole` can act on every resource in the Space.

## ACDA — what an app-managed member may read

ACDA returns published resources, but restricted to **what the calling member is permitted to see**:

- Only resources **assigned to** that `ServiceUser` (per product logic and role rules) are returned.
- Per-member customization: a different `ServiceUserRole` can be assigned via **`ServiceUser.roleOverride`** so different members see different subsets — useful for tiers (free vs paid), entitlements, beta cohorts, etc.
- This differs from **CDA**, where every visitor with the **DeliveryAccessToken** sees the **same** set of published resources allowed by the token's `SpaceRole`.

Publish semantics still apply: ACDA only returns **published** snapshots — see **`weegloo-cda-publish`** skill.

## Decision aid — which login model fits

| Need | Use |
|------|-----|
| End-users sign in to the product itself and create/read app data | **ServiceLogin** + **ACMA** / **ACDA** |
| Space owner / staff edit content through a static admin UI | Weegloo console FE login → **CMA** (**`weegloo-web-hosting-fe-login`**) |
| Anyone may read public content with no sign-in | **DeliveryAccessToken** + **CDA** (**`weegloo-delivery-access-token`**) |

A product may combine all three — see **`weegloo-service-architecture`** for service-type recipes.

## Configuration responsibilities (LLM checklist)

When wiring ServiceLogin for a product:

1. Define one or more **`ServiceUserRole`**s that match the product's permission tiers (e.g. `member-reader`, `paid-member`, `moderator`). Keep them **least-privilege**.
2. Pick the **default** role and set **`ServiceLogin.sys.defaultRole`** to its `Refer`.
3. Configure the OAuth provider(s) and the product origin(s) so callbacks reach the app.
4. In product code, on successful provider sign-in, capture the **Bearer Token** and call **ACMA** / **ACDA** with it.
5. For tier upgrades or moderation, update the member's **`ServiceUser.roleOverride`** (set/clear) or **`ServiceUser.isAdmin`** — do **not** mutate `ServiceLogin.sys.defaultRole` to change one member's access.

## Security notes

- The Bearer Token represents a **specific app-managed member**. Treat it like any other user session token: short-lived where possible, scoped per device/tab, never logged in production builds.
- `ServiceUserRole`s used for **read** access must still be **least-privilege**: ACDA exposes whatever the role allows, just narrowed by per-member assignment.
- `isAdmin: true` is a sharp tool — grant only to product moderators; revoke when the role no longer applies.
- Browser storage and origin checks for the token follow the same rules as the console token in **`weegloo-web-hosting-fe-login`** (origin allowlist on `postMessage`, prefer `sessionStorage`).

## Related

- **Base URLs / Accept header / API docs:** **`weegloo-api-endpoints`** rule.
- **Picking the API combo per service type:** **`weegloo-service-architecture`** skill.
- **Weegloo console login for admin (CMA) on a static site:** **`weegloo-web-hosting-fe-login`** skill.
- **Public read tokens for CDA:** **`weegloo-delivery-access-token`** skill.
- **Published-only delivery model:** **`weegloo-cda-publish`** skill.
