---
name: weegloo-default-locale
description: Use when creating or updating Content in any localized or multi-language scenario, OR when a read returns undefined/empty fields and you suspect a locale-shape mismatch. Covers localized vs localized-false fields, per-locale buckets, read fallback, mandatory default-locale values on Content create, and the CDA/ACDA `locale` URL parameter shapes. Critically: management (CMA/ACMA) returns fields as per-locale buckets (`fields.x[locale]`) while delivery (CDA/ACDA) flattens to a scalar by default (`fields.x`) — for both list and single-content detail reads — plus the `include.Media` expansion shape. Use when debugging "fields.x[locale] is undefined" against CDA/ACDA.
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
3. On **read** (e.g. CDA with a `locale` query): a requested locale resolves through **its own `fallbackCode` chain**, *not* automatically to the default. Each **`Locale`** has an **optional `fallbackCode`** (an arbitrary target locale code; chainable). For a field with no value under the requested locale, the server walks `requested -> fallbackCode -> ...` and returns the **first** locale in that chain that holds a value. **If the requested locale has no `fallbackCode` (chain = itself only), a missing value stays empty and does NOT fall back to the default.** The default locale has **no special privilege on read**.
4. On **write** (**`localized: true`**): the **default locale** entry is **mandatory** when the field is populated. You cannot leave default empty and only set `fr-FR`, `ko-KR`, etc.
5. **Single locale for the whole product** (**`localized: true`**): put the value **only under the default locale**. Other requested locales resolve to it **only if their `fallbackCode` chain reaches the default**; without that, they read **empty**. Do not assume automatic fallback to the default.
6. **Read response SHAPE depends on the API plane — this is the #1 source of locale bugs.** The locale *buckets* in points 2-4 are how the **management plane (CMA / ACMA)** returns fields: **`fields.{name}` is ALWAYS a per-locale map**, so you read **`fields.{name}.{locale}`**. The **delivery plane (CDA / ACDA)** is different: by default it **flattens** to one locale, so **`fields.{name}` is the value itself** (a scalar or a Refer object) — indexing it by `[locale]` yields `undefined`. Only **`locale=*`** makes delivery return buckets. So `fields.prompt["en-US"]` is correct against CMA but **wrong** against a default CDA/ACDA read, where it must be `fields.prompt`. See *Management vs delivery* below.

## Content creation: locale presence on create

The create-time locale-presence check applies **only to `required` + `localized` fields** — and for those it requires a value under **every non-optional locale** the space defines (the space **default is always non-optional**, so it is always among them). Fields that are **not `required`** have **no** locale-presence requirement — an optional localized field may be created with only `ko-KR` (no default) and it passes.

- **Required, localized** field in a space whose non-optional locales are e.g. `en-US` (default) + `ko-KR` → you must populate **both**; "just the default" is **insufficient** (`WGL400006`). In a single-locale space (only the default is non-optional) this reduces to "populate the default."
- **`localized: false`** fields store **only** under the default-locale key — a single bucket, no other locale slot.
- **Practical default:** when unsure, always write the space **default-locale** bucket for each field you set — it satisfies the requirement for required fields and is never wrong. A **missing default bucket** on a required field is the most common create mistake.

```jsonc
// Wrong (bare scalar - a field value MUST be a per-locale map; a non-object value is rejected with CORE422007 "Unprocessable Entity")
{ "fields": { "slug": "hello-world", "title": "Hello World" } }

// Right (en-US default; same shape for localized: true AND false)
{ "fields": { "slug":  { "en-US": "hello-world" },
              "title": { "en-US": "Hello World" } } }
```

**CDA note:** delivery reads **published** snapshots only; see **`weegloo-cda-publish`** skill and **`weegloo-api-endpoints`** rule (CDA publish section).

## `localized: false` on the ContentType (locale-agnostic fields)

Use this when the stored value **never differs by locale**-same logical value for every language (e.g. opaque **IDs**, **SKUs**, or one global **Refer → Media** like a **profile thumbnail** that is not localized per language).

