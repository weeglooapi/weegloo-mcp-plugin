---
name: weegloo-default-locale
description: Use when creating or updating Content in any localized or multi-language scenario. Covers localized vs localized-false fields, per-locale buckets, read fallback, mandatory default-locale values on Content create, and the CDA `locale` URL parameter shapes.
---

# Weegloo - default locale and localized fields

## When to use

- Creating or updating **Content** or **Media** with localized fields (CMA, MCP, or app code)-including **Content create** payloads where **every field** must include the **default locale** bucket.
- Explaining why a value appears even when the “requested locale” was empty.
- Designing **single-language** apps that still must write the **default locale** bucket.
- Reviewing helpers that **duplicate** values into default + active locale (e.g. resume app create/merge).
- Choosing **`localized: true` vs `false`** when defining a **ContentType** field.

## Mental model

1. **Default locale** is a **space-level** setting: one of the space’s locales is marked **default**.
2. Each **`localized: true`** **field** is a map of **locale code → value** (locale buckets), not a single scalar at the field root.
3. On **read** (e.g. CDA with a `locale` query): for **`localized: true`** fields, if the requested locale has **no** entry, the API **falls back** to the **default locale’s** value when one exists.
4. On **write** (**`localized: true`**): the **default locale** entry is **mandatory** when the field is populated. You cannot leave default empty and only set `fr-FR`, `ko-KR`, etc.
5. **Single locale for the whole product** (**`localized: true`**): put the value **only under the default locale**; other requested locales still resolve via **fallback** (step 3).

## Content creation: default locale on every field

When **creating** **Content** (CMA / MCP), **each field** in the payload must include a value under the space **default locale**.

- If the space default is **`en-US`**, then for **every** field you set, the **`en-US`** bucket must exist (e.g. **`fields.title["en-US"]`**, **`fields.body["en-US"]`**, … for **`localized: true`** fields). You cannot create a document that only fills **`ko-KR`** or **`fr-FR`** while leaving **`en-US`** empty for those fields.
- **`localized: false`** fields still store **only** under the default locale in CMA-there is no separate “other locale” slot; the same **default-locale** rule applies as a **single** bucket.
- This is **stricter than “populate default when you touch a field”** in the abstract: **create** is where editors and integrations most often miss the default bucket-validate or merge so **default locale is always written** for each field in the create body.

```jsonc
// Wrong (bare scalar - returns WGL400006 "required property '<field>' not found")
{ "fields": { "slug": "hello-world", "title": "Hello World" } }

// Right (en-US default; same shape for localized: true AND false)
{ "fields": { "slug":  { "en-US": "hello-world" },
              "title": { "en-US": "Hello World" } } }
```

**CDA note:** delivery reads **published** snapshots only; see **`weegloo-cda-publish`** skill and **`weegloo-api-endpoints`** rule (CDA publish section).

## `localized: false` on the ContentType (locale-agnostic fields)

Use this when the stored value **never differs by locale**-same logical value for every language (e.g. opaque **IDs**, **SKUs**, or one global **Refer → Media** like a **profile thumbnail** that is not localized per language).

- **Meaning for Content writes:** the field is **not** a multi-locale map. CMA only allows a value in the **default locale** bucket for that field. You **cannot** set `fields.myField["fr-FR"]` etc.; non-default locale keys are invalid for that field.
- **Contrast:** **`localized: true`** = per-locale copy (titles, bios); default locale still **required** when you populate the field, plus optional other locales.
- **CareerResume hindsight:** **`profileImage`** (and similar single global assets) would fit **`localized: false`** on the **resumeProfile** ContentType so editors are not pushed to duplicate the same Media refer across every locale bucket-see **`weegloo-create-content-type`** for where to set the flag in the schema.

## CDA list endpoints - `locale` URL parameter (read shape)

CDA **list** endpoints accept a **`locale`** query parameter that controls **which locale(s)** appear in `fields` **and** the **shape** of `fields` in the response. This applies to **both** Content and Media list endpoints:

- **Content lists:**
  - **`GET /v1/spaces/{spaceId}/contents`**
  - **`GET /v1/spaces/{spaceId}/content-types/{contentTypeId}/contents`**
- **Media list:**
  - **`GET /v1/spaces/{spaceId}/medias`**

Three modes, with **the same semantics** for Content and Media:

### 1. `locale` omitted - space **default locale**

The server resolves to the **space default locale** and returns a **flat scalar** per field (no locale map):

```json
"fields": {
  "title": "Hello, World"
}
```

### 2. `locale={code}` - single locale, **with fallback**

Example: **`?locale=en-US`**. The server returns the value **for that locale**, applying the space’s **fallback chain** (typically falling back to the **default locale** when a `localized: true` field has no entry for the requested locale-see *Read path and fallback*). The shape is still a **flat scalar** per field:

```json
"fields": {
  "title": "Hello, World"
}
```

### 3. `locale=*` - **all locales**, **no fallback**

Example: **`?locale=*`**. The server returns **every locale’s** stored value for `localized: true` fields as a **per-locale map**. **No fallback** is applied-locales without a stored value are **absent** from the map:

```json
"fields": {
  "title": {
    "en-US": "Hello World",
    "ko-KR": "안녕, 세상!"
  }
}
```

### Picking the mode

- **Single-language UI / SSG export:** use **option 1 or 2**. Code can read **`fields.<id>`** as a scalar without a locale lookup.
- **Multi-language UI on one page** (language switcher with no extra fetch, locale picker, admin previews): use **`?locale=*`** and read **`fields.<id>[<localeCode>]`**. Be ready for **missing entries** (no fallback).
- **`localized: false` fields:** there is no per-locale split to expand-those fields are stored under the **default locale only** (see *`localized: false`* section). Treat the response shape per the API contract; do not expect a multi-locale map for them under `locale=*`.
- **Pagination, `select`, `order`:** the `locale` choice is **orthogonal**-keep `locale` consistent across `links.next` calls so the response shape does not change mid-iteration (see **`weegloo-list-pagination`** and **`weegloo-api-query-optimization`**).

## Why “fallback” does not relax writes

For **`localized: true`**, fallback answers: *“What do readers see if `locale X` is missing?”*  
It does **not** mean: *“You can omit the default locale on create.”*  
The canonical source for “this field has content” remains **default locale + optional overrides** per other locales.

## Practical authoring (MCP / CMA)

- Resolve **default locale** first (`cma_GetListLocales`, space settings, or your app’s `cmaResolveDefaultSpaceLocale`).
- For every **`localized: true`** field you set, ensure **`fields.<id>.<defaultLocale>`** is non-empty when the field is required for your use case. For **`localized: false`**, only **`fields.<id>.<defaultLocale>`** exists for writes.
- When the user edits in **non-default** locale, many apps **copy the same value** into both **active** and **default** buckets on create so CMA always sees a default-locale value-mirror that pattern unless the product explicitly supports true multi-locale copy.

## This repository (CareerResume)

- **`lib/weegloo/cma-content-items.ts`** - `toLocalizedFieldsForCreate`: if active locale **is** the default, only the default bucket is sent; if not, the same scalar is written to **both** active and default buckets so the default is never left empty.
- **`lib/weegloo/cma-update-content.ts`** - Media **Refer** updates use the **default** locale bucket (`resolveDefaultLocale` + merge) because Refer targets follow the same locale-bucket rules.
- **`lib/weegloo/cda-client.ts`** - list/read calls pass a **`locale`** (from env / `getWeeglooLocale()`); missing per-locale values are still subject to **Weegloo’s default-locale fallback** on the server.

## Related

- **Rule (concise invariants):** `weegloo-default-locale` (`.cursor/rules/weegloo-default-locale.mdc`).
- **ContentType field design (`localized`, types, validations):** `weegloo-create-content-type` skill.
- **HTTP / Swagger:** `weegloo-api-endpoints` rule (locale in `fields.*` paths and query params).
- **CDA shows published content only:** **`weegloo-cda-publish`** skill.
