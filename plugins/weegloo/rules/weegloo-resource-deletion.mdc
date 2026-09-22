---
id: weegloo-resource-deletion
type: rule
title: Weegloo resource deletion - dependency order and preconditions
description: >
  Deleting a Weegloo resource fails while a dependant still exists; nothing is force-deleted and
  nothing cascades upward. Space delete is blocked only by ContentType, Content, Media and
  WebHosting; ContentType is blocked by its Content; Published resources must be unpublished first.
  Before any teardown or on a 422 from a delete, invoke the weegloo-resource-deletion skill.
---

rules:
  - section: Critical invariants (always apply)
    items:
      - "**Nothing is force-deleted and nothing cascades upward — teardown is bottom-up.** A `Space` is blocked by EXACTLY four types (`WGL422024`): **ContentType**, **Content**, **Media**, **WebHosting**. Everything else in it (roles, tokens, memberships, Locale, Tag, Webhook, Scheduler, Script, ServiceLogin, EmailAccount, logs) **cascades with the Space — do not delete those first**; those calls are wasted, and **most of them succeed**, destroying the Space's configuration for nothing. **Emptying a Space you KEEP is the opposite — nothing cascades**, so each of them must be deleted, in its own order (skill → `references/space-reset.md`)."
      - "**`ContentType` is blocked while ANY `Content` of it exists — `Draft` and `Archived` count exactly like `Published` (`WGL422010`) — and the SAME check also blocks `cma_UnpublishOneContentType`**, so a published type with Content cannot be unpublished into a deletable state first: delete every Content → unpublish → delete. **Recreating a ContentType to change a field therefore DESTROYS all its Content — say so before proposing it.**"
      - "**`Content` / `ContentType` / `Media` delete only from `Draft` or `Archived` (`WGL422009`) — unpublish first.** A Media file still `PENDING`/`PROCESSING`, or a WebHosting mid-deploy, is refused `WGL422031` — **wait; do not retry in a loop.**"
      - "**`Archived` is NOT deleted.** An archived Content or Media is a live row that still blocks its Space, and an archived Content still blocks its ContentType — archiving is never a teardown step, and archive is reachable only from `Draft` (`WGL422007`), never a shortcut past an unpublish."
      - "**Nothing checks inbound references.** Deleting a `Content` or `Media` that another Content points at via a `Refer` field **succeeds with no error**, leaving a dangling stub that expands to nothing on read (a missing image, an empty relation). Find referrers first by filtering the referring type on the `Refer` field's target id; **`…/contents/{id}/references` answers the OPPOSITE question** (what this Content points *to*) — an empty result from it proves nothing."
      - "**A `SpaceRole` any access token is bound to cannot be deleted:** each `DeliveryAccessToken` / `SpaceAccessToken` carries a hidden `SpaceMembership`, so the role fails `WGL422024` naming `SpaceMembership` with no human member in sight. **Delete the token, not memberships** — deleting real members' rows revokes their access and still does not free the role."
      - "**Space and Organization deletes are gated by TOKEN TYPE, not only by role — widening a `SpaceRole` never fixes that refusal.** `Space`: Organization `ADMIN` + `GLOBAL_SCOPE` → **console session or Personal Access Token only** (never a SpaceAccessToken / DeliveryAccessToken / ServiceUser token). `Organization`: `OWNER` + `CONSOLE_SCOPE` → **console session only; a PAT cannot delete an Organization.**"
      - "**Deleting is irreversible — confirm before deleting anything the user did not name**, and say what goes with it (a Space silently takes its roles, tokens, ServiceLogin, scripts and schedulers). **Never resolve a `WGL422024` by deleting rows the user has not agreed to lose.**"

  - section: Full guidance
    items:
      - Per-resource preconditions (`Locale`, `SpaceRole`, `ServiceUserRole`, `Script`, `Tag`, `Organization`), the full teardown order, and ACMA's auto-unpublish on delete live in the **`weegloo-resource-deletion`** skill.
