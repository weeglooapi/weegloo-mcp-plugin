---
name: weegloo-service-architecture
description: Picks the right Weegloo API + login + role combination for a product based on service type - public site, public site with admin editing, members-only read, members read/write, and composite layouts. Use when planning a new app on Weegloo, deciding between CMA/CDA vs ACMA/ACDA, sizing DeliveryAccessToken vs ServiceLogin, or auditing an existing architecture.
---

# Weegloo - service architecture (API + login per service type)

## When to use

- Starting a new product on Weegloo and deciding which APIs to call from the **client** and (if any) from an **admin** path.
- Reviewing an existing app to confirm it uses the **right combination** of APIs, tokens, and roles for its access model.
- Disambiguating **CDA vs ACDA**, **CMA vs ACMA**, and when **ServiceLogin** is - or is not - required.

Base URLs, Accept headers, and OpenAPI links live in **`weegloo-api-endpoints`** (do not duplicate URLs here).

## Two login models (read first)

Every API choice below depends on **which of the two Weegloo identities** is calling.

- **Weegloo User** — a Weegloo platform account; Space owner or **invited** staff; **no self-signup**. Token (PAT or console FE login) hits **CMA / Upload / CDA**. Details: **`weegloo-user-login`** skill.
- **Service User** — an end-user of the product the Space ships; **anyone may sign up** through a ServiceLogin OAuth provider. Token (issued via `auth.weegloo.com`) hits **ACMA / ACDA**, plus **Upload** for member-contributed media (followed by **ACMA** Media create — never CMA Media). Details: **`weegloo-service-login`** skill.

These identity systems are **completely separate**: a Service User is **not** a Weegloo platform account and cannot reach **CMA / CDA**; a Weegloo User is **not** a Service User of the product and is not the right identity for end-user features. **Upload** is the one shared surface — both Bearers are accepted there; the follow-up Media create stays on the matching plane (CMA for Weegloo Users, ACMA for Service Users).

## Mental model (one sentence per API)

- **CMA** — full CRUD as a **Weegloo User**. Bearer from console FE login (or a Personal Access Token).
- **Upload** — file uploads. Accepts both a **Weegloo User** Bearer (followed by **CMA** Media create) and a **Service User** Bearer (followed by **ACMA** Media create). Same upload endpoint, two follow-up planes that match the caller's identity.
- **CDA** — public, cache-friendly **reads** of **published** resources. Production sites use a **DeliveryAccessToken** bound to a least-privilege `SpaceRole`; a Weegloo User Bearer also authorizes CDA but is over-privileged for browser distribution.
- **ACMA** — CRUD as a **Service User**; scoped to **the member's own** resources. Requires a **Bearer Token from ServiceLogin**.
- **ACDA** — **reads** for a Service User; scoped to **resources assigned to that member**, customizable per-member via `ServiceUser.roleOverride`. Requires a **Bearer Token from ServiceLogin**.

Detailed semantics:

- **Weegloo User login (PAT + console FE login popup):** **`weegloo-user-login`** skill.
- **ServiceLogin / ServiceUser / ServiceUserRole / `isAdmin`:** **`weegloo-service-login`** skill.
- **Delivery token provisioning:** **`weegloo-delivery-access-token`** skill.
- **Publish model (write → publish → readable on CDA / ACDA):** **`weegloo-cda-publish`** skill.

## Recipes by service type

Pick the row that matches the product. Each recipe lists the **client-side** APIs and the **roles/tokens** to provision.

### 1. Fully public service (read-only site)

> "Marketing site, public blog index, public catalog - every visitor sees the same content."

- **Client reads:** **CDA**.
- **Token:** one **DeliveryAccessToken** bound to a **least-privilege `SpaceRole`** for the relevant published `ContentType`s. Expose it to the browser per your build or client config (e.g. `NEXT_PUBLIC_WEEGLOO_DELIVERY_ACCESS_TOKEN`); document the pattern in the project README.
- **Writes:** done in the **Weegloo console** by the team — **no** client-side write path.
- **ServiceLogin:** **not required**.

