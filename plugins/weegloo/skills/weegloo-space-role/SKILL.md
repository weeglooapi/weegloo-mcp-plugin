---
name: weegloo-space-role
description: SpaceRole and ServiceUserRole permission rules — scope ContentType, Content, Media and Script with the contentType, createdBy, tag and self filters, plus the SpaceRole `settings` axis (SETTING_*) gating Space config: Webhook, Locale, ServiceLogin, SpaceRole, SpaceMembership, WebHosting, DeliveryAccessToken, SpaceAccessToken, EmailAccount, Tag, app install, usage monitoring, Scheduler. Script adds Execute (call /execute, own a Scheduler). Use for least-privilege roles, per-user private Content (`createdBy :self`), Script Execute (any / own / one specific via `self`), member-scoped ACMA/ACDA access. 권한, 역할, 접근 제어, 관리자 권한, 내 것만 보이게.
---

# Weegloo — SpaceRole & ServiceUserRole (`createdBy` filters)

## When to use

- Creating or updating a **`SpaceRole`** (`cma_CreateSpaceRole`, `cma_UpdateSpaceRole`) for **Weegloo Users** (CMA / CDA / `DeliveryAccessToken`).
- Creating or updating a **`ServiceUserRole`** (`cma_CreateServiceUserRole`, …) for **Service Users** (ACMA / ACDA).
- Scoping permissions so a caller may only see or change **resources they created** (private notes, drafts, per-member data) — the main path, below.
- Pinning access to **one specific creator** by user id (audit, delegation, or a fixed service account).

**Two branches live in `references/` — read the one your task is on:**

| Read | When |
|---|---|
| **`references/settings-axis.md`** | The role must **configure the Space** — Webhook, Locale, ServiceLogin, WebHosting, Tag, token issuance, SpaceMembership, EmailAccount, app install, usage monitoring, Scheduler. It carries the complete `SETTING_*` action-name table. |
| **`references/script-permissions.md`** | The role touches **Script** — granting `Execute` (any / own / one specific), the `self` `Refer` filter's JSON shape, the Scheduler owner's grant, or the async external-API **job** ContentType recipe. |

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

**A `ServiceUserRole` accepts only a subset of the actions — the rest are rejected at save (`WGL400076`), not silently ignored.** ACMA and ACDA expose no publish, unpublish, archive or unarchive endpoint (ACMA publishes on create and unpublishes on delete by itself), so `cma_CreateServiceUserRole` / `cma_UpdateServiceUserRole` / patch refuse those action keys outright:

| Map on a `ServiceUserRole` | Actions it accepts |
|---|---|
| `contentType` | **`Read` only** — not even `All` |
| `content`, `media` | `All`, `Create`, `Read`, `Edit`, `Delete` |
| `script` | those, plus **`Execute`** |

`Save`, `Publish`, `Unpublish`, `Archive` and `Unarchive` are rejected on **every** map. A **`SpaceRole`** is unaffected — it keeps the full action set, because CMA does expose those operations.

