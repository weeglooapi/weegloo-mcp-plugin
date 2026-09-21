---
name: weegloo-service-architecture
description: Picks the right Weegloo API + login + role combination for a product based on service type - public site, public site with admin editing, members-only read, members read/write, and composite layouts. Use when planning a new app on Weegloo, deciding between CMA/CDA vs ACMA/ACDA, sizing DeliveryAccessToken vs ServiceLogin, or auditing an existing architecture.
---

# Weegloo - service architecture (API + login per service type)

## When to use

- Starting a new product on Weegloo and deciding which APIs to call from the **client** and (if any) from an **admin** path.
- Reviewing an existing app to confirm it uses the **right combination** of APIs, tokens, and roles for its access model.
- Disambiguating **CDA vs ACDA**, **CMA vs ACMA**, and when **ServiceLogin** is - or is not - required.

Base URLs, Accept header, and OpenAPI links live in **`weegloo-api-endpoints`** (do not duplicate URLs here).

## Two identities decide every row below

**Weegloo User** (platform account — Space owner or **invited** member; PAT or console FE login popup) drives **CMA / Upload / CDA**. **Service User** (an end-user of the product, **open sign-up** through ServiceLogin) drives **ACMA / ACDA / Upload**. Tokens never cross; **Upload** is the one shared surface, and the Media create that follows stays on the plane matching the uploader (CMA vs ACMA).

The invite-only nature of Space membership is the architectural consequence: **product end-users are never Weegloo Users**, so anything with open sign-up needs ServiceLogin. Identity mechanics and token scopes are already loaded — `weegloo-api-endpoints` ("Two login models", "SpaceRole & ServiceUserRole", "ACMA — member CRUD scope"). This skill decides only **which plane each path of the product uses**.

## Recipes by service type

Pick the row that matches the product. Each recipe lists the **client-side** APIs and the **roles/tokens** to provision.

### 1. Fully public service (read-only site)

> "Marketing site, public blog index, public catalog - every visitor sees the same content."

- **Client reads:** **CDA**.
- **Token:** one **DeliveryAccessToken** bound to a **least-privilege `SpaceRole`** for the relevant published `ContentType`s. Expose it to the browser per your build or client config (e.g. `NEXT_PUBLIC_WEEGLOO_DELIVERY_ACCESS_TOKEN`); document the pattern in the project README.
- **Writes:** done in the **Weegloo console** by the team — **no** client-side write path.
- **ServiceLogin:** **not required**.

### 2. Public service with an admin editing page

> "Public blog readable to anyone; the team logs in to a custom admin UI on the same domain (or a sibling) to publish posts."

- **Public read path (any visitor):** **CDA** with a DeliveryAccessToken (as in recipe 1).
- **Admin path (Weegloo Users only):** sign in as a **Weegloo User** via the **console FE login popup** (origin-checked `postMessage` → token in `sessionStorage`); call **CMA** / **Upload** for create/update/publish. Pattern: **`weegloo-user-login`**.
- **ServiceLogin:** **not required** — admins are **Weegloo Users** on this Space, not Service Users.
- **Roles:**
  - **`SpaceRole`** for the DeliveryAccessToken (read-only, scoped to the published `ContentType`s).
  - The admin's effective rights come from their **Space membership** (gate it with the `/me/space-memberships` check in **`weegloo-user-login`**).

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
- **Member writes:** **ACMA** - a `ServiceUser` is scoped by the effective `ServiceUserRole` and nothing else, so the default role needs **`createdBy :self`** to keep members on their own rows. Promote moderators with a role that omits that filter, attached via **`ServiceUser.roleOverride`**. See **`weegloo-service-login`**.
- **Member media uploads:** **Upload** with the ServiceLogin Bearer, then **ACMA** Media create with the same Bearer (the Media is owned by that ServiceUser). Do **not** route member media through CMA Media — that is Weegloo-User-only.
- **Member reads:** **ACDA** for resources scoped to the member.
- **Mixed-visibility resources:** content that **everyone** (members and non-members) may read is exposed via **CDA** with a **DeliveryAccessToken** - same constraints as recipe 1.
- **Required role configuration:**
  - **`SpaceRole`** for the **DeliveryAccessToken** (read-only, scoped) - for any CDA path.
  - **`ServiceUserRole`** for the default member, plus overrides for tiered/moderator members - for ACMA / ACDA.
