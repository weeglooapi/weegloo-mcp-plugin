---
name: weegloo-api-query-optimization
description: Reading Weegloo Content/Media lists. `select` projection is the default on every read, your own cma_GetList* MCP calls included; sys.id[in] batching instead of N GETs; sys.version before PATCH/PUT; Media mimeGroups. Master/detail UIs (history list, gallery, inbox, sidebar→item), Refer→Media resolved to an image URL, /style1../style10 thumbnail/avatar resizing. SEARCH: in-memory vs server-side, and the X-Weegloo-Advanced-Search header required for any fields.* filter/order (MCP cannot send it). Use when fetching, listing or searching content/media, on an empty fields.* filter or a slow list. 목록 조회, 검색, 썸네일, 갤러리, 이미지 크기, 타임아웃.
---

# Weegloo - query optimization for list APIs

## When to use

- Designing or reviewing **HTTP** calls to Weegloo **list** endpoints (CMA, CDA, or other documented list APIs) where **payload size**, **latency**, or **request count** matter.
- Combining **`select`** with **`include`** (reference expansion) so expanded linked resources do not bloat the response.
- Replacing **one GET-by-id** when you only need a **subset of fields**, or replacing **many GET-by-id** calls with **one filtered list**.
- Loading **`sys.id`** and **`sys.version`** before **`PATCH`** or **`PUT`** without paying for a full **single-resource GET** on each id.

Base URLs and API documentation: **`weegloo-api-endpoints`** (do not duplicate doc links here).

**Read `references/master-detail-and-media.md`** when the task is a **list/sidebar → open an item UI**
(history list, gallery, inbox, search results → item page), or when you must turn a **`Refer → Media`**
field into a **displayable image/file URL** or pick a **thumbnail size**. §6 below carries the short
form; the reference carries the full pattern, the resolution paths and the style-preset table.
Everything else in this skill is here in the spine.

---

## 1. Projection: the `select` query parameter

On **resource list** endpoints, **`select`** names which parts of each item appear in the JSON.

> **Passing it is the default, not a tuning step** — including on your own `cma_GetList*` MCP calls.
> The standing obligation and the per-purpose recipes are in the *Projection* section of
> `weegloo-global-rules`; this section is the mechanics.

### One `select` per request (comma-separated)

Pass the parameter **once** and separate the paths with commas. Repeating the key is wrong:

- **Correct:** **`?select=sys.id,fields.room,fields.price`**
- **Wrong:** **`?select=sys.id&select=fields.room&select=fields.price`**

Same shape for **`order`**.

### Include mode (whitelist)

Only the listed paths are returned:

- Example: **`?select=sys.id,fields.title`**
- Response items contain **`sys.id`** and **`fields.title`** (plus whatever the API always returns by contract-confirm in OpenAPI).

### Exclude mode (blacklist)

Prefix each path with **`-`** to **omit** that fragment:

- Example: **`?select=-sys.id,-fields.title`**
- Those fragments are **not** present in the response.

### Include and exclude are mutually exclusive

You **cannot** mix whitelist and blacklist in one **`select`**:

- **Invalid:** **`?select=sys.id,-fields.title`**

Choose **either** all-inclusive paths **or** all-negative paths for a single request.

### Object-level paths

You may select whole nested objects when the API allows it, for example:

- **`?select=sys`** - restrict or focus the **`sys`** object as a unit (exact semantics per endpoint; see Swagger).

### Interaction with `order`

If the request uses **`order`**, **every sort key** must still be **present** in the projected representation. Sorting relies on those values; **`select`** must not strip them out.

- **Include mode:** list every path that appears in **`order`** (or select a **parent** path that still contains those leaf values-confirm behavior in OpenAPI).
- **Exclude mode:** do **not** prefix any **`order`** path with **`-`** (e.g. if **`?order=sys.id,fields.name`**, avoid **`-sys.id`** or **`-fields.name`** in **`select`**).

Example: **`?order=sys.id,fields.name`** together with **`select`** → keep **`sys.id`** and **`fields.name`** reachable in the response.

### Interaction with `include` (reference expansion)

If the request uses **`?include=`** (or equivalent) so that **linked references** are **expanded** in the response, **`select`** becomes **especially important**: expansion can pull in **full linked documents** (e.g. a **Space**).

When you **do not** need those linked details:

- Prefer **`select`** to **drop** or **narrow** the corresponding branches (e.g. the **space** subtree) so that **expanded Space payloads** are not shipped unnecessarily.

Otherwise, **`include`** may undo optimization by enlarging the body with nested resource graphs.

### Scoping the ContentType for a `fields.*` filter or `order`

The flat `/contents` list needs **`sys.contentType.sys.id=<id>`** (not a bare `contentType=<id>`)
before any `fields.*` filter or sort key, alongside the locale segment — both stated in the
*Searching `fields.*`* section of `weegloo-global-rules` (`rules/weegloo-global-rules.mdc:106`).
**The delta that rule does not carry:** the requirement is a property of the **flat** path only. It
does **not** apply to the nested **`/content-types/{contentTypeId}/contents`** path, nor to
**ACMA/ACDA** (which expose only the nested form) — there the ContentType is already fixed by the URL.

---

## 2. “Single resource” shape when projection is list-only

**Projection (`select`) applies to list endpoints**, not to the dedicated **single-resource-by-id** GET in the usual sense.

To get **one** item **with** projection:

1. Call the **same list** endpoint used for collections.
2. Filter to that id: **`?sys.id={resourceId}`** (exact parameter name and filter syntax per OpenAPI-**`sys.id`** is the typical filter for a single id).
3. Add projection as needed, e.g. **`&select=sys.id`** (or any allowed **`select`** expression).

