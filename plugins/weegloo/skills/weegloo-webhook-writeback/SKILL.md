---
name: weegloo-webhook-writeback
description: Async external-API jobs on Weegloo using Webhook + WriteBack — job ContentType, Content.Create trigger, Transformation to call third-party APIs, WriteBack to update the same Content or ingest Media, frontend poll by sys.id. Use when integrating LLM/image/search/webhook backends, proxying user requests through Weegloo without a custom server, or designing poll-until-response flows.
---

# Weegloo — Webhook + WriteBack (async external API jobs)

## When to use

- The product must call an **external HTTP API** (LLM, image generation, moderation, search indexer, etc.) **without** hosting a dedicated backend worker.
- The user wants **“create a job → wait for result”** from the browser: frontend creates **Content**, then **polls** by `sys.id` until a **response** field is filled.
- You are provisioning **ContentType + Webhook + WriteBack** together for a new integration.

Canonical behavior and JSON examples: [Webhook — WriteBack](https://docs.weegloo.com/getting-started/core-concepts/integration-and-deployment/webhook#writeback). API shapes: CMA OpenAPI **Webhook** (via **`weegloo-api-endpoints`** docs discovery).

## Mental model

1. **Webhook** — on a Space event (e.g. `Content.Create`), Weegloo **calls your external URL** (optionally reshaped with **Transformation**).
2. **WriteBack** — if the external call returns **2xx**, Weegloo runs **`writeBacks`** to **create / update / delete** **Content** or **Media** inside the Space, using **`{ /response/... }`** (API body) and **`{ /payload/... }`** (triggering resource).
3. **Job record** — declare a **job ContentType** whose fields hold the **request** (what the user sent) and **response** (what came back). The frontend **creates** one Content row, then **polls** that row until **response** is populated.

Sensitive values (API keys) belong in Webhook **`Headers`** (secret entries), **not** in Content fields exposed to end users.

## Agent workflow (do this in order)

Copy and track:

```
- [ ] 1. Read weegloo-create-content-type + weegloo-default-locale (field types, locale buckets)
- [ ] 2. Design job ContentType (request + response fields)
- [ ] 3. cma_CreateContentType (note sys.id)
- [ ] 4. Ensure MCP exposes Webhook tools (group=extra or group=all — see below)
- [ ] 5. Create Webhook: ONE topic, filter to job ContentType, URL + secret Headers + Transformation + writeBacks
- [ ] 6. Document frontend: CMA create → poll CDA/CMA by sys.id until response set
- [ ] 7. SpaceRole: end users must not forge “completed” jobs if that matters — scope writes with **`createdBy.sys.id": ":self"`** where appropriate (**`weegloo-space-role`**; see Security)
```

### MCP tools

Webhook CRUD lives in the **`extra`** MCP tool group (or **`all`**). If tools are missing, configure the Weegloo MCP server with `?group=extra` or `?group=all` per project README — do **not** call CMA HTTP for Webhooks from the agent.

Use **`cma_*Webhook*`** MCP tools only (same rule as **`weegloo-global-rules`**).

## Step 1 — Job ContentType

Typical fields (adapt names to the product):

| Field | Type | `localized` | Role |
| --- | --- | --- | --- |
| Request input | `ShortText` / `LongText` / `RichText` | usually `false` for job state | User prompt, payload text, or parameters |
| Response | `LongText` or **`Refer` → Media** | usually `false` | External API result; empty until WriteBack runs |

- **Text APIs** — store JSON or plain text in a **LongText** `response` field via WriteBack **`$content` `update`**.
- **Binary / image APIs** — use **`Refer` (Media)** for `response`; in WriteBack set the field to **`{ "$media": { "source": "{ /response/... }", "encoding": "url" } }`** (or `base64`) so Weegloo ingests the file and stores a Media reference.

Follow **`weegloo-create-content-type`** for RichText vs LongText defaults. Follow **`weegloo-default-locale`**: on **Content create**, every populated field needs the **default locale** bucket (e.g. `"en-US": "..."`).

## Step 2 — Webhook configuration

| Setting | Guidance |
| --- | --- |
| **Topics** | Subscribe to **exactly one** topic for WriteBack flows — usually **`Content.Create`**. Do **not** also subscribe to `Content.Publish` on the same Webhook (duplicate external calls). |
| **Filters** | Restrict to the job ContentType: `doc`: `sys.contentType.sys.id`, `op`: `EQ`, `value`: `<job ContentType sys.id>`. |
| **URL** | External API endpoint. |
| **Headers** | Auth / API keys here (secret). Never put keys in client-visible Content. |
| **Transformation** | Map `{ /payload/fields/<name>/<default-locale> }` (and `{ /payload/sys/id }`) into the body/URL the external API expects. JSON Pointer syntax matches docs. |
| **writeBacks** | Almost always **`$content` `action`: `update`** with **`target` omitted** so the **triggering** Content is updated. |

WriteBack runs only on **2xx** external responses. Non-2xx → no WriteBack; `writeBackResults` stays empty.

## Step 3 — WriteBack (update triggering Content)

**Pattern A — text response on the same Content**

```json
{
  "writeBacks": [
    {
      "$content": {
        "action": "update",
        "fields": {
          "response": "{ /response/choices/0/message/content }"
        }
      }
    }
  ]
}
```

Adjust the pointer to match the real external JSON. Use literal + pointer mix when needed: `"Done: { /payload/sys/id }"`.

**Pattern B — image (or file) into a Media Refer field**

`$media` **`encoding`** must match what the external API returns:

| `encoding` | When to use | `source` pointer |
| --- | --- | --- |
| **`base64`** | **Default for image LLMs** — body contains base64 bytes (often under `b64_json`, `image`, `data`, etc.) | `{ /response/data/0/b64_json }` (adjust path to provider JSON) |
| **`url`** | Provider returns a **download URL**; Weegloo fetches the bytes | `{ /response/data/0/url }` |

`binary` is **not** supported. Strip `data:image/png;base64,` prefixes in the API response if present — the pointer must resolve to **raw base64** (or use a provider field that already does).

**B1 — base64 (typical for DALL·E-style APIs)**

```json
{
  "writeBacks": [
    {
      "$content": {
        "action": "update",
        "fields": {
          "response": {
            "$media": {
              "source": "{ /response/data/0/b64_json }",
              "encoding": "base64"
            }
          }
        }
      }
    }
  ]
}
```

**B2 — URL (provider returns a hosted image link)**

```json
{
  "writeBacks": [
    {
      "$content": {
        "action": "update",
        "fields": {
          "response": {
            "$media": {
              "source": "{ /response/data/0/url }",
              "encoding": "url"
            }
          }
        }
      }
    }
  ]
}
```

Standalone **`$media` `create`** (no Content field) uses the same `source` / `encoding` pair; optional **`title`** / **`description`** value expressions apply on create only.

- **`$content` `update`** with no **`target`** → updates the Content that fired the Webhook.
- Default **`publish`: true** on create/update → updated job Content is **published** and readable on **CDA** (see **`weegloo-cda-publish`**). Use **`publish: false`** only when the product should keep drafts.

**Alternative** — WriteBack **`create`** a *separate* result ContentType (docs examples). Prefer **single job row + update** when the frontend already holds one `sys.id` to poll.

### Locale (Transformation + WriteBack)

Job ContentTypes usually use **`localized: false`** — one value per field, always stored under the Space **default locale** bucket in CMA (see **`weegloo-default-locale`**).

| Layer | What to set |
| --- | --- |
| **Transformation** (read trigger Content) | Point at the default locale segment: `{ /payload/fields/prompt/en-US }` — replace `en-US` with the Space default locale code (`ko-KR`, etc.). |
| **Frontend Content create** | Every field value uses that same default locale key, e.g. `"fields": { "prompt": { "en-US": "a cat" } }`. |
| **WriteBack `$content` `update`** on `localized: false` fields | Omit **`locale`** — values land in the default locale automatically. |
| **WriteBack `$content` `create` / `update` on `localized: true` fields** | Set **`locale`** to a literal (`"ko-KR"`) or a pointer (e.g. `"{ /payload/sys/locale }"`) so `fields` map to the intended bucket. |
| **WriteBack `$media` `create`** | Optional **`locale`** — Locale for the ingested file and optional `title` / `description`; omit for default locale. |

CDA reads use the delivery **`locale`** query parameter as usual; job polling by `sys.id` is unchanged.

## Reference example — prompt → LLM image → poll Media field

**Goal:** User submits a **prompt**; backend calls an image LLM; frontend polls until **`response`** (Media Refer) is set.

1. **ContentType** `ImageGenerationJob` (example):
   - `prompt` — `ShortText` or `LongText`, `localized: false`
   - `response` — `Refer` → **Media**, `localized: false`
2. **Webhook**
   - Topic: **`Content.Create`**
   - Filter: `sys.contentType.sys.id` **EQ** `<ImageGenerationJob sys.id>`
   - **Transformation**: POST body `{ "prompt": "{ /payload/fields/prompt/en-US }" }` (use the space default locale code)
   - **Headers**: provider API key (secret)
3. **WriteBack**: Pattern **B1** (`encoding: base64`) unless the provider returns a URL — then Pattern **B2**. Map `source` to the provider’s base64 or URL field (e.g. `b64_json`, `image`, `data[0].url`).
4. **Frontend**
   - **Create** job Content via **CMA** (or ACMA if members create jobs — see **`weegloo-service-architecture`**).
   - Save returned **`sys.id`**.
   - **Poll** **CDA** (public site + DeliveryAccessToken) or **CMA** GET until `fields.response` references a Media (or use **`weegloo-api-query-optimization`** `sys.id` single fetch).
   - Stop polling when `response` is non-empty / Media link present; handle timeout UX in the app.

## Frontend integration notes

- **Create** returns `sys.id` immediately; external work is **asynchronous**.
- Poll interval/backoff is app-defined (e.g. 1–3s, max duration).
- Delivery read path needs a **published** job row — WriteBack update with default publish satisfies **CDA** polling.
- For **draft-only** jobs, poll **CMA** instead or set WriteBack **`publish: false`** and read via CMA.

## Pitfalls (from product docs)

| Topic | Rule |
| --- | --- |
| Topics | **One** topic per WriteBack Webhook. |
| Logic | No conditionals/loops in WriteBack — only pointer extraction. |
| Chaining | WriteBack changes emit events; other Webhooks may fire — platform blocks infinite loops on create/update. |
| Reliability | **At-most-once** — a failed mid-flight operation may be lost; design idempotent external APIs where cost matters. |
| Security | Restrict **SpaceRole** so users cannot **directly create** “finished” job rows or privileged result types. Use **`createdBy.sys.id": ":self"`** on job/result **Content** rules when members should only touch their own rows (**`weegloo-space-role`**). |
| Media | `$media` has no **`update`** action. |
| Plain-text API body | `{ /response }` is whole body; sub-paths need JSON. |

## Debugging

- Inspect **WebhookCallDetail** / **`sys.writeBackResults`** on the call (per-operation `Success` / `Failed` / `Skipped`, `targetId`).
- External non-2xx → WriteBack skipped entirely.
- Wrong JSON Pointer → field stays empty; fix Transformation or WriteBack paths against a sample response.

## Related skills

- **`weegloo-create-content-type`** — job ContentType fields
- **`weegloo-default-locale`** — create payloads and pointer paths
- **`weegloo-cda-publish`** — why CDA sees WriteBack results
- **`weegloo-api-query-optimization`** — poll single Content by `sys.id`
- **`weegloo-service-architecture`** — CMA vs ACMA for who creates jobs
- **`weegloo-delivery-access-token`** — CDA poll from the browser
- **`weegloo-space-role`** — `createdBy` / `:self` on SpaceRole rules
