---
name: weegloo-resource-deletion
description: Deleting a Weegloo resource fails while something still depends on it — Weegloo never force-deletes and never cascades upward. Covers the exact delete order for a Space teardown (only ContentType, Content, Media and WebHosting block it — every other child cascades), the ContentType/Content dependency (and the WGL422010 double-bind where unpublish is blocked too), the Draft-or-Archived precondition (unpublish first), busy files/deploys, and the per-resource preconditions for Locale, SpaceRole, ServiceUserRole, Script, Tag and Organization. Also covers what is NOT enforced — deleting a Content or Media leaves other Content's Refer stubs dangling — and who is even allowed to delete a Space or an Organization. Use when deleting or cleaning up ANY Weegloo resource, when planning a teardown, or when a delete returns 422. English only.
---

# Weegloo resource deletion (dependency order and preconditions)

## When to use

- Deleting a **Space**, an **Organization**, or anything inside a Space, and needing the order.
- A delete returned **422** with a `WGL422…` code and the next move is unclear.
- Cleaning up after a demo/test integration, or migrating a ContentType (delete + recreate).

## The one rule everything follows

**Weegloo refuses a delete while anything still depends on the target. It never force-deletes, and it
never deletes a dependant for you.** The direction matters:

- **Upward is blocked.** A parent refuses while its dependants exist — you delete the children first,
  one API call each. There is no `force`, no `recursive`, no `cascade` flag anywhere.
- **Downward cascades on its own.** Once a delete is accepted, the target's *owned* records go with it
  automatically — comments, snapshots, published projections, logs, storage objects, search views. You
  never delete those yourself and they never block anything.

So a teardown is always **bottom-up**, and the only question worth answering is: *which children
actually block this parent?* For a Space the answer is short — four resource types, listed below.

## Two preconditions that apply to Content, ContentType and Media

Before any of the three can be deleted:

1. **`sys.status` must be `Draft` or `Archived`.** `Published` or `Changed` → **`WGL422009`**
   (*"Cannot delete a published resource"*). **Unpublish first** — `cma_UnpublishOneContent`,
   `cma_UnpublishOneContentType`, `cma_UnpublishOneMedia` — which returns it to `Draft`.
   - Unpublish needs the current **`sys.version`** in **`X-Weegloo-Version`** (MCP parameter
     `X-Weegloo-Version`). **Delete itself takes no version** — it is not an optimistic-lock write.
   - `Archived` is already deletable, so an archived resource needs **no** unpublish.
2. **A Media's files must not be busy.** Any locale bucket in `PENDING` / `PROCESSING` →
   **`WGL422031`**. Wait for `fields.file.{locale}.state` to settle (**`weegloo-media-lifecycle`**).
   The same code guards a **WebHosting** whose `sys.state` is still `PENDING` / `PROCESSING`.

**`Archived` is not deleted.** An archived Content or Media is a live row: it still blocks its Space
and still blocks its ContentType. Archiving is a hiding mechanism, not a teardown step — and archive is
only reachable **from `Draft`** (`WGL422007`), so it is never a shortcut past an unpublish.

**A Script's `ResourceDelete` obeys exactly these rules** — same status check, same busy check, same
codes, catchable in a `Try` (**`weegloo-script`**).

## Deleting a Space — only four things block it

`cma_DeleteOneSpace` pre-checks **four** counts, each failing with **`WGL422024`**
(*"To delete '{0}', '{1}' must be deleted first"*):

| Must be 0 in the Space | Delete with |
|---|---|
| **ContentType** | `cma_DeleteOneContentType` |
| **Content** | `cma_DeleteOneContent` / `cma_DeleteOneContentOfContentType` |
| **Media** | `cma_DeleteOneMedia` |
| **WebHosting** | `cma_DeleteOneWebHosting` |

**Everything else in the Space cascades and must NOT be deleted first.** SpaceRole, SpaceMembership,
Locale, Tag, Comment, published projections, search UIs/views, ServiceLogin, ServiceUser,
ServiceUserRole, Webhook (+ its call logs and status), Scheduler (+ its run history), Script (+ its
logs), DeliveryAccessToken and SpaceAccessToken (with the synthetic users, memberships and cached
tokens behind them), EmailAccount, and the Space's icon — all removed by the platform after the Space
row is gone. Deleting them by hand first is wasted calls, and deleting a *role* or *token* by hand can
fail on its own preconditions for no reason.