Pitfalls: don't bind the token to **Administrator** or any write-capable role - see **`weegloo-delivery-access-token`**.

### 2. Public service with an admin editing page

> "Public blog readable to anyone; the team logs in to a custom admin UI on the same domain (or a sibling) to publish posts."

- **Public read path (any visitor):** **CDA** with a DeliveryAccessToken (as in recipe 1).
- **Admin path (Weegloo Users only):** sign in as a **Weegloo User** via the **console FE login popup** (origin-checked `postMessage` → token in `sessionStorage`); call **CMA** / **Upload** for create/update/publish. Pattern: **`weegloo-user-login`**.
- **ServiceLogin:** **not required** — admins are **Weegloo Users** on this Space, not Service Users.
- **Roles:**
  - **`SpaceRole`** for the DeliveryAccessToken (read-only, scoped to the published `ContentType`s).
  - The admin's effective rights come from their **Space membership** (per **`weegloo-global-rules`** / **`weegloo-user-login`** Space-membership check).

### 3. Members-only **read** service

> "Paid newsletter, course library, members-only article archive - visitors must sign in to see content."

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
- **Member writes:** **ACMA** - each `ServiceUser` may CRUD **their own** resources only. Promote moderators with **`ServiceUser.isAdmin: true`** so they can also **delete** other members' posts within their role's scope. `isAdmin` is **delete-only** for others' resources; it does not grant cross-member update or read. See **`weegloo-service-login`**.
- **Member media uploads:** **Upload** with the ServiceLogin Bearer, then **ACMA** Media create with the same Bearer (the Media is owned by that ServiceUser). Do **not** route member media through CMA Media — that is Weegloo-User-only.
- **Member reads:** **ACDA** for resources scoped to the member.
- **Mixed-visibility resources:**
  - For content that **everyone** (members and non-members) may read, expose it via **CDA** with a **DeliveryAccessToken** - same constraints as recipe 1.
- **Required role configuration:**
  - **`SpaceRole`** for the **DeliveryAccessToken** (read-only, scoped) - for any CDA path.
  - **`ServiceUserRole`** for the default member, plus overrides for tiered/moderator members - for ACMA / ACDA.
- **Anti-pattern:** do **not** route member writes through CMA from the browser; CMA writes from clients require a Weegloo **console** session, not a member token.

### 5. Composite / multi-tier service

> "Public landing pages and catalog, plus a logged-in member area with personal content and writeable posts, plus a small admin surface."

Combine recipes - every path uses the API that matches the **caller's identity** for that path:

- **Anonymous visitor reads (public pages):** **CDA** + DeliveryAccessToken with a **public, read-only `SpaceRole`**.
- **Service User reads (private/personal content):** **ACDA** with **ServiceLogin** Bearer Token.
- **Service User writes (their own resources):** **ACMA** with the same ServiceLogin Bearer Token.
- **Weegloo User / staff editing (any resource in the Space):** **Weegloo User login** → **CMA** / **Upload** (**`weegloo-user-login`**).
- **Role budget (must be configured):**
  - **`SpaceRole`** (least-privilege) for the **DeliveryAccessToken** used by CDA.
  - **`ServiceUserRole`** (least-privilege) for app-managed members used by ACMA / ACDA, with per-member overrides as needed.

## Selection cheatsheet

```
┌─────────────────────────────────────────────┬───────────────────────────────────────────────┐
│ Caller / situation                          │ API + auth                                    │
├─────────────────────────────────────────────┼───────────────────────────────────────────────┤
│ Anonymous visitor reading published data    │ CDA   + DeliveryAccessToken (SpaceRole)       │
│ Service User reading their data             │ ACDA  + ServiceLogin Bearer Token             │
│ Service User writing their data             │ ACMA  + ServiceLogin Bearer Token             │
│ Service User uploading Media (member-owned) │ Upload + ServiceLogin Bearer → ACMA Media     │
│ Service User moderator deleting others'     │ ACMA  + ServiceUser.isAdmin = true (delete)   │
│ Weegloo User editing in a custom admin UI   │ CMA   + console FE login token (Space mbr.)   │
│ Weegloo User uploading Media (admin UI)     │ Upload + Weegloo User Bearer → CMA Media      │
│ Backend / CI / scripts (developer)          │ CMA   + Personal Access Token (server only)   │
└─────────────────────────────────────────────┴───────────────────────────────────────────────┘
```

