---
name: weegloo-service-architecture
description: Picks the right Weegloo API + login + role combination for a product based on service type — public site, public site with admin editing, members-only read, members read/write, and composite layouts. Use when planning a new app on Weegloo, deciding between CMA/CDA vs ACMA/ACDA, sizing DeliveryAccessToken vs ServiceLogin, or auditing an existing architecture.
---

# Weegloo — service architecture (API + login per service type)

## When to use

- Starting a new product on Weegloo and deciding which APIs to call from the **client** and (if any) from an **admin** path.
- Reviewing an existing app to confirm it uses the **right combination** of APIs, tokens, and roles for its access model.
- Disambiguating **CDA vs ACDA**, **CMA vs ACMA**, and when **ServiceLogin** is — or is not — required.

Base URLs, Accept headers, and OpenAPI links live in **`weegloo-api-endpoints`** (do not duplicate URLs here).

## Mental model (one sentence per API)

- **CMA** — full CRUD as a **Weegloo console** user. Bearer from console login (or a Personal Access Token).
- **CDA** — public, cache-friendly **reads** of **published** resources. Requires a **DeliveryAccessToken** bound to a `SpaceRole`.
- **ACMA** — CRUD as an **app-managed member** (`ServiceUser`); scoped to **the member's own** resources. Requires a **Bearer Token from ServiceLogin**.
- **ACDA** — **reads** for an app-managed member; scoped to **resources assigned to that member**, customizable per-member via `ServiceUser.roleOverride`. Requires a **Bearer Token from ServiceLogin**.

Detailed semantics:

- **ServiceLogin / ServiceUser / ServiceUserRole / `isAdmin`:** **`weegloo-service-login`** skill.
- **Console-FE login for the admin path:** **`weegloo-web-hosting-fe-login`** skill.
- **Delivery token provisioning:** **`weegloo-delivery-access-token`** skill.
- **Publish model (write → publish → readable on CDA / ACDA):** **`weegloo-cda-publish`** skill.

## Recipes by service type

Pick the row that matches the product. Each recipe lists the **client-side** APIs and the **roles/tokens** to provision.

### 1. Fully public service (read-only site)

> "Marketing site, public blog index, public catalog — every visitor sees the same content."

- **Client reads:** **CDA**.
- **Token:** one **DeliveryAccessToken** bound to a **least-privilege `SpaceRole`** for the relevant published `ContentType`s. Ship it in `env.js` (`DELIVERY_ACCESS_TOKEN`).
- **Writes:** done in the **Weegloo console** by the team — **no** client-side write path.
- **ServiceLogin:** **not required**.

Pitfalls: don't bind the token to **Administrator** or any write-capable role — see **`weegloo-delivery-access-token`**.

### 2. Public service with an admin editing page

> "Public blog readable to anyone; the team logs in to a static admin UI on the same domain (or a sibling) to publish posts."

- **Public read path (any visitor):** **CDA** with a DeliveryAccessToken (as in recipe 1).
- **Admin path (Space staff only):** sign in via the **Weegloo console FE login popup** (origin-checked `postMessage` → token in `sessionStorage`); call **CMA** for create/update/publish. Pattern: **`weegloo-web-hosting-fe-login`**.
- **ServiceLogin:** **not required** — admins are Weegloo console users on this Space, not app-managed members.
- **Roles:**
  - **`SpaceRole`** for the DeliveryAccessToken (read-only, scoped to the published `ContentType`s).
  - The admin's effective rights come from their **Space membership** (per **`weegloo-global-rules`** / **`weegloo-web-hosting-fe-login`** Space-membership check).

### 3. Members-only **read** service

> "Paid newsletter, course library, members-only article archive — visitors must sign in to see content."

- **Sign-in:** **ServiceLogin** (e.g. Google OAuth).
- **Client reads:** **ACDA** with the member's **Bearer Token**. Each member sees only what their `ServiceUserRole` (and any per-member assignment) allows.
- **Writes:** done in the **Weegloo console** by the team (no client write path).
- **ServiceLogin config:**
  - One or more **`ServiceUserRole`**s for the tiers (e.g. `member-reader`, `paid-member`).
  - **`ServiceLogin.sys.defaultRole`** → the **least-privilege** member role.
  - Use **`ServiceUser.roleOverride`** to upgrade individual members (paid, beta, etc.).

### 4. Members **read + write** service

> "Members-only forum or board where members write posts, edit their own, and read each other's."

- **Sign-in:** **ServiceLogin**.
- **Member writes:** **ACMA** — each `ServiceUser` may CRUD **their own** resources only. Promote moderators with **`ServiceUser.isAdmin: true`** so they can also **delete** other members' posts within their role's scope. `isAdmin` is **delete-only** for others' resources; it does not grant cross-member update or read. See **`weegloo-service-login`**.
- **Member reads:** **ACDA** for resources scoped to the member.
- **Mixed-visibility resources:**
  - For content that **everyone** (members and non-members) may read, expose it via **CDA** with a **DeliveryAccessToken** — same constraints as recipe 1.