### Teardown order

1. **WebHosting** — independent of everything else; only blocked while a deploy is in flight.
2. **Content** — unpublish anything `Published`/`Changed`, then delete. Page the list (`links.next`);
   do not assume one page is all of it (**`weegloo-list-pagination`**).
3. **ContentType** — only now, once **every** Content of it is gone (see the double-bind below).
4. **Media** — unpublish, wait for any processing to settle, delete.
5. **Space**.

Steps 1, 2+3 and 4 are independent of each other; only *within* the Content → ContentType chain is the
order forced.

## ContentType ← Content: the dependency, and the WGL422010 double-bind

`cma_DeleteOneContentType` refuses while **any** Content of that type exists — **`WGL422010`**. "Any"
means any status: `Draft` and `Archived` Content block it exactly like `Published` Content does.

**The trap: `cma_UnpublishOneContentType` is blocked by the same check.** So for a *published*
ContentType that still has Content you cannot unpublish it into a deletable state first — both doors
are shut by the same condition. The order is forced:

```
delete every Content of the type   (unpublish each Published/Changed one first)
  → cma_UnpublishOneContentType    (now allowed; needs X-Weegloo-Version)
  → cma_DeleteOneContentType
```

Recreating a ContentType to change a field is therefore a **data-destroying** operation — every
Content of it must be deleted first. Say so before doing it; prefer an additive field change
(**`weegloo-create-content-type`**).

## Per-resource preconditions