## Anti-patterns to refuse

- **Calling CMA from a browser that does not have a Weegloo User session.** A Service User's ServiceLogin Bearer Token does **not** authorize CMA — use ACMA. The Weegloo User login flow for static admin UIs is **`weegloo-user-login`**.
- **Putting a Personal Access Token in client-side code.** PATs are Weegloo User credentials meant for servers, CI, and developer scripts. For browser admin UIs, use the console FE login popup (Mechanism B in **`weegloo-user-login`**).
- **Reusing one DeliveryAccessToken for member-private reads.** CDA tokens are public; never bind them to anything more than the least-privilege public read scope. Use **ACDA** for per-member content.
- **Granting Administrator (or any broad write) on a CDA DeliveryAccessToken** — strictly forbidden per **`weegloo-delivery-access-token`**.
- **Letting end-users sign up as Weegloo Users.** Weegloo platform accounts are invitation-only Space members; end-user sign-up belongs to **ServiceLogin**. If you find yourself inviting every product user to the Space, you are using the wrong identity model.
- **Routing Service User writes through CMA + Weegloo User login.** That makes every writing member a Weegloo platform account on the Space — the wrong identity model. Use ACMA via ServiceLogin. (Member-contributed media is the same story: **Upload → ACMA** Media create with the ServiceLogin Bearer, never CMA Media.)
- **Treating `isAdmin` as Weegloo-admin.** It only adds **delete** of other members' resources on ACMA — within what the `ServiceUserRole` already permits. It never elevates the member to manage the Space itself.
- **Treating `isAdmin` as cross-member edit/read.** `isAdmin` does **not** grant **update** or **read-for-write** on other members' resources — only **delete**. For full cross-member editing, use a Weegloo User via CMA, not ACMA + `isAdmin`.

## LLM checklist

When planning an architecture, answer these in order:

1. **Anonymous read?** → CDA + DeliveryAccessToken with a least-privilege `SpaceRole`.
2. **Weegloo Users (invited staff) editing through a custom admin UI?** → Weegloo User login (console FE popup) → CMA / Upload. See **`weegloo-user-login`**.
3. **Per-end-user accounts in the product itself (open sign-up)?** → enable **ServiceLogin**, define `ServiceUserRole`(s), set `ServiceLogin.sys.defaultRole`. See **`weegloo-service-login`**.
4. **Service User writes?** → ACMA with Bearer Token. Moderators get `isAdmin: true` so they may additionally **delete** other members' resources within the role's scope (delete only — no cross-member update/read).
5. **Service User reads of personal/assigned content?** → ACDA with the same Bearer Token.
6. **Service User uploads media (avatar, attachment, etc.)?** → **Upload** with the ServiceLogin Bearer, then **ACMA** Media create with the same Bearer. Never route member media through CMA.

If the product covers more than one row, ship all matching paths - they coexist (recipe 5).

## Related

- **`weegloo-api-endpoints`** — base URLs, Accept header, vendor JSON, OpenAPI links, ACMA/ACDA ownership invariants.
- **`weegloo-user-login`** — Weegloo User login (PAT + console FE popup) for CMA / Upload / CDA. The admin-side identity model.
- **`weegloo-service-login`** — ServiceLogin / ServiceUser / ServiceUserRole / `isAdmin` mechanics and Bearer Token scope. The end-user identity model.
- **`weegloo-service-login-sdk`** — OAuth wire protocol on `auth.weegloo.com` and the official browser SDK for ServiceLogin.
- **`weegloo-delivery-access-token`** — least-privilege DeliveryAccessToken creation for CDA.
- **`weegloo-cda-publish`** — publish model that gates what CDA / ACDA actually return.
