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
| `topics` | array of `"{resource}.{action}"` — resource ∈ Content / Media / ContentType; action ∈ **Create, Save, Delete, Publish, Unpublish, Archive, Unarchive** (e.g. `"Content.Create"`) |
| `filters` | narrow which events fire — by `sys.contentType.sys.id`, specific item, `createdBy`, last editor; operators `EQ` / `NE` / `IN` / regex / etc. |
| `url` | external endpoint — **mutually exclusive with `script`** |
| `script` | `Refer` → a Script to run instead of the URL — **mutually exclusive with `url`** |
| `headers` | 0–30 `WebhookHeader`s; mark auth/keys as **`secret: true`** (encrypted at rest) |
| `httpBasicUsername` / `httpBasicPassword` | optional Basic auth for the URL path |
| `transformation` | shapes the outbound request: `method` (GET/POST/PUT/DELETE/PATCH, default POST), `contentType`, `body` (JSON-Pointer templating like `{ /payload/sys/id }`), `includeBody` |
| `runAs` | **`HookOwner`** (default; the webhook's creator) or **`EventUser`** (the user who caused the change) |

**Exactly one of `url` and `script`.** Setting both, or neither, is rejected (**`WGL422061`**).

## Path A — call an external URL

Classic outbound delivery: on a matching event, Weegloo builds a payload from the triggering entity,
applies **`transformation`** (method, content type, JSON-Pointer body templating), adds `headers`
(keys as **secret**), and POSTs to `url`. Delivery is **at-most-once**; inspect **`WebhookCall`** /
**`WebhookCallDetail`** / **`WebhookStatus`** for results. This path does **not** write anything back
into the Space — it only notifies the external system.

## Path B — run a Script (`script` Refer)

Set **`script`** (and leave `url` unset) to run a Script on the event instead of an HTTP call:

- The Script is enqueued **async, fire-and-forget** — the Webhook does **not** poll or store the
  Script's return value. (If you need the result, have the Script write it into Content/Media, or
  call the Script from the frontend via `/execute` and poll `requestId` — `weegloo-script`.)
- The **triggering resource becomes the Script's `payload`** (read it as `{ /payload/... }`).
- **`runAs` is attribution only, not authorization.** It sets who the resource writes are attributed
  to (`HookOwner` = the webhook's creator; `EventUser` = the triggering user). The **only permission
  gate** is that the **Webhook's creator holds Script `Execute`** on that Script **at save time**;
  after that the linked Script runs with the author's delegated authority and its inner ops are not
  per-statement permission-checked. (So the author-of-Script must have unconditional Content/Media
  permissions — see `weegloo-script`.)

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