| Resource | Refuses while… | Code | Fix |
|---|---|---|---|
| **Content** | `Published` / `Changed` | `WGL422009` | unpublish |
| **ContentType** | any Content of it exists (any status) | `WGL422010` | delete that Content |
| **ContentType** | `Published` / `Changed` | `WGL422009` | unpublish (needs the above first) |
| **Media** | `Published` / `Changed` · a file locale is `PENDING`/`PROCESSING` | `WGL422009` · `WGL422031` | unpublish · wait |
| **WebHosting** | `sys.state` is `PENDING` / `PROCESSING` (a deploy in flight) | `WGL422031` | wait |
| **Locale** | it is the **only** Locale · it is the **default** · another Locale names it as `fallbackCode` | `WGL422017` · `WGL422018` · `WGL422019` | keep ≥1 · move default · clear that fallback |
| **SpaceRole** | it is the Space's locked default (Administrator) · any SpaceMembership still carries it | `WGL422025` · `WGL422024` | not deletable · reassign/remove those memberships |
| **ServiceUserRole** | a `ServiceLogin.sys.defaultRole` points at it · a ServiceUser's `roleOverride` points at it | `WGL422029` | repoint the default role · clear those overrides |
| **Script** | a Webhook runs it · a Scheduler runs it | `WGL422066` · `WGL422110` | delete or repoint the Webhook / Scheduler |
| **Tag** | any Content or Media carries it | `WGL422024` | untag them |
| **SpaceMembership** | its User is system-created (a token's synthetic user) | `WGL422022` | delete the **token** instead |
| **AppInstallation** | the install is pending or running | `WGL422051` | wait for Completed/Failed |
| **Space** | ContentType / Content / Media / WebHosting exist | `WGL422024` | see above |
| **Organization** | not on the free plan · subscription not settled · Spaces exist · a Published/Deleted MarketApp exists | `WGL422078` · `WGL422079` · `WGL422024` | see below |

**No dependency check at all** — these delete straight away (and take their own logs/records with
them): **Webhook**, **Scheduler**, **ServiceLogin**, **EmailAccount**, **DeliveryAccessToken**,
**SpaceAccessToken**.

### Locale: you cannot un-default a Locale

Setting `default: false` on the current default is rejected (`WGL422035`). Promote **another** Locale
with `default: true` — that demotes the previous one — and only then delete the old default. A Locale
that other Locales fall back to must lose those `fallbackCode` references first
(**`weegloo-default-locale`**).

### SpaceRole: every access token holds a hidden membership

Creating a `DeliveryAccessToken` or a `SpaceAccessToken` also creates a **synthetic User plus a
SpaceMembership bound to the chosen role**. That membership is invisible in the console's member list
but is a real row, so **a role that any live token is bound to cannot be deleted** — `WGL422024` naming
`SpaceMembership`, with no human member in sight. And that membership cannot be deleted directly either
(`WGL422022`, system-created user).

**Delete the token** (`cma_DeleteDeliveryAccessToken` / `cma_DeleteSpaceAccessToken`); its membership,
synthetic user and cached credential go with it. Then the role deletes.

### Organization

`cma_DeleteOneOrganization` checks, in order: the plan must be **free** (`WGL422078` — cancel a paid
plan and wait for it to lapse at the next billing date), the payment-provider subscription must be
finished with no pending change (`WGL422079` — wait, do not retry in a loop), **every Space must be
deleted** (`WGL422024`), and no Published/Deleted MarketApp may belong to it (`WGL422024`).

## Who is allowed to delete — token type matters, not just the role

Two deletes sit outside a Space's role system entirely:

- **Space** — requires **Organization `ADMIN`** and a token carrying `GLOBAL_SCOPE`: a **console login
  session or a Personal Access Token**. A `SpaceAccessToken`, a `DeliveryAccessToken`, a ServiceUser
  token and a Space-scoped console token **cannot delete a Space at all**, whatever their bound role
  says. Widening a `SpaceRole` never fixes this (**`weegloo-space-access-token`**).
- **Organization** — requires Organization **`OWNER`** and `CONSOLE_SCOPE`, which **only a console
  login session carries**. A **Personal Access Token cannot delete an Organization** — do not offer
  that as an automated step; the owner does it from the console.

Content / ContentType / Media / WebHosting deletes are ordinary role-gated operations
(**`weegloo-space-role`**).

## What is NOT enforced — dangling references are yours to prevent

**Nothing checks inbound references before a delete.** Deleting a Content or a Media that other Content
points at through a `Refer` field **succeeds**, and the referring Content keeps a stub
(`{ sys: { id, type: "Refer", targetType } }`) aimed at a row that no longer exists. Reads then return
a reference that expands to nothing — an image that never loads, a detail page with a blank relation.
Deleting a **ContentType** is likewise not blocked by another ContentType's `Refer` field validation
targeting it.

Find inbound references yourself before deleting anything that looks linked:

```
GET /v1/spaces/{spaceId}/contents
    ?sys.contentType.sys.id=<referring CT id>
    &fields.<referField>.<locale>.sys.id[eq]=<target id>
    &select=sys.id
```

The locale segment is required, and on the flat `/contents` list so is the ContentType scope
(**`weegloo-global-rules`** → *Filter Parameters*). Note the CMA
`…/contents/{id}/references` endpoint answers the **opposite** question — what this Content points
*to*, not what points *at* it — so it does not help here.

## ACMA (Service User plane)

- **Delete auto-unpublishes.** The ACMA delete endpoint unpublishes and then deletes in one call, so a
  Service User never calls unpublish first (**`weegloo-cda-publish`**). The **busy-file** check still
  applies to Media.
- What a `ServiceUser` may delete is set by its `ServiceUserRole` alone — `createdBy :self` keeps it to
  their own resources, and a role without that filter deletes anyone's (**`weegloo-service-login`**).
- ACMA has no Space, ContentType, Locale, role or token deletes — those are CMA-only.

## Reporting a teardown

Deleting is destructive and irreversible. **Confirm with the user before deleting anything they did not
name**, and say what will go with it — deleting a Space silently takes its roles, tokens, login
configuration, scripts and schedulers too. When a delete is refused, report the blocking resource in
plain language ("3 entries still use this content type") rather than the raw `WGL422…` code, and never
"fix" a `WGL422024` by deleting rows the user has not agreed to lose.

## Related

- **`weegloo-media-lifecycle`** — `sys.status`, `fields.file.{locale}.state`, and the unpublish→delete
  order for Media.
- **`weegloo-cda-publish`** — publish/unpublish semantics, and ACMA's auto-unpublish on delete.
- **`weegloo-create-content-type`** — why a field change beats a delete-and-recreate.
- **`weegloo-space-role`** / **`weegloo-space-access-token`** — role and token scope, and why settings
  actions cannot be reached by a `SpaceAccessToken`.
- **`weegloo-default-locale`** — default locale and `fallbackCode` chains.
- **`weegloo-script`** — `ResourceDelete` inside a Script, and `Try` around these 422s.
