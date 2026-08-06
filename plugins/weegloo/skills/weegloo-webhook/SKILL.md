---
name: weegloo-webhook
description: Weegloo Webhook — fire an action when a Space event happens. A Webhook subscribes to topics (e.g. Content.Create, Content.Publish) with optional filters, then does EXACTLY ONE of two things — POST to an external URL (shaped by a Transformation, with secret headers / basic auth) OR run a Script you created in the Space (the `script` field). To call an external API and write the result back into Content/Media, use a Script (`weegloo-script`). Covers topics/filters, url-XOR-script, headers/secrets, Transformation, and runAs (HookOwner|EventUser, attribution only). Use when the product must react to content events — notify an external system, or trigger server-side automation on create/update/publish.
---

# Weegloo — Webhook (event → URL or Script)

A **Webhook** reacts to **Space events**. On a matching event it performs **exactly one** action:

1. **Call an external URL** — POST (or another method) a Transformation-shaped body to your endpoint, or
2. **Run a Script** — hand the triggering resource to a **Script** you created in the Space
   (`weegloo-script`).

> **To call an external API and store the result, write a `Script`** — it does the `Http` call *and*
> the `ResourceCreate`/`Patch` / Media-ingest. Trigger it from this Webhook (`script` field) or call
> it directly from the frontend via `/execute`. A Webhook itself only *triggers*; it does not write
> anything back on the URL path. See **`weegloo-script`** → *the external-API job pattern*.

## When to use

- React to content changes: notify Slack/an external service on `Content.Publish`, sync to a search
  index on `Content.Save`, etc.