Effectively this yields **one row** (or an empty list) with **controlled fields**, analogous to a **single fetch** optimized for payload.

---

## 3. Many ids: prefer one list + `sys.id[in]` over N GETs

To load **several** resources by id:

- **Avoid:** **`N`** separate **GET single-resource** requests (worst case **`N`** round trips and **`N`** full bodies).
- **Prefer:** **one** **list** request with an **in** filter on **`sys.id`**, for example:

  **`?sys.id[in]=1,2,3,4,5`**

(Use the **documented** delimiter, parameter name, and encoding from OpenAPI-**`sys.id[in]`** is the usual pattern for “any of these ids”.)

This is generally **better for latency** (fewer requests) and **network usage** (one response envelope, optional **`select`** to cap size).

Combine with **`select`** from section 1 when you do not need full documents.

---

## 4. `sys.version` before `PATCH` or `PUT`

Updates on **CMA** / **ACMA** (and similar) usually require the **current** **`sys.version`** so the server can enforce **optimistic concurrency** (e.g. via **`X-Weegloo-Version`** or the contract in OpenAPI-see **`weegloo-cma-json-patch`**). You only need **`sys.id`** and **`sys.version`** in the read phase; you do **not** need the **dedicated single-resource GET** for that.

**Prefer the list endpoint** with a **tight `select`:**

| Goal | Suggested query (illustrative) |
|------|--------------------------------|
| **One** resource | **`?sys.id={resourceId}&select=sys.id,sys.version`** |
| **Several** resources (bulk follow-up patches) | **`?sys.id[in]=1,2,3,4,5&select=sys.id,sys.version`** |

This matches the patterns in **§2** and **§3**: list + filter + projection. Response **`items`** give you each id with its **current version** in a **small** payload-**fewer round trips** and **less data** than **`N`** full **GET-by-id** responses.

Filter syntax (**`sys.id`**, **`sys.id[in]`**, delimiters) is defined per API in **OpenAPI**.

---

## 5. Media list: filter by logical type (`mimeGroups`)

Server-side category filter on CMA `GET .../spaces/{spaceId}/medias`, the `{locale}` segment, and the
twelve allowed `MimeGroup` identifiers are all in `weegloo-api-endpoints`
(`rules/weegloo-api-endpoints.mdc:109-112`) — always loaded, not repeated here.

---

## 6. Master/detail UIs and referenced Media — short form

§2–§3 optimize **bulk** loading (one list instead of many GETs). They do **NOT** mean "render a
detail or image view straight from the list response." A **list/sidebar → open an item** UI uses the
**opposite** split, and getting this wrong is a common mistake. The four facts you need:

- **List rows: lightweight projection + a real label.** `sys.id` plus the human-readable field you
  will display (`fields.prompt`, `fields.title`). A sidebar showing only an id or a bare thumbnail
  is a defect, not an optimization.
- **Detail: fetch that ONE Content by id, lazily, on click.** A by-id GET for the item the user
  actually opened is **correct and expected** — §3's "avoid N GETs" is about a *batch* up front.
- **A `Refer → Media` is a stub, never a URL.** Resolve it (follow `sys.id`, or `?include=1` and read
  `include.Media`) — see the *References are NEVER embedded* rule
  (`rules/weegloo-global-rules.mdc:93`). Do this on the **detail** fetch, not from the list response.
- **Thumbnails: append a preset style segment to the Media file URL** — `/style1`…`/style10` =
  32 / 64 / 128 / 192 / 256 / 320 / 480 / 640 / 960 / 1024 px **max dimension**, aspect preserved,
  WebP. No arbitrary width/height/quality params. Nothing is re-uploaded.

**→ `references/master-detail-and-media.md`** has the full pattern: why list-level expansion is not
a substitute for the detail fetch, both Refer-resolution paths with the `include.<PascalCase>` shape,
how to read the file URL out of the Media, the style table with per-use-case picks (avatar / list
thumb / hero), and the two availability cases where a styled URL is not yet live.

---

## 7. Search: pick WHERE you search, and use Advanced Search for `fields.*` text

**Any filter or `order` touching a `fields.*` path needs `X-Weegloo-Advanced-Search: true`.** Without
it the match is **exact equality**, so a substring query returns an **empty list rather than an
error**; the header is also what keeps the query off an unindexed scan. Where to search (server-side
over the whole dataset vs. in-memory over a fully-loaded array), the locale segment, the speed/index
rationale, the MCP tools' inability to send the header, and RichText/Json being unsearchable are all
in the *Searching `fields.*`* section of `weegloo-global-rules`
(`rules/weegloo-global-rules.mdc:101-108`) — always loaded; deleted from here rather than restated.

**Deltas that rule does not carry:**

- **What the header unlocks beyond `contains`:** the **`regex`** operator and the geo **`near`** /
  **`within`** operators only become available with Advanced Search on.
- **"Unknown size" includes the obvious-looking cases.** *All* Media in a Space is an unknown-size
  set — the thumbnails on screen are not the whole set, so filtering them in memory is wrong even
  though it looks complete.
- Exact operator list, per-field-type support and request format are canonical at the
  query-parameters reference (linked from `weegloo-api-endpoints`). Don't guess operators.

---

## Related

- **Why this is mandatory, not tuning:** **`weegloo-minimal-load`** rule — fetch the minimum Weegloo can answer with, compute everything that needs no server-side authority on the client, and the load anti-patterns to refuse (polling loops, paging to count, N+1 by-id reads, fetch-all-then-filter).
- **Endpoints and headers:** **`weegloo-api-endpoints`** rule.
- **Pagination:** **`weegloo-list-pagination`** skill (`links.next`, first-page params).
- **PATCH/PUT, JSON Patch, version headers:** **`weegloo-cma-json-patch`** skill.
