---
name: weegloo-cma-json-patch
description: Weegloo CMA/ACMA updates — prefer HTTP PATCH with RFC 6902 JSON Patch over PUT for smaller payloads; PUT full or contract-based partial bodies when appropriate. Use when implementing or reasoning about document updates.
---

# Weegloo CMA / ACMA — JSON Patch and document updates

## When to use

- When updating **ContentType**, **Content**, or **Media** over **CMA** or **ACMA** REST APIs (application code or design — agents still prefer **MCP tools** where applicable).
- When choosing between **full replacement** and **partial** updates.

## Prefer `PATCH` over `PUT` for updates

**Both** **`PUT`** and **`PATCH`** are valid for updates on these APIs. **Default to `PATCH`** with **JSON Patch** whenever the change can be expressed that way.

- **Why:** you send **only the operations** that mutate the document (add/remove/replace/…), so request bodies stay **small** and you avoid **re-serializing** a full resource when a few paths changed—**better for network use** and **payload size** than a typical **`PUT`**.
- **When `PUT` is appropriate:** replacing the **entire** representation, or when the **OpenAPI contract** for that operation clearly expects a **full** (or contract-specific) body and **`PATCH`** is not the better fit.

## PATCH and [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)

- Weegloo exposes **HTTP `PATCH`** on these management APIs for **JSON Patch** documents.
- **Request header (mandatory):** set **`Content-Type: application/json-patch+json`** (RFC 6902 registration). Do not send a JSON Patch body with a generic `application/json` content type.
- The format follows **[RFC 6902 — JSON Patch](https://www.rfc-editor.org/rfc/rfc6902)**:
  - Body is a **JSON array** of operations.
  - Each operation has an **`op`**: `add`, `remove`, `replace`, `move`, `copy`, or `test`.
  - **`path`** (and **`from`** where required) use **JSON Pointer** ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)).
- Confirm the **`PATCH`** URL and any extra headers (e.g. version) per resource in **OpenAPI** (canonical API doc URLs live only in **`weegloo-api-endpoints`** — do not duplicate them here).

## PUT — full document or partial by contract

- **`PUT`** remains valid for updates.
- You may send the **full** resource value (typical “replace the representation” style).
- Alternatively, **`PUT`** may accept a **partial** payload when the **API contract** for that endpoint allows it — send **only the parts you intend to change**, as documented in Swagger for that operation.
- For **small or localized edits**, still **prefer `PATCH` + JSON Patch** (see **Prefer `PATCH` over `PUT`**) so the client sends **explicit operations** rather than a larger **`PUT`** body when **`PATCH`** can express the same change.

## Practical notes

- Apply **`X-Weegloo-Version`** (or the project’s version header) when the API requires optimistic concurrency — unchanged from other CMA write operations.
- For **field/locale paths** in pointers or patch targets, follow the **same locale and `fields.*` shapes** as in GET/PUT examples in OpenAPI.
- **Agents:** use **MCP** `cma_*` / `acma_*` tools when the user asks for console-style operations; use this skill when writing or reviewing **HTTP client code** that calls CMA/ACMA directly.

## Related

- Base URLs, Accept header, Swagger: **`weegloo-api-endpoints`** rule.