- **Meaning for Content writes:** the field is **not** a multi-locale map — its value belongs in the **default-locale** bucket only. A non-default key like `fields.myField["fr-FR"]` is **rejected on `PATCH`** (schema validation); on **create / PUT** it is not schema-checked, but such keys are **meaningless** (never delivered), so keep to the default bucket.
- **Meaning for reads:** the value lives in the **default bucket only**. Under a non-default **`locale=X`** read it appears **only if X's `fallbackCode` chain reaches the default**; otherwise the field reads **empty** for X. It is **not** auto-mirrored into every locale.
- **Contrast:** **`localized: true`** = per-locale copy (titles, bios); default locale still **required** when you populate the field, plus optional other locales.
- **CareerResume hindsight:** **`profileImage`** (and similar single global assets) would fit **`localized: false`** on the **resumeProfile** ContentType so editors are not pushed to duplicate the same Media refer across every locale bucket-see **`weegloo-create-content-type`** for where to set the flag in the schema.

## Delivery reads (CDA **and** ACDA) - `locale` URL parameter (read shape)

> **Applies to every delivery read, not just lists.** The **`locale`** parameter and the flattening
> below behave **identically** for **CDA and ACDA**, and for both the **list** endpoint **and the
> single-content-by-id (detail) GET** (`…/contents/{contentId}`). Do not assume "this is only about
> CDA lists" — a detail fetch on ACDA flattens exactly the same way. (Confirmed in the CDA content
> reference: list and single-content reads share one locale shape.)

Delivery endpoints accept a **`locale`** query parameter that controls **which locale(s)** appear in `fields` **and** the **shape** of `fields` in the response. This applies to Content (list and detail) and Media:

- **Content:**
  - **`GET /v1/spaces/{spaceId}/contents`** (CDA list)
  - **`GET /v1/spaces/{spaceId}/content-types/{contentTypeId}/contents`** (CDA/ACDA list)
  - **`GET /v1/spaces/{spaceId}/content-types/{contentTypeId}/contents/{contentId}`** (CDA/ACDA **detail** — same shape)
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

Example: **`?locale=en-US`**. The server returns the value **for that locale**, applying that locale's **`fallbackCode` chain** (a missing value resolves to the first locale in `requested -> fallbackCode -> ...` that holds a value; **no `fallbackCode` means it stays empty, not the default** - see step 3). The shape is still a **flat scalar** per field:

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

## Management vs delivery: where to read a field value (avoid the `[locale]` bug)

The single most common locale mistake is reading a **delivery** response with **management**-shaped
field access (or vice-versa). They are not the same:

| Plane | Endpoint examples | `fields.{name}` shape | How to read |
|-------|-------------------|-----------------------|-------------|
| **Management** — CMA / ACMA | `cma.…`, `acma.…` | **always a per-locale bucket** | `fields.{name}[locale]` |
| **Delivery** — CDA / ACDA (default, `locale` omitted or a code) | `cda.…`, `acda.…` | **flat — the value itself** | `fields.{name}` (do **NOT** index `[locale]`) |
| **Delivery** with **`locale=*`** | `cda.…?locale=*` | per-locale bucket | `fields.{name}[locale]` |

So code that does `doc.fields.prompt["en-US"]` works on CMA but returns `undefined` on a default
ACDA read — there the value is at `doc.fields.prompt`. A `localized: false` field follows the same
plane rule (bucket on management, flat on default delivery).

### Expanded references (`include`) on a delivery read

When you pass **`include`** to expand a `Refer` (e.g. an image field → a Media), the expanded
resources are returned in a **sibling `include` object on the response** (singular **`include`**,
not `includes`), keyed by **PascalCase resource type** (e.g. **`include.Media`**). The field on the
content holds only the reference (`fields.image1.sys.id`); resolve it against `include.Media` by id.
**The expanded Media's own fields obey the same flattening** — on a default delivery read the file
URL is at **`media.fields.file.url`**, **not** `media.fields.file[locale].url`. (Read the exact key
names from the actual response; do not hard-code an assumed casing without checking.)

### Defensive accessor (survives both shapes)

When a helper may run against either plane, or against an unknown `locale` mode, read locale-tolerantly
instead of assuming one shape:

```js
// Returns the value whether `fields[name]` is a flat scalar/Refer (delivery default)
// or a per-locale bucket (CMA/ACMA, or delivery with locale=*).
function readField(fields, name, locale) {
  const f = fields && fields[name];
  if (f == null) return undefined;
  // bucket only if it's a plain object that actually carries the locale key
  if (typeof f === "object" && !Array.isArray(f) && !f.sys && (locale in f)) return f[locale];
  return f; // already flat (scalar, or a Refer object with sys)
}
```

This is a guard, not a license to stay vague: still know which plane you are calling (the table
above) and prefer the correct single shape. The accessor just keeps a wrong assumption from silently
producing `undefined` everywhere.

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