- **Event-driven automation**: run a Script automatically when a row is created/updated (instead of
  the frontend calling the Script's `/execute`).
- External API call that stores its result in the Space → author a **`weegloo-script`** (trigger it
  here or call `/execute` directly).

> Base URLs, vendor JSON, OpenAPI discovery: `weegloo-api-endpoints`. Role for job Content and the
> Script `Execute` permission: `weegloo-space-role` / `weegloo-script`.

## Resource fields (CMA `Webhook`)

| Field | Notes |
|-------|-------|
| `name` | 1–64 chars |
| `activate` | boolean; `false` = nothing fires |
| `topics` | array of `"{resource}.{action}"` — resource ∈ **Content / ContentType / Media / Comment**; action ∈ **Create, Save, Delete, Publish, Unpublish, Archive, Unarchive** (e.g. `"Content.Create"`). **`*` wildcards** are allowed on either side: `Content.*`, `*.Publish`, and `*.*` are all valid subscriptions |
| `filters` | narrow which events fire — keys `sys.id` (a specific item), `sys.contentType.sys.id`, `sys.createdBy.sys.id`, `sys.updatedBy.sys.id` (last editor); operators **`EQ`, `NE`, `IN`, `NOT_IN`, `REGEX`, `NOT_REGEX`** |
| `url` | external endpoint — **mutually exclusive with `script`** |
| `script` | `Refer` → a Script to run instead of the URL — **mutually exclusive with `url`** |
| `headers` | 0–30 `WebhookHeader`s; mark auth/keys as **`secret: true`** (encrypted at rest) |
| `httpBasicUsername` / `httpBasicPassword` | optional Basic auth for the URL path |
| `transformation` | **required** object that shapes the outbound URL request (its members all default, so `{}` suffices): `method` (GET/POST/PUT/DELETE/PATCH, default POST), `contentType`, `body` (JSON-Pointer templating like `{ /payload/sys/id }`), `includeBody` (default `true`) |
| `runAs` | **`HookOwner`** (default; the webhook's creator) or **`EventUser`** (the user who caused the change) |

**Exactly one of `url` and `script`.** Setting both, or neither, is rejected (**`WGL422061`**).

## Path A — call an external URL

Classic outbound delivery: on a matching event, Weegloo builds a payload from the triggering entity,
applies **`transformation`** (method, content type, JSON-Pointer body templating), adds `headers`
(keys as **secret**), and POSTs to `url`. Delivery is **at-most-once**; inspect **`WebhookCall`** /
**`WebhookCallDetail`** / **`WebhookStatus`** for results. This path does **not** write anything back
into the Space — it only notifies the external system.

## Path B — run a Script (`script` Refer)

Set **`script`** (and leave `url` unset) to run a Script on the event instead of an HTTP call. This
is the **event → external call → follow-up work** pattern: the Script can call a third-party API
**and then act on the result** (write a field, create a record, ingest Media, update a counter) — all
in one ordered, server-side run. *Example:* on `Content.Publish`, a Script POSTs the item to a search
index, then `ResourcePatch`es an `indexedAt` value back onto it. (Full patterns: `weegloo-script`.)

- The Script is enqueued **async, fire-and-forget** — the Webhook does **not** poll or store the
  Script's return value. (If you need the result back, have the Script write it into Content/Media,
  or call the Script from the frontend via `/execute` and poll `requestId` — `weegloo-script`.)
- The **triggering resource becomes the Script's `payload`** (read it as `{ /payload/... }`).
- **`runAs` is attribution only, not authorization.** It sets who the resource writes are attributed
  to (`HookOwner` = the webhook's creator; `EventUser` = the user who caused the change). Under
  `EventUser`, triggers with no user — `ContentType` and `Comment` events — fall back to the creator.
- **Permissions.** Creating/editing the Webhook requires the caller's role to hold the Space's
  **webhook-settings** permission (`SETTING_WEBHOOK`, on the role's flat `settings` list — not a Content
  permission; see `weegloo-space-role`) — there is no Script-`Execute` check performed at
  webhook-save time. **A `SpaceAccessToken` cannot manage Webhooks at all**, even with `SETTING_WEBHOOK`
  on its bound role — webhook settings are outside that token's scope, so author Webhooks from a console
  session or a Personal Access Token (**`weegloo-space-access-token`**). When the Webhook fires, the linked Script runs **fire-and-forget with its
  author's delegated authority** (its inner ops are not re-checked per statement), so the **Script's
  author** must hold the unconditional Content/Media permissions the Script needs — see `weegloo-script`.
- **The link blocks deleting the Script.** While a Webhook still references it, deleting that Script
  fails. Delete the Webhook first, or repoint its `script` at another one.

## Topics & filters

- Subscribe to the **minimum** topics you need. For a "do work once per new row" flow, use a single
  topic (usually **`Content.Create`**); adding `Content.Publish` on the same Webhook double-fires.
- Filter to one ContentType (`sys.contentType.sys.id` `EQ` `<id>`) so unrelated content doesn't
  trigger it.
- **Loop protection:** a Script (or URL side effects) that changes content emits events that may fire
  other Webhooks; the platform blocks infinite create/update loops.

## MCP tools

Webhook CRUD lives in the **`extra`** MCP tool group (or **`all`**). If `cma_*Webhook*` tools are
missing, configure the Weegloo MCP with `?group=extra` or `?group=all` (project README). Use the
`cma_*` Webhook MCP tools; do not hand-call CMA HTTP for Webhooks from the agent.

## Endpoints (CMA)

`GET|POST /v1/spaces/{spaceId}/webhooks` · `GET|PUT|PATCH|DELETE /v1/spaces/{spaceId}/webhooks/{webhookId}`
(PUT full replace; PATCH RFC-6902). Monitoring/call-record endpoints also exist.

## Related

- **`weegloo-script`** — the Script that does the work a Webhook triggers (or the frontend calls directly).
- **`weegloo-space-role`** — Script `Execute` grant; async-job Content `createdBy :self` split.
- **`weegloo-create-content-type`** / **`weegloo-default-locale`** — job/result ContentType fields, locale buckets.
- **`weegloo-api-endpoints`** — base URLs, vendor JSON, OpenAPI discovery.