- **Content modeling for a forum/board (verified end-to-end):**
  - **Author:** set **`publishWithAuthor: true`** on any member-generated `ContentType` whose author you will **display or filter by** (posts, comments, reviews, profiles) so `sys.createdBy` is delivered (`include=1` for the byline); do **not** add a manual author field. `false` by default — set it before members post. Details: **`weegloo-create-content-type`** → *`publishWithAuthor`*.
  - **Relationships:** model reply → parent and comment → post as **`Refer`** fields (self-reference for reply chains), not id strings. Normalize by default; see **`weegloo-create-content-type`**.
  - **Read + render:** ACDA returns the member's own/assigned posts; CDA serves any publicly readable ones. With `publishWithAuthor`, both carry `createdBy` for rendering the author.

### 5. Composite / multi-tier service

> "Public landing pages and catalog, plus a logged-in member area with personal content and writeable posts, plus a small admin surface."

Combine recipes - every path uses the API that matches the **caller's identity** for that path:

- **Anonymous visitor reads (public pages):** **CDA** + DeliveryAccessToken with a **public, read-only `SpaceRole`**.
- **Service User reads (private/personal content):** **ACDA** with **ServiceLogin** Bearer Token.
- **Service User writes (their own resources):** **ACMA** with the same ServiceLogin Bearer Token.
- **Weegloo User / staff editing (any resource in the Space):** **Weegloo User login** → **CMA** / **Upload** (**`weegloo-user-login`**).
- **Owner / admin dashboard reading or editing *all* members' data** (e.g. a salon owner's full booking schedule, an ops console): this is **cross-member** access → **Weegloo User login → CMA**, built as an **in-app admin UI by default** — see checklist step 2 for the full verdict and the native-app exception.
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
│ Service User moderator deleting others'     │ ACMA  + roleOverride to a role w/o :self      │
│ Weegloo User editing in a custom admin UI   │ CMA   + console FE login token (Space mbr.)   │
│ Weegloo User uploading Media (admin UI)     │ Upload + Weegloo User Bearer → CMA Media      │
│ Scoped write into one Space                 │ CMA   + SpaceAccessToken (SpaceRole)          │
│ Backend / CI / scripts (developer)          │ CMA   + Personal Access Token (server only)   │
└─────────────────────────────────────────────┴───────────────────────────────────────────────┘
```

## Anti-patterns to refuse

- **Calling CMA from a browser that does not have a Weegloo User session.** A Service User's ServiceLogin Bearer Token does **not** authorize CMA — use ACMA. The Weegloo User login flow for static admin UIs is **`weegloo-user-login`**.
- **Routing Service User writes through CMA + Weegloo User login.** That makes every writing member a Weegloo platform account on the Space — the wrong identity model. Use ACMA via ServiceLogin. (Member-contributed media is the same story: **Upload → ACMA** Media create with the ServiceLogin Bearer, never CMA Media.)
- **Onboarding product end-users as Weegloo Space members.** Working *your* Space as a Weegloo User means owning it or being **invited** to it — so making every product user a member would mean inviting each one. End-user sign-up belongs to **ServiceLogin**. If you find yourself inviting every product user to the Space, you are using the wrong identity model.
- **Reusing one DeliveryAccessToken for member-private reads.** CDA tokens are public; never bind them to anything more than the least-privilege public read scope. Use **ACDA** for per-member content.
- **Exposing a member's private data on a public CDA path** because it was easier than wiring ACDA — a browser-held DeliveryAccessToken shows every row it can read to everyone.
- **Treating a moderator role as Weegloo-admin.** A `ServiceUserRole` reaches Content / Media on ACMA and ACDA only. It never lets the member manage the Space itself.
- **Implementing the owner/admin view as a client-side role-switch inside the member app.** The member app's own role stays scoped; the cross-member surface is a separate Weegloo-User path (checklist step 2).

## LLM checklist

When planning an architecture, answer these in order:

1. **Anonymous read?** → CDA + DeliveryAccessToken with a least-privilege `SpaceRole`.
2. **Does the product have an owner / admin / staff surface (dashboard, settings, moderation, back-office, or any screen that reads/edits *all* members' data)?** → default to an **in-app admin UI**: Weegloo User login (console FE popup) → CMA / Upload. See **`weegloo-user-login`**. This is the default for any admin/owner surface — **do not silently drop it to "the team uses the Weegloo Console,"** and do **not** expose it as a public CDA read (that leaks every member's data to anyone holding the browser token), as ACDA (which is per-member), or as a client-side role-switch. Console-only is an explicit alternative the user must request, not a default. A `ServiceUserRole` without `createdBy :self` *could* read across members on ACMA, but an owner / ops surface belongs on CMA behind a Weegloo User. **This assumes a browser admin surface** — Weegloo User login is browser-only (**`weegloo-user-login`**), so a native Android / iOS admin app cannot use it: either keep that surface on the web, or model the operators as Service Users on a wider `ServiceUserRole` reached through **`ServiceUser.roleOverride`**.
3. **Per-end-user accounts in the product itself (open sign-up)?** → enable **ServiceLogin**, define `ServiceUserRole`(s), set `ServiceLogin.sys.defaultRole`. See **`weegloo-service-login`**.
4. **Service User writes?** → ACMA with Bearer Token. Give the default role **`createdBy :self`**; moderators get a role without it through `roleOverride`.
5. **Service User reads of personal/assigned content?** → ACDA with the same Bearer Token.
6. **Service User uploads media (avatar, attachment, etc.)?** → **Upload** with the ServiceLogin Bearer, then **ACMA** Media create with the same Bearer. Never route member media through CMA.
7. **For each screen: what is the smallest read that answers it, and where does the computation belong?** Apply **`weegloo-minimal-load`** (already loaded): narrow server-side, derive on the client, keep only what needs Weegloo's authority on Weegloo.

If the product covers more than one row, ship all matching paths - they coexist (recipe 5).

## After the architecture — model the content (do these next)

Choosing the API / login / role combination is only step 1. **Before** writing code, payloads, or asking the user content-shape questions, walk this chain in order — never design ContentTypes from memory:

1. **`weegloo-create-content-type`** — fields, `localized` flags, ShortText / LongText / RichText, validations, `publishWithAuthor`, `Refer`. A field-type question is answered there first; only the genuine product trade-off goes to the user.
2. **`weegloo-default-locale`** — whenever any field is multi-locale.
3. **`weegloo-delivery-access-token`** — provision the least-privilege DeliveryAccessToken for any CDA path.

Plus **`weegloo-service-login`** (+ **`weegloo-service-login-client`** for the OAuth wiring) whenever recipe 3, 4 or 5 put ServiceLogin in the plan.

## Related

- **`weegloo-api-endpoints`** — base URLs, Accept header, ACMA/ACDA ownership invariants.
- **`weegloo-user-login`** — the admin-side identity: PAT + console FE popup for CMA / Upload / CDA.
- **`weegloo-service-login`** / **`weegloo-service-login-client`** — the end-user identity and its OAuth flow.
- **`weegloo-space-role`** — role filters (`createdBy`, `:self`, `self`) behind every token above.
- **`weegloo-space-access-token`** — Space-scoped read+write token whose power is its bound `SpaceRole`.
- **`weegloo-upload-api`** — Upload REST → Media / WebHosting create, for product code.
- **`weegloo-cda-publish`** — the publish model that gates what CDA / ACDA actually return.
