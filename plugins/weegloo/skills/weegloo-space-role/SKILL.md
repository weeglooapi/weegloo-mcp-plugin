---
name: weegloo-space-role
description: SpaceRole and ServiceUserRole permission rules — scope ContentType, Content, Media, and Script with optional filters (contentType, createdBy, tag, self). Script adds an Execute action (call /execute); on Script only createdBy and self apply. Use createdBy.sys.id ':self' for the authenticated caller's own resources, or the `self` filter (a Refer to one entity) to pin a rule to exactly one resource — e.g. Execute a single specific Script. Use when designing least-privilege roles, per-user private Content, granting Script Execute (all / own / one specific), or member-scoped ACMA/ACDA access. English only.
---

# Weegloo — SpaceRole & ServiceUserRole (`createdBy` filters)

## When to use

- Creating or updating a **`SpaceRole`** (`cma_CreateSpaceRole`, `cma_UpdateSpaceRole`) for **Weegloo Users** (CMA / CDA / `DeliveryAccessToken`).
- Creating or updating a **`ServiceUserRole`** (`cma_CreateServiceUserRole`, …) for **Service Users** (ACMA / ACDA).
- Scoping permissions so a caller may only see or change **resources they created** (private notes, drafts, per-member data).
- **Script `Execute`** for a caller (usually `Allow: []`), or **async external-API job** ContentTypes — open **Create**, **Read / Edit / Delete** with **`:self`** only (**`weegloo-script`**).
- Pinning access to **one specific creator** by user id (audit, delegation, or a fixed service account).

Canonical API reference (overview + structure): **`weegloo-api-endpoints`** rule → *Weegloo documentation* → **SpaceRole**.

---

## Permission maps (`contentType`, `content`, `media`)

Both **`SpaceRole`** and **`ServiceUserRole`** define these permission maps:

| Map | Applies to |
|-----|------------|
| `contentType` | **ContentType** resources |
| `content` | **Content** entries |
| `media` | **Media** assets |
| `script` | **Script** resources (declarative backend endpoints — `weegloo-script`) |

