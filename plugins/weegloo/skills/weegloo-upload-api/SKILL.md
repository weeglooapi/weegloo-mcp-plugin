---
name: weegloo-upload-api
description: How a product's own code uploads a file via the Weegloo Upload REST API and then creates a Media (or WebHosting) from the returned Upload reference. Covers the two-step pattern (POST to upload.weegloo.com → Upload.sys.id → CMA/ACMA Media create or WebHosting create), multipart vs binary endpoints, Bearer auth + vendor JSON, the temporary Upload resource (sys.expiresAt), CMA-vs-ACMA plane selection, and the hard line between this Upload API (for the user's product/app code) and the `weegloo-upload` MCP server (for the agent/LLM uploading local files). Use when implementing a file-upload feature in an app, or any "upload a file and attach it as Media/WebHosting" flow in product code.
---

# Weegloo — Upload API (product code) → Media / WebHosting

This skill is for **implementing a file-upload feature in the user's own product** (browser or
server code). The product **uploads bytes to the Upload API**, gets back an **`Upload` resource**,
then creates a **Media** (or **WebHosting**) that references that upload by `sys.id`.

> Base URLs, Accept/vendor-JSON rules, and OpenAPI links live in `weegloo-api-endpoints`.
> Media status / processing / "wait until Published" live in `weegloo-media-lifecycle`.
> Which identity calls which plane lives in `weegloo-service-architecture`.

## Upload API vs the `weegloo-upload` MCP — do not confuse these

These are two completely different things. Pick by **who is uploading and why**.

| | **Upload API (REST)** — THIS skill | **`weegloo-upload` MCP server** |
|---|---|---|
| Who calls it | The **product's own code** (browser `fetch` / server) | The **agent / LLM**, over MCP |
| Purpose | Implement a **file-upload feature** for end-users/admins in the app | The agent uploads a **local file** during development / content authoring |
| How | `POST https://upload.weegloo.com/v1/.../uploads[...]` | MCP tool `CreateUpload` (args: `spaceId`, absolute `filePath`) → then `cma_CreateMedia` |
| The OpenAPI says | "**Do not use this on MCP protocol**" for the REST upload endpoints | This is the MCP path; not for the product's runtime upload feature |

**Rules:**
- When **building the product's upload feature**, use the **Upload API (REST)** from app code.
  Do **not** wire the product to depend on the `weegloo-upload` MCP server.
- When **the agent itself** needs to upload a local file (e.g. seeding content, deploying a
  WebHosting ZIP during a chat), use the **`weegloo-upload` MCP** + `cma_CreateMedia` MCP — not raw REST.
- Never present the `weegloo-upload` MCP as the app's runtime upload implementation, and never tell
  the user to call the raw REST upload endpoints "via MCP".

## Step 1 — Upload the bytes (Upload API)

`Base URL: https://upload.weegloo.com/v1` · `Authorization: Bearer <token>` · omit `Accept` (vendor
JSON; see `weegloo-api-endpoints`).

Endpoints (Space scope; `organizations/{organizationId}` variants also exist):

- **Multipart** — `POST /v1/spaces/{spaceId}/uploads/multipart`
  - `Content-Type: multipart/form-data`, form field key is **`file`**.
- **Binary** — `POST /v1/spaces/{spaceId}/uploads`
  - raw binary body, **`Content-Length` header required**.

Both return **`201`** with an **`Upload`** resource:

```jsonc
{
  "sys": {
    "id": "DZBsD5JF3k3UiiXEjef",   // ← the reference used in Step 2
    "type": "Upload",
    "size": 12345,                  // bytes
    "expiresAt": "2026-01-01T00:00:00Z", // TEMPORARY — consume before this
    "owner": { "sys": { ... } },
    "createdAt": "…", "createdBy": { "sys": { ... } }
  }
}
```

- The `Upload` is **temporary**: it exists only to be consumed by a Media/WebHosting create. Create
  the Media/WebHosting **before `sys.expiresAt`**, or upload again.
- `GET /v1/spaces/{spaceId}/uploads/{uploadId}` and `DELETE /v1/spaces/{spaceId}/uploads/{uploadId}`
  are available for inspection / cleanup.

## Plan-based upload size limit — app code MUST handle it

The Space's **plan caps the per-file upload size**. The cap is **plan-policy driven** (it can be
overridden per Space), so **do not hardcode a number** as if it were universal — 50 MB is only the
conservative free-tier floor; paid tiers are larger.

- **Enforced server-side, mid-stream.** The server validates as bytes stream in, so an oversized
  file may upload partially and then fail. On exceed it returns **HTTP `429`** with error code
  **`WGL429004`** ("current Plan's max file size exceeded") — **not** a generic rate-limit, so do
  **not** blindly retry it.