- **Required role configuration:**
  - **`SpaceRole`** for the **DeliveryAccessToken** (read-only, scoped) — for any CDA path.
  - **`ServiceUserRole`** for the default member, plus overrides for tiered/moderator members — for ACMA / ACDA.
- **Anti-pattern:** do **not** route member writes through CMA from the browser; CMA writes from clients require a Weegloo **console** session, not a member token.

### 5. Composite / multi-tier service

> "Public landing pages and catalog, plus a logged-in member area with personal content and writeable posts, plus a small admin surface."

Combine recipes — every path uses the API that matches the **caller's identity** for that path:

- **Anonymous visitor reads (public pages):** **CDA** + DeliveryAccessToken with a **public, read-only `SpaceRole`**.
- **App-managed member reads (private/personal content):** **ACDA** with **ServiceLogin** Bearer Token.
- **App-managed member writes (their own resources):** **ACMA** with the same ServiceLogin Bearer Token.
- **Team / staff editing (any resource in the Space):** Weegloo **console FE login** → **CMA**.
- **Role budget (must be configured):**
  - **`SpaceRole`** (least-privilege) for the **DeliveryAccessToken** used by CDA.
  - **`ServiceUserRole`** (least-privilege) for app-managed members used by ACMA / ACDA, with per-member overrides as needed.

## Selection cheatsheet

```
┌────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ Caller / situation                         │ API + auth                                  │
├────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ Anonymous visitor reading published data   │ CDA   + DeliveryAccessToken (SpaceRole)     │
│ App-managed member reading their data      │ ACDA  + ServiceLogin Bearer Token            │
│ App-managed member writing their data      │ ACMA  + ServiceLogin Bearer Token            │
│ Member moderator deleting others' data     │ ACMA  + ServiceUser.isAdmin = true (delete)  │
│ Team staff editing any resource (admin UI) │ CMA   + console FE login token (Space mbr.)  │
│ Backend / CI / scripts (developer)         │ CMA   + Personal Access Token (server only)  │
└────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

## Anti-patterns to refuse

- **Calling CMA from a browser that does not have a Weegloo console session.** A member's ServiceLogin Bearer Token does **not** authorize CMA — use ACMA. Console login from a static admin UI is **`weegloo-web-hosting-fe-login`**.
- **Reusing one DeliveryAccessToken for member-private reads.** CDA tokens are public; never bind them to anything more than the least-privilege public read scope. Use **ACDA** for per-member content.
- **Granting Administrator (or any broad write) on a CDA DeliveryAccessToken** — strictly forbidden per **`weegloo-delivery-access-token`**.
- **Routing member writes through CMA + console login.** That makes every writing member a Weegloo console user on the Space — the wrong identity model. Use ACMA via ServiceLogin.
- **Treating `isAdmin` as Weegloo-admin.** It only adds **delete** of other members' resources on ACMA — within what the `ServiceUserRole` already permits. It never elevates the member to manage the Space itself.
- **Treating `isAdmin` as cross-member edit/read.** `isAdmin` does **not** grant **update** or **read-for-write** on other members' resources — only **delete**. For full cross-member editing, use a Weegloo console user via CMA, not ACMA + `isAdmin`.

## LLM checklist

When planning an architecture, answer these in order:

1. **Anonymous read?** → CDA + DeliveryAccessToken with a least-privilege `SpaceRole`.
2. **Team admin editing through the product UI?** → Weegloo console FE login → CMA.
3. **Per-end-user accounts in the product itself?** → enable **ServiceLogin**, define `ServiceUserRole`(s), set `ServiceLogin.sys.defaultRole`.
4. **End-user writes?** → ACMA with Bearer Token. Moderators get `isAdmin: true` so they may additionally **delete** other members' resources within the role's scope (delete only — no cross-member update/read).
5. **End-user reads of personal/assigned content?** → ACDA with the same Bearer Token.

If the product covers more than one row, ship all matching paths — they coexist (recipe 5).

## Related

- **`weegloo-api-endpoints`** — base URLs, Accept header, vendor JSON, OpenAPI links, ACMA/ACDA ownership invariants.
- **`weegloo-service-login`** — ServiceLogin / ServiceUser / ServiceUserRole / `isAdmin` mechanics and Bearer Token scope.
- **`weegloo-web-hosting-fe-login`** — Weegloo console FE login popup → CMA on static sites.
- **`weegloo-delivery-access-token`** — least-privilege DeliveryAccessToken creation for CDA.
- **`weegloo-cda-publish`** — publish model that gates what CDA / ACDA actually return.
