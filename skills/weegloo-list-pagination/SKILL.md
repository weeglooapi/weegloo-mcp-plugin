---
name: weegloo-list-pagination
description: Weegloo list APIs return links.self, links.next, links.prev for pagination; combine with first-page query params (e.g. Media mimeGroups). Use for infinite scroll, “load more”, or iterating list endpoints.
---

# Weegloo — list pagination via `links`

## When to use

- Implementing **pagination**, **infinite scroll**, or **cursor-style “next page”** against any Weegloo **list** endpoint (medias, contents, space-memberships, etc.).
- Explaining how to avoid hand-building `skip`/`offset` when the API already returns **ready-made query strings**.

## Response shape

Successful **list** responses include a **`links`** object (alongside **`items`**, **`totalCount`**, etc.):

```json
{
  "links": {
    "self": "/v1/spaces/rNwYZmRS/medias?limit=40&order=-sys.updatedAt&..."
  }
}
```

| Key | Meaning |
|-----|---------|
| **`links.self`** | **Current** page: API path + **full query string** that reproduces this page. |
| **`links.next`** | **Next** page: path + query to fetch the **following** page. **Omitted** when there is no next page. |
| **`links.prev`** | **Previous** page: path + query for the **prior** page. **Omitted** on the first page. |

Values are typically **relative** paths starting with **`/v1/...`** (not absolute URLs).

## How to paginate

1. **First request:** call the list endpoint with your desired **`limit`**, **`order`**, filters, **`select`**, etc. (see OpenAPI — base URLs in **`weegloo-api-endpoints`**).  
   - **Media (CMA):** to restrict e.g. to images or videos, add **`fields.file.{locale}.mimeGroups={MimeGroup}`** on this first URL (allowed values and examples: **`weegloo-api-endpoints`** rule → *CMA Media list — filter by mimeGroups*).
2. **Read** `items` (and optionally `totalCount`) from the JSON body.
3. **Next page:** if **`links.next`** is present, issue **GET** to  
   **`{apiBase}{links.next}`**  
   where **`apiBase`** is the **same host** you used for the first call (e.g. CMA `https://cma.weegloo.com`, CDA, Upload—**never** mix hosts).
4. **Repeat** until **`links.next`** is **absent** / `undefined` / empty.
5. **Previous page:** same pattern with **`links.prev`** when building a “back” UI.
6. **Do not** re-parse `links.self` for forward progress unless you are **refreshing** the current page; prefer **`links.next`** for “load more”.

### Resolving the URL in code

```ts
const nextPath = body.links?.next
if (!nextPath) return // no more pages

const url = new URL(nextPath, cmaBaseUrl).href
// fetch(url, { headers: { Authorization: `Bearer ${token}` } })
```

- Use **`new URL(relative, base)`** so relative **`/v1/...`** strings become absolute.
- Preserve **auth headers** and any **client conventions** (omit `Accept: application/json` per **`weegloo-api-endpoints`**).

## Design notes for LLMs

- **Treat `links.next` / `links.prev` as opaque:** copy the string onto the correct API origin. Do not strip or “fix” parameters unless a bug is proven—the server generated them for consistency with filters and ordering.
- **`links.self`** is useful for **logging**, **caching keys**, or **re-fetching the same page** after a mutation.
- **Infinite scroll:** keep a ref to the **last** `links.next` you fetched; on scroll, `fetch` that URL, append `items`, then store the new `links.next`.
- If a codebase already uses **`Link:` response headers** for pagination, prefer **one** mechanism per endpoint as documented in OpenAPI; for JSON **`links`**, prefer **`links.next`** over duplicating logic.

## Related

- **API bases, Accept header, Media `mimeGroups` filter query:** **`weegloo-api-endpoints`** rule.
- **Example in this repo:** `lib/weegloo/cma-list-image-medias.ts` builds a first-page medias URL with **`fields.file.{locale}.mimeGroups=Image`** and uses **`links.next`** for the library grid.
