---
name: weegloo-api-query-optimization
description: Weegloo list APIs — projection with select (include/exclude, object paths), list-as-single via sys.id, and batch fetch with sys.id[in]. Use to shrink payloads, avoid redundant reference expansion, and replace N single GETs with one list call.
---

# Weegloo — query optimization for list APIs

## When to use

- Designing or reviewing **HTTP** calls to Weegloo **list** endpoints (CMA, CDA, or other documented list APIs) where **payload size**, **latency**, or **request count** matter.
- Combining **`select`** with **`include`** (reference expansion) so expanded linked resources do not bloat the response.
- Replacing **one GET-by-id** when you only need a **subset of fields**, or replacing **many GET-by-id** calls with **one filtered list**.

Base URLs and Swagger: **`weegloo-api-endpoints`** (do not duplicate `api-docs` links here).

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

## Related

- **Endpoints and headers:** **`weegloo-api-endpoints`** rule.
- **Pagination:** **`weegloo-list-pagination`** skill (`links.next`, first-page params).
