---
name: weegloo-space-role
description: SpaceRole and ServiceUserRole permission rules — scope ContentType, Content, and Media with optional filters (contentType, createdBy, tag). Use createdBy.sys.id for a fixed creator or :self for the currently authenticated caller. Use when designing least-privilege roles, per-user private Content, or member-scoped ACMA/ACDA access. English only.
---

# Weegloo — SpaceRole & ServiceUserRole (`createdBy` filters)

## When to use

- Creating or updating a **`SpaceRole`** (`cma_CreateSpaceRole`, `cma_UpdateSpaceRole`) for **Weegloo Users** (CMA / CDA / `DeliveryAccessToken`).
- Creating or updating a **`ServiceUserRole`** (`cma_CreateServiceUserRole`, …) for **Service Users** (ACMA / ACDA).
- Scoping permissions so a caller may only see or change **resources they created** (private notes, drafts, per-member data).
- **Webhook + WriteBack** job ContentTypes — open **Create**, **Read / Edit / Delete** with **`:self`** only (**`weegloo-webhook-writeback`**).
- Pinning access to **one specific creator** by user id (audit, delegation, or a fixed service account).

Canonical API reference (overview + structure): **`weegloo-api-endpoints`** rule → *Weegloo documentation* → **SpaceRole**.

---

## Permission maps (`contentType`, `content`, `media`)

Both **`SpaceRole`** and **`ServiceUserRole`** define three permission maps:

| Map | Applies to |
|-----|------------|
| `contentType` | **ContentType** resources |
| `content` | **Content** entries |
| `media` | **Media** assets |

Each map lists **actions** (`Read`, `Create`, `Edit`, `Delete`, `Publish`, `All`, …). Under each action, **`Allow`** or **`Deny`** holds an array of **filter rules**.

| Filter key | Purpose |
|------------|---------|
| `contentType` | Limit to one **ContentType** (`Refer` with `targetType: "ContentType"`) |
| `createdBy` | Limit to resources **created by** a given user |
| `tag` | Limit by **Tag** |

An **empty** rule list `[]` means the action applies to **all** resources of that kind (no filter).

Combine filters in one rule object when needed — e.g. restrict **Read** on **Content** of a given **ContentType** **and** only when **created by** the caller.

---

## `createdBy` — restrict to a specific creator

**Goal:** “Only resources created by user X.”

Set **`createdBy.sys.id`** to that user’s id (string). Example: user id `12345`:

```json
"createdBy": {
  "sys": {
    "type": "Refer",
    "id": "12345",
    "targetType": "User"
  }
}
```

- On **`SpaceRole`**, `targetType` is **`User`** (Weegloo platform account).
- On **`ServiceUserRole`**, the filter uses the same **`createdBy`** shape; **`targetType`** is **`User`** in the CMA schema — at runtime **`:self`** resolves to the **current `ServiceUser`** for ACMA / ACDA calls.

You may attach this filter on **`content`**, **`contentType`**, or **`media`** — whichever resource class the action targets.

---

## `:self` — “only what I created” (reserved id)

**Do not** hard-code the caller’s id in a role that should follow **whoever** is authenticated.

Use the reserved value **`:self`** in **`createdBy.sys.id`**:

```json
"createdBy": {
  "sys": {
    "type": "Refer",
    "id": ":self",
    "targetType": "User"
  }
}
```

| | Fixed id (`"12345"`) | **`:self`** |
|---|---------------------|-------------|
| Meaning | Always that one creator | **Current API caller** at request time |
| Use when | One known user / account | Per-user private data, “my content only” |

- **SpaceRole + CMA/CDA:** `:self` → the **Weegloo User** behind the Bearer or the user implied by the **`DeliveryAccessToken`**’s role evaluation context.
- **ServiceUserRole + ACMA/ACDA:** `:self` → the **`ServiceUser`** identified by the **ServiceLogin** Bearer Token.

`:self` is **not** a real user id in the directory; it is evaluated per request.

> **`:self` works on delivery (ACDA / CDA) only if the ContentType has `publishWithAuthor: true`** — otherwise the published snapshot has no `sys.createdBy` to match, so it passes on ACMA but silently returns empty (or over-exposes) on ACDA. See **`weegloo-create-content-type`** → *`publishWithAuthor`*.

---

## Recipe — per-user private Content (Weegloo User)

**Need:** Each console/API user may **read (and optionally edit)** only **their own** entries of a given **ContentType** — e.g. private notes.