- **App code MUST handle the `429` / `WGL429004` rejection** — show a clear "file too large"
  message, **tailored to who is uploading**:
  - **Weegloo User / admin (CMA path):** they can act on billing — offer compress **or** upgrade
    the plan.
  - **Service User / end-user (ACMA path):** the uploader is a **third party** who **cannot**
    change the Space's plan or see its billing. Tell them only to **reduce / compress** the file
    (ideally state the max size). Do **not** surface "upgrade your plan" or plan/billing wording to
    them — raising the cap is the **product operator's** decision, not the end-user's.
- **Recommended: client-side pre-validation.** Check `file.size` before uploading to fail fast and
  avoid a long upload that dies mid-stream. Since the exact cap is plan-specific, gate on a
  configured limit (or the free-tier floor) rather than guessing.
- Exact per-plan limits are plan-defined and may change — confirm via the docs / pricing page
  (`https://docs.weegloo.com/pricing/pricing/`), don't assume.

## Step 2a — Create a Media from the Upload

`POST https://cma.weegloo.com/v1/spaces/{spaceId}/medias` (Weegloo User) **or**
`POST https://acma.weegloo.com/v1/spaces/{spaceId}/medias` (Service User). Same body shape.

The uploaded asset is attached **per locale** under `fields.file.{locale}` via an **`upload` Refer**
to the `Upload.sys.id` from Step 1:

```jsonc
{
  "fields": {
    "title":       { "en-US": "My image" },
    "description": { "en-US": "" },
    "file": {
      "en-US": {
        "fileName":    "photo.png",
        "contentType": "image/png",
        "mimeGroups":  ["Image"],     // Attachment|Plaintext|Image|Audio|Video|RichText|Presentation|Spreadsheet|PdfDocument|Archive|Code|Markup
        "upload": { "sys": { "id": "<Upload.sys.id>", "type": "Refer", "targetType": "Upload" } }
      }
    }
  }
}
```

- Optional header **`X-Weegloo-Ignore-Publish: true`** skips auto-publish after create.
- **Verify the exact create field against the live OpenAPI** (`weegloo-api-endpoints` → CMA/ACMA
  docs). The published create schema (`TypedMediaFile`) currently lists only
  `fileName`/`contentType`/`mimeGroups`; the `upload` Refer binding shown above comes from the
  shared `File` / `IconInput` schemas (`upload: ReferUpload`). Follow the OpenAPI — do not invent
  other field names.
- After create, the platform **processes the file and auto-moves `sys.status` to `Published`** on
  success. **Do not reference the Media from Content until it is Published** and the locale
  `file.{locale}.state` is not `PENDING`/`PROCESSING`/`FAILED`. Full rules: `weegloo-media-lifecycle`.

## Step 2b — Create a WebHosting from the Upload

`POST https://cma.weegloo.com/v1/spaces/{spaceId}/web-hostings` (Weegloo User). The ZIP/tar.gz
upload (with `index.html` at root, relative asset paths) is referenced the same way:

```jsonc
{
  "name": "my-site",
  "subdomain": "my-site",
  "isSpa": true,
  "upload": { "sys": { "id": "<Upload.sys.id>", "type": "Refer", "targetType": "Upload" } }
}
```

Build-time / packaging constraints (max 100 files, static-only): see `weegloo-web-hosting`.

## Plane selection (which Media create to call)

- **Weegloo User** Bearer (admin / PAT / console FE login) → upload, then **CMA** Media create.
- **Service User** Bearer (ServiceLogin) → upload, then **ACMA** Media create (member-owned).
  Never route Service-User media through CMA. See `weegloo-service-architecture` /
  `weegloo-service-login`.

The Upload step is the **one shared surface** — both Bearers are accepted at `upload.weegloo.com`;
only the follow-up Media-create plane differs by identity.

## Checklist

1. Pick the plane by identity (Weegloo User → CMA; Service User → ACMA).
2. `POST` the bytes to the Upload API (multipart or binary). Keep `Upload.sys.id`.
3. Handle the plan size cap: pre-validate `file.size`, and on **`429` / `WGL429004`** show a
   "file too large" message — admins may compress **or** upgrade; for Service-User uploads tell the
   end-user only to compress (no "upgrade plan" wording). Don't hardcode a limit or blind-retry.
4. Create the **Media** (or **WebHosting**) referencing `upload.sys.id` **before `expiresAt`**.
5. For Media: wait until `sys.status === Published` (and file state clear) before using it from Content.
6. Building product code? Use the REST Upload API. Agent uploading a local file in-chat? Use the
   `weegloo-upload` MCP instead.

## Related

- `weegloo-api-endpoints` — base URLs, Accept/vendor JSON, OpenAPI links.
- `weegloo-media-lifecycle` — Media `sys.status`, file processing, wait-before-reference.
- `weegloo-service-architecture` — identity → API/plane selection (CMA vs ACMA Media).
- `weegloo-web-hosting` — WebHosting deploy specifics.
