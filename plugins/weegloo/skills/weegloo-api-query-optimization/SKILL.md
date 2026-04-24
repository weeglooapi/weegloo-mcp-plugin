---
name: weegloo-api-query-optimization
description: Weegloo list APIs — projection with select (include/exclude, object paths), list-as-single via sys.id, batch fetch with sys.id[in], prefetch sys.version for PATCH/PUT, and CMA Media mimeGroups filtering. Use to shrink payloads, avoid redundant reference expansion, and replace N single GETs with one list call.
---

# Weegloo — query optimization for list APIs

## When to use

- Designing or reviewing **HTTP** calls to Weegloo **list** endpoints (CMA, CDA, or other documented list APIs) where **payload size**, **latency**, or **request count** matter.
- Combining **`select`** with **`include`** (reference expansion) so expanded linked resources do not bloat the response.
- Replacing **one GET-by-id** when you only need a **subset of fields**, or replacing **many GET-by-id** calls with **one filtered list**.
- Loading **`sys.id`** and **`sys.version`** before **`PATCH`** or **`PUT`** without paying for a full **single-resource GET** on each id.

Base URLs and API documentation: **`weegloo-api-endpoints`** (do not duplicate doc links here).

---

## 1. Projection: the `select` query parameter

On **resource list** endpoints, use **`select`** to control which parts of each item appear in the JSON. Smaller responses mean **less network** and **lower parsing cost**.

### Include mode (whitelist)

Only the listed paths are returned:

- Example: **`?select=sys.id,fields.title`**
- Response items contain **`sys.id`** and **`fields.title`** (plus whatever the API always returns by contract—confirm in OpenAPI).

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

- **`?select=sys`** — restrict or focus the **`sys`** object as a unit (exact semantics per endpoint; see Swagger).

### Interaction with `order`

If the request uses **`order`**, **every sort key** must still be **present** in the projected representation. Sorting relies on those values; **`select`** must not strip them out.

- **Include mode:** list every path that appears in **`order`** (or select a **parent** path that still contains those leaf values—confirm behavior in OpenAPI).
- **Exclude mode:** do **not** prefix any **`order`** path with **`-`** (e.g. if **`?order=sys.id,fields.name`**, avoid **`-sys.id`** or **`-fields.name`** in **`select`**).

Example: **`?order=sys.id,fields.name`** together with **`select`** → keep **`sys.id`** and **`fields.name`** reachable in the response.

### Interaction with `include` (reference expansion)

If the request uses **`?include=`** (or equivalent) so that **linked references** are **expanded** in the response, **`select`** becomes **especially important**: expansion can pull in **full linked documents** (e.g. a **Space**).

When you **do not** need those linked details:

- Prefer **`select`** to **drop** or **narrow** the corresponding branches (e.g. the **space** subtree) so that **expanded Space payloads** are not shipped unnecessarily.

Otherwise, **`include`** may undo optimization by enlarging the body with nested resource graphs.

---

## 2. “Single resource” shape when projection is list-only

**Projection (`select`) applies to list endpoints**, not to the dedicated **single-resource-by-id** GET in the usual sense.

To get **one** item **with** projection:

1. Call the **same list** endpoint used for collections.
2. Filter to that id: **`?sys.id={resourceId}`** (exact parameter name and filter syntax per OpenAPI—**`sys.id`** is the typical filter for a single id).
3. Add projection as needed, e.g. **`&select=sys.id`** (or any allowed **`select`** expression).

Effectively this yields **one row** (or an empty list) with **controlled fields**, analogous to a **single fetch** optimized for payload.

---

## 3. Many ids: prefer one list + `sys.id[in]` over N GETs

To load **several** resources by id:

- **Avoid:** **`N`** separate **GET single-resource** requests (worst case **`N`** round trips and **`N`** full bodies).
- **Prefer:** **one** **list** request with an **in** filter on **`sys.id`**, for example:

  **`?sys.id[in]=1,2,3,4,5`**

(Use the **documented** delimiter, parameter name, and encoding from OpenAPI—**`sys.id[in]`** is the usual pattern for “any of these ids”.)

This is generally **better for latency** (fewer requests) and **network usage** (one response envelope, optional **`select`** to cap size).

Combine with **`select`** from section 1 when you do not need full documents.

---

## 4. `sys.version` before `PATCH` or `PUT`

Updates on **CMA** / **ACMA** (and similar) usually require the **current** **`sys.version`** so the server can enforce **optimistic concurrency** (e.g. via **`X-Weegloo-Version`** or the contract in OpenAPI—see **`weegloo-cma-json-patch`**). You only need **`sys.id`** and **`sys.version`** in the read phase; you do **not** need the **dedicated single-resource GET** for that.

**Prefer the list endpoint** with a **tight `select`:**

| Goal | Suggested query (illustrative) |
|------|--------------------------------|
| **One** resource | **`?sys.id={resourceId}&select=sys.id,sys.version`** |
| **Several** resources (bulk follow-up patches) | **`?sys.id[in]=1,2,3,4,5&select=sys.id,sys.version`** |

This matches the patterns in **§2** and **§3**: list + filter + projection. Response **`items`** give you each id with its **current version** in a **small** payload—**fewer round trips** and **less data** than **`N`** full **GET-by-id** responses.

Filter syntax (**`sys.id`**, **`sys.id[in]`**, delimiters) is defined per API in **OpenAPI**.

---

## 5. Media list: filter by logical type (`mimeGroups`)

On **CMA** **`GET .../spaces/{spaceId}/medias`**, add **`fields.file.{locale}.mimeGroups={MimeGroup}`** so the API returns only assets in that **category** (e.g. **`Image`**, **`Video`**, **`Audio`**, **`Code`**)—smaller **`items`** than an unfiltered list. Use the same **`{locale}`** you use for **`fields.file`** (often the space default locale).

**Allowed `MimeGroup` values** and full URL examples: **`weegloo-api-endpoints`** rule → *CMA Media list — filter by `mimeGroups`*.

---

## Related

- **Endpoints and headers:** **`weegloo-api-endpoints`** rule.
- **Pagination:** **`weegloo-list-pagination`** skill (`links.next`, first-page params).
- **PATCH/PUT, JSON Patch, version headers:** **`weegloo-cma-json-patch`** skill.