1. Create or update a **`SpaceRole`**.
2. Under **`content`**, grant the needed action(s) (e.g. **`Read`**, **`Edit`**) with **`Allow`** containing **one rule** that sets:
   - **`contentType`** → `Refer` to that **ContentType**’s `sys.id`
   - **`createdBy.sys.id`** → **`":self"`**
3. Assign the role via **Space membership** (Weegloo User) or bind it on a **`DeliveryAccessToken`** only if product requirements truly need token-scoped per-user delivery (unusual for anonymous CDA; typical for authenticated CMA/CDA).

Example shape (illustrative — add other actions/maps as required):

```json
"content": {
  "Read": {
    "Allow": [
      {
        "contentType": {
          "sys": {
            "type": "Refer",
            "id": "<privateNotesContentTypeId>",
            "targetType": "ContentType"
          }
        },
        "createdBy": {
          "sys": {
            "type": "Refer",
            "id": ":self",
            "targetType": "User"
          }
        }
      }
    ]
  }
}
```

For **`Create`**, use a **contentType-only** rule (no **`createdBy`**) when anyone permitted by the role may add new rows — see **Webhook job** recipe below.

---

## Recipe — Webhook job Request / Response Content

When a **ContentType** carries async **request** + **response** for an external API (**`weegloo-webhook-writeback`**):

| Action | `createdBy` filter |
|--------|-------------------|
| **`Create`** | **Omit** — allow new job rows for the job **ContentType** |
| **`Read`**, **`Edit`**, **`Delete`**, … | **`":self"`** + job **ContentType** `Refer` |

End users submit jobs (**Create**); they may only **read / change / delete their own** job Content. **WriteBack** still updates **`response`** platform-side after the external API succeeds.

---

## Recipe — member-private Content (Service User)

For **open sign-up** products, prefer **`ServiceUserRole`** + **ACMA** / **ACDA** (see **`weegloo-service-login`**).

- **Platform default:** ACMA already limits members to **CRUD on resources they created** unless the role or **`isAdmin`** widens it.
- **Explicit role rules:** use the same **`createdBy.sys.id": ":self"`** (+ optional **`contentType`**) on **`ServiceUserRole`** when you need **read** tiers, **deny** rules, or stricter **ACDA** visibility than the default.

Wire **`ServiceLogin.sys.defaultRole`** (or **`ServiceUser.roleOverride`**) to that role after **`cma_CreateServiceUserRole`**.

---

## MCP tools (typical)

| Role type | Create | List | One |
|-----------|--------|------|-----|
| **SpaceRole** | `cma_CreateSpaceRole` | `cma_GetListSpaceRoles` | `cma_GetOneSpaceRole` |
| **ServiceUserRole** | `cma_CreateServiceUserRole` | `cma_GetListServiceUserRoles` | `cma_GetOneServiceUserRole` |

OpenAPI field shapes: **`weegloo-api-endpoints`** → CMA API docs → **`CreateSpaceRole`** / **`CreateServiceUserRole`**.

**CDA token binding** after the role exists: **`weegloo-delivery-access-token`** (never Administrator; bind the intended `sys.id` only).

---

## Common mistakes

- **Hard-coding a user id** in a role meant for “every member sees only their own rows” — use **`:self`** instead.
- **Omitting `contentType`** when only one ContentType should be private — without it, the action may apply to **all** Content types that pass the `createdBy` filter.
- **Confusing `SpaceRole` with `ServiceUserRole`** — Weegloo Users vs Service Users use different role resources and tokens; see **`weegloo-api-endpoints`** and **`weegloo-service-architecture`**.
- **Expecting `:self` on a shared DeliveryAccessToken** to mean “each anonymous visitor sees their own data” — anonymous CDA has **no** per-visitor identity; per-user private delivery for members belongs on **ACDA** + **ServiceUserRole**, not public CDA.
- **Using `:self` on ACDA / CDA without `publishWithAuthor: true`** — silently matches nothing on delivery (see the `:self` note above).

---

## Related

- **`weegloo-delivery-access-token`** — bind a least-privilege **SpaceRole** to a CDA token.
- **`weegloo-service-login`** — ServiceUserRole, `defaultRole`, `roleOverride`, `isAdmin`, ACMA ownership defaults.
- **`weegloo-service-architecture`** — which role type each service pattern needs.
- **`weegloo-webhook-writeback`** — async external API jobs; mandatory Create vs `:self` Read/Edit/Delete split.
- **`weegloo-api-endpoints`** — API base URLs, docs index, `SpaceRole` reference link.