Each map lists **actions**. Content/Media/ContentType use `Read`, `Create`, `Edit`, `Delete`,
`Publish`, `Unpublish`, `Archive`, `Unarchive`, `All`. **`script` additionally supports `Execute`**
(the right to call a Script's `/execute`) — an action unique to Script. Under each action,
**`Allow`** or **`Deny`** holds an array of **filter rules**.

| Filter key | Purpose |
|------------|---------|
| `contentType` | Limit to one **ContentType** (`Refer` with `targetType: "ContentType"`) |
| `createdBy` | Limit to resources **created by** a given user (`:self` for the caller) |
| `tag` | Limit by **Tag** |
| `self` | Limit to **one specific resource by `Refer`** — pins the rule to exactly that entity (`Refer<Entity>`), e.g. one specific **Script**. **Valid only on the `contentType` and `script` maps** (rejected on `content` / `media` at save with `WGL400020`). |

An **empty `Allow` list `[]`** means the action applies to **all** resources of that kind (no filter). ⚠️ An **empty `Deny` list `[]` is NOT the mirror image — it denies *everything* of that kind** (blocks the action entirely), so `[]` does not universally mean "no filter."

> **⚠️ `self` (filter) is NOT `:self` (the `createdBy` sentinel) — don't confuse them.**
> `createdBy.sys.id: ":self"` = "resources created by **whoever is calling**". The **`self`** filter
> is a **direct `Refer` to one specific resource** (by `sys.id` + `targetType`) — "**this exact
> entity**", regardless of who created it. See *`self` — pin to one specific resource* below.

> **On the `script` map, `createdBy` and `self` are the meaningful filters** — `contentType` and
> `tag` do **not** apply to Scripts. Empty `Allow: []` = **all** Scripts; `createdBy :self` = only
> Scripts the **caller created**; **`self`** = **one specific Script** (its `Refer`), e.g. "may
> `Execute` **exactly this** Script and no other."

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

## `self` — pin a rule to one specific resource (`Refer`)

Separate from **`createdBy`**, the **`self`** filter scopes a rule to **exactly one named resource**,
by direct reference — regardless of who created it. Its value is a **`Refer`** to that entity
(`Refer<Entity>`): set `sys.id` to the resource's id and `sys.targetType` to its type.

```json
"self": {
  "sys": {
    "type": "Refer",
    "id": "<resourceId>",
    "targetType": "Script"
  }
}
```

- **Primary use — Script.** On the `script` map, `self` pins the action to **one specific Script**.
  e.g. `script.Execute.Allow = [ { "self": { "sys": { "id": "<scriptId>", "type": "Refer", "targetType": "Script" } } } ]`
  lets the caller **`Execute` that one Script and no other** — the least-privilege way to expose a
  single backend endpoint to a group of users without granting "execute any Script."
- **On the `contentType` map — pin to one ContentType.** To scope a `contentType`-map action (e.g.
  `Read`/`Edit` on ContentType definitions) to a **single** ContentType, use `self` (a `Refer` with
  `targetType: "ContentType"`). On the `contentType` map the **`contentType` *filter* is rejected** —
  `self` is the way to narrow it to one type.
- **Contrast with `createdBy`:** `createdBy :self` = "any resource **I created**" (dynamic, by
  author); `self` = "**this one resource**" (fixed, by id) — independent of author.
- **Contrast with `contentType`** (on Content): `contentType` scopes to a whole **type**; `self`
  scopes to a **single instance**.
- **Valid only on the `contentType` and `script` maps** — using `self` on `content` or `media` is
  rejected at save (`WGL400020`). On `script` it is one of the two meaningful filters (with `createdBy`);
  on `contentType` it pins the rule to one specific ContentType.

> Reminder: **`self`** (this filter, a `Refer` to an entity) ≠ **`:self`** (the reserved
> `createdBy.sys.id` value meaning the current caller). Same word, different mechanism.

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

## Recipe — async external-API job Content (Script-written)

When a **ContentType** carries async **request** + **response** for an external API (written by a
**`weegloo-script`**):

| Action | `createdBy` filter |
|--------|-------------------|
| **`Create`** | **Omit** — allow new job rows for the job **ContentType** |
| **`Read`**, **`Edit`**, **`Delete`**, … | **`":self"`** + job **ContentType** `Refer` |

End users submit jobs (**Create**); they may only **read / change / delete their own** job Content.
A **Script** (running with its author's delegated authority) writes **`response`** platform-side
after the external API succeeds — the user's own role never needs `Edit` on the `response` field, so
they cannot forge a completed job.

---

## Recipe — Script `Execute` (let a caller run a Script)

Grant the caller the right to call a Script's `/execute`, without letting them author Scripts.

- On the caller's role (**`ServiceUserRole`** for ServiceLogin → ACMA execute; **`SpaceRole`** for
  Weegloo User / `DeliveryAccessToken`), add a **`script`** map granting **`Execute`**. Scope it:
  - `Allow: []` → may Execute **any** Script (broad);
  - `createdBy :self` → only Scripts the **caller created**;
  - **`self` → exactly one specific Script** (recommended for exposing a single endpoint).
  Do **not** grant `Create`/`Edit`/`Delete` unless the caller should author Scripts.

```json
"script": {
  "Execute": {
    "Allow": [
      { "self": { "sys": { "type": "Refer", "id": "<scriptId>", "targetType": "Script" } } }
    ]
  }
}
```

Use `"Execute": { "Allow": [] }` instead to allow executing **every** Script in the Space.

**Why this is powerful (privilege delegation):** because the Script's inner writes run with the
**author's** authority, granting a caller `Execute` (and nothing else) lets them perform **one
specific privileged operation** they otherwise can't. e.g. end users have **no** write on a `Log`
ContentType, but `Execute` on a `recordEvent` Script lets them **append** log entries through it —
without gaining `content.Create`/`Edit` on `Log` at all. Scope with `self` so it's exactly that one
Script. Full patterns: **`weegloo-script`**.

> **Authoring gotcha (not a filter thing):** a Script runs its inner Content/Media ops with its
> **author's** authority, not re-checked per statement at run time. So the **author's** role must
> hold an **unconditional `Allow`** (no `contentType`/`createdBy`/`tag` filter) for **each**
> Content/Media action the Script performs, or the save is rejected (`WGL403015`). Author Scripts as
> a broadly-permissioned admin; keep end users to `Execute` only. Detail: **`weegloo-script`**.

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
- **`weegloo-script`** — Script `Execute` permission, the author unconditional-Allow gate, and async external-API jobs (Create vs `:self` Read/Edit/Delete split).
- **`weegloo-webhook`** — Webhook triggers that run a Script or POST to a URL.
- **`weegloo-api-endpoints`** — API base URLs, docs index, `SpaceRole` reference link.