Each map lists **actions** (a `SpaceRole` takes them all; a `ServiceUserRole` only the subset above). Content/Media/ContentType use `Read`, `Create`, `Edit` (`Save` is an accepted
alias of `Edit`), `Delete`, `Publish`, `Unpublish`, `Archive`, `Unarchive`, `All`. **`script` additionally supports `Execute`**
(the right to call a Script's `/execute`) — an action unique to Script. Under each action,
**`Allow`** or **`Deny`** holds an array of **filter rules**.

| Filter key | Purpose |
|------------|---------|
| `contentType` | Limit to one **ContentType** (`Refer` with `targetType: "ContentType"`) |
| `createdBy` | Limit to resources **created by** a given user (`:self` for the caller) |
| `tag` | Limit by **Tag** |
| `self` | Limit to **one specific resource** by direct `Refer` (`sys.id` + `sys.targetType`) — "this exact entity", regardless of who created it. **Valid only on the `contentType` and `script` maps** (rejected on `content` / `media` at save with `WGL400020`). JSON shape and uses: **`references/script-permissions.md`**. |

An **empty `Allow` list `[]`** means the action applies to **all** resources of that kind (no filter). ⚠️ An **empty `Deny` list `[]` is NOT the mirror image — it denies *everything* of that kind** (blocks the action entirely), so `[]` does not universally mean "no filter."

> **⚠️ `self` (filter) is NOT `:self` (the `createdBy` sentinel) — don't confuse them.**
> `createdBy.sys.id: ":self"` = "resources created by **whoever is calling**" (dynamic, by author).
> The **`self`** filter is a **direct `Refer` to one named resource** (fixed, by id) — independent of
> author. Same word, different mechanism; picking the wrong one saves a role that silently scopes
> something else.

> **On the `script` map, `createdBy` and `self` are the meaningful filters** — `contentType` and
> `tag` do **not** apply to Scripts. Empty `Allow: []` = **all** Scripts; `createdBy :self` = only
> Scripts the **caller created**; **`self`** = **one specific Script**. Recipes:
> **`references/script-permissions.md`**.

Combine filters in one rule object when needed — e.g. restrict **Read** on **Content** of a given **ContentType** **and** only when **created by** the caller.

**The `settings` axis is a fourth field, not a map.** A **`SpaceRole`** also carries **`settings`**: a
plain array of `SETTING_*` action names — **no `Allow`/`Deny`, no filters** — gating everything that
*configures* the Space. A role with full Content rights still cannot touch it, and a `403` there is
**never** fixed by widening `content` / `media`.

**The complete set — `settings` accepts these names only; anything else is rejected at save.**
Four sibling skills send readers here for an exact name, so it stays in the spine:

| Action | Gates |
|---|---|
| `SETTING_GENERAL` | the **Space object** itself |
| `SETTING_LOCALE` | **Locale** |
| `SETTING_WEBHOOK` | **Webhook** (+ its calls / status) |
| `SETTING_APP` | **AppInstallation** — market app / bundle install |
| `SETTING_TAG` | **Tag** (create / update / delete) |
| `SETTING_DELIVERY_ACCESS_TOKEN` | **DeliveryAccessToken** |
| `SETTING_SPACE_ACCESS_TOKEN` | **SpaceAccessToken** |
| `SETTING_USER` | **SpaceMembership** |
| `SETTING_ROLE` | **SpaceRole** |
| `SETTING_WEB_HOSTING` | **WebHosting**, **CustomDomain** |
| `SETTING_SERVICE_LOGIN` | **ServiceLogin**, **ServiceUser**, **ServiceUserRole** |
| `SETTING_EMAIL_ACCOUNT` | **EmailAccount** (the SMTP sender) |
| `SETTING_MONITORING` | **usage & metrics** — Space monthly reports, network / storage usage |
| `SETTING_SCHEDULER` | **Scheduler** (+ its run history) |
| `SETTING_ALL` | all of the above — **avoid**; grant only what the caller needs |

Traps, the token gate and worked settings roles: **`references/settings-axis.md`**.

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

For **`Create`**, use a **contentType-only** rule (**omit `createdBy`**) when anyone permitted by the
role may add new rows — the caller is the creator of whatever they create, so `:self` on `Create`
buys nothing and only narrows `Read`/`Edit`/`Delete` afterwards.

---

## Recipe — member-private Content (Service User)

For **open sign-up** products, prefer **`ServiceUserRole`** + **ACMA** / **ACDA** (see **`weegloo-service-login`**).

- **There is no platform default** — ACMA scopes a member by the role alone, so the `createdBy` filter below is what keeps members off each other's rows.
- **Explicit role rules:** use the same **`createdBy.sys.id": ":self"`** (+ optional **`contentType`**) on **`ServiceUserRole`** when you need **read** tiers, **deny** rules, or stricter **ACDA** visibility than the default.

Wire **`ServiceLogin.sys.defaultRole`** (or **`ServiceUser.roleOverride`**) to that role after **`cma_CreateServiceUserRole`**.

---

## Common mistakes

- **Hard-coding a user id** in a role meant for “every member sees only their own rows” — use **`:self`** instead.
- **Omitting `contentType`** when only one ContentType should be private — without it, the action may apply to **all** Content types that pass the `createdBy` filter.
- **Confusing `SpaceRole` with `ServiceUserRole`** — Weegloo Users vs Service Users use different role resources and tokens; see **`weegloo-api-endpoints`** and **`weegloo-service-architecture`**.
- **Putting `Publish` / `Archive` / `Save` — or any `contentType` action other than `Read` — on a `ServiceUserRole`** — the save is rejected with **`WGL400076`**, naming the offending action and the map. Those belong on a `SpaceRole`.
- **Expecting `:self` on a shared DeliveryAccessToken** to mean “each anonymous visitor sees their own data” — anonymous CDA has **no** per-visitor identity; per-user private delivery for members belongs on **ACDA** + **ServiceUserRole**, not public CDA.
- **Using `:self` on ACDA / CDA without `publishWithAuthor: true`** — silently matches nothing on delivery (see the `:self` note above).

---

## Related

- **`weegloo-delivery-access-token`** — bind a least-privilege **SpaceRole** to a CDA token.
- **`weegloo-service-login`** — ServiceUserRole, `defaultRole`, `roleOverride`, ACMA member scope.
- **`weegloo-service-architecture`** — which role type each service pattern needs.
- **`weegloo-script`** — Script `Execute` permission, the author unconditional-Allow gate, and async external-API jobs (Create vs `:self` Read/Edit/Delete split).
- **`weegloo-webhook`** — Webhook triggers that run a Script or POST to a URL.
- **`weegloo-scheduler`** — `SETTING_SCHEDULER` + the `script.Execute` grant a Scheduler owner must keep.
- **`weegloo-api-endpoints`** — API base URLs, docs index, `SpaceRole` reference link, and the CMA OpenAPI field shapes for **`CreateSpaceRole`** / **`CreateServiceUserRole`**.
