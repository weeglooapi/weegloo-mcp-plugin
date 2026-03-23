---
name: weegloo-create-content-type
description: Creates a ContentType in Weegloo. Covers localized vs localized-false fields, ShortText vs LongText vs RichText (search semantics), FieldValidation, and soft guidance. English only.
---

# Weegloo Create ContentType

## When to use

- When creating a new `ContentType` in Weegloo (via MCP `cma_CreateContentType`, then publish).
- When deciding **`localized: true` vs `false`** per field (and how that affects **Content** payloads).

## Why validations were often missing before

- This skill used to **only** describe field types. Nothing told the model to **infer** constraints from names (`start`, `url`, `sku`, …), so the default was `validations: []` everywhere.
- MCP tool schemas for `validations` often surface **only part** of the API (`message`, `dateRange`, …). The full list is in **CMA OpenAPI** — get Swagger UI and OpenAPI JSON URLs **only** from **`weegloo-api-endpoints`**; look up **`CreateContentType`** and **`FieldValidation`** there (**do not** paste Swagger or `api-docs` links in this skill).

**From now on:** avoid defaulting every field to **`validations: []`** without thought—check **`FieldValidation`** and the soft guidance below. Add constraints when the product meaning is clear; omit or keep them loose when formats are locale- or product-dependent. For **Refer → Media**, consider **media file size / mime / dimensions** when the product requires it.

---

## Core workflow

1. Before any `Content`, create the `ContentType`.
2. For **each field**, decide **`localized: true` vs `false`** (see **`localized` flag** section next)—before types and validations.
3. **Assign `ShortText` / `LongText` / `RichText` using the search-semantics section below** — not by gut feel from the words “short”, “long”, or “rich”.
4. **Design fields → add `validations` only where it clearly helps** (see soft guidance below + `FieldValidation` reference).
5. Publish the `ContentType` (`cma_PublishOneContentType`) before creating `Content`.

---

## Per-field `localized` (ContentType) — affects Content creation

This flag is part of the **ContentType** field definition. It tells Weegloo whether the field stores **one value per locale** or **a single space-wide value** (always authored under the **default locale** only).

### When to use `localized: false`

- The value is **logically identical in every locale**: stable **identifiers** (codes, UUID-like strings), or a **single global reference** that does not vary by language.
- Typical examples: internal **`id`**-like ShortText shown the same everywhere; **one profile photo** (**Refer → Media**) shared across locales; a global **attachment** that is not translated.
- **In this repo**, **`resumeProfile.profileImage`** is a good candidate for **`localized: false`**: one thumbnail, not per-locale artwork—today’s app still works with **`localized: true`**, but **`false`** avoids duplicating the same refer into every locale bucket.

### Semantics for Content / Media writes

- **`localized: false`**: when creating or updating entries, put the value **only in the default locale** key for that field. The API **does not** allow additional locale buckets for that field—**non-default locale values are rejected** (or invalid). This is stricter than “fallback”: there is simply **no** per-locale map for that field.
- **`localized: true`**: per-locale buckets; the **default locale** value is **required** when the field is populated; other locales are optional overrides (read-time **fallback** to default when missing—see **`weegloo-default-locale`** rule/skill).

### LLM checklist

- Ask: *“Could this field ever legitimately differ between `en-US` and `ko-KR`?”* **No** → strongly consider **`localized: false`**.
- Avoid **`localized: true`** + copying the **same** Media refer into every locale if **`localized: false`** fits—reduces payload size and authoring errors.

---

## Validations: default rule

For each field, ask:

1. Is the value **meant to match a known format** (date span, URL, code, phone, enum-like token)?
2. Is **length**, **numeric range**, **allowed reference targets**, or **media constraints** part of the product meaning?

If **yes** → add one or more objects to **`validations`** (and for **Array**, use **`items.validations`** for per-element rules).

If the user explicitly says “free text, any string” → you may leave `validations` empty for that field.

---

## `FieldValidation` (CMA API) — supported keys

Authoritative shape: **OpenAPI `FieldValidation`** for **`CreateContentType`** (see **`weegloo-api-endpoints`** → CMA). A single validation object may include **`message`** (user-facing) plus **one or more** of:

| Key | Purpose | Payload shape (summary) |
|-----|---------|---------------------------|
| **`regexp`** | Value must match a regex | `{ "pattern": "...", "flags": "..." }` — **`pattern` required** |
| **`prohibitRegexp`** | Value must **not** match | Same as `regexp` |
| **`size`** | String length (typical for text fields) | `{ "min": int, "max": int }` (int32) |
| **`in`** | Allow-list of permitted values | JSON array of allowed values (schema: `array`, items unconstrained in spec — use strings/numbers as appropriate) |
| **`range`** | Numeric bounds | `{ "min": number, "max": number }` — for **Number** / **Long** |
| **`dateRange`** | Instant bounds | `{ "min", "max", "after", "before" }` as **date-time** strings — for **Date** |
| **`unique`** | Uniqueness constraint | `true` / `false` |
| **`mediaMimetypeGroup`** | Allowed media categories | Array of enum: `Attachment`, `Plaintext`, `Image`, `Audio`, `Video`, `RichText`, `Presentation`, `Spreadsheet`, `PdfDocument`, `Archive`, `Code`, `Markup` |
| **`mediaImageDimensions`** | Image width/height bounds | `{ "width": { "min", "max" }, "height": { "min", "max" } }` (int32) |
| **`mediaFileSize`** | File size in bytes | `{ "min": int64, "max": int64 }` |
| **`referContentType`** | **Refer → Content** may only point at these types | Array of `{ "sys": { "type": "Refer", "id": "<contentTypeId>", "targetType": "ContentType" } }` |

**Typed variant:** Swagger also defines **`FieldValidationReferContentType`**: extends typed validation with **required** `referContentType` (+ `message`). Use the same `referContentType` array shape as above when the API expects this DTO.

Combine constraints in **one** `validations[]` element when they share the same `message`, or use **multiple** objects if you need different messages per rule.

---

## `regexp` — API shape (common mistake)

**Wrong** (400 from API):

```json
{ "regexp": "^\\d{4}\\.\\d{2}$", "message": "…" }
```

**Correct:**

```json
{
  "regexp": { "pattern": "^\\d{4}\\.\\d{2}$" },
  "message": "Use YYYY.MM only (e.g. 2022.02)."
}
```

- Escape backslashes in JSON: `\\d` not `\d`.
- Optional **`flags`** on `regexp` / `prohibitRegexp` per CMA OpenAPI `RegexpParameter` (**`weegloo-api-endpoints`**).

**Optional ShortText** (empty **or** `YYYY.MM`):

```json
{
  "regexp": { "pattern": "^$|^(\\d{4}\\.\\d{2})$" },
  "message": "Leave empty or use YYYY.MM (e.g. 2022.02)."
}
```

---

## `in` — allow-list (console: **Accept only specified values**)

For **enum-like** ShortText (including **empty string** as a permitted value), prefer **`in`** over **`regexp`**.

**Example** — optional kind: empty, `employment`, or `activity`:

```json
{
  "in": ["", "employment", "activity"],
  "message": "Leave empty, or choose employment or activity."
}
```

---

## When to consider validations (soft guidance)

Fields support **`validations`**; the CMA accepts the kinds summarized in **`FieldValidation`** above (and the full OpenAPI schema). Use them when they **match the product**—not as a checklist of generic regexes.

- **Avoid** strict **`regexp`** (or other format locks) for values that **vary by locale, convention, or legal rules** (e.g. **phone numbers**). Prefer leaving the field loose in the ContentType, or validate in the app, unless the user defines an explicit format.
- **Consider** validations when the intent is **clear and stable**: e.g. something that is obviously **email-like**, a **team-agreed date or code format**, **enum-like** choices (**`in`**), **numeric bounds** on **Number** / **Long** (**`range`**), **date bounds** on **Date** (**`dateRange`**), or **Refer** rules (**`referContentType`**, **`mediaMimetypeGroup`** / **`mediaFileSize`** / **`mediaImageDimensions`**) when the product needs them.
- If unsure, stay **conservative** (e.g. **`size`** only, or no pattern) and let the user or product spec tighten later.

---

## ShortText vs LongText vs RichText — **search semantics, not English words**

**Do not** choose these types from the everyday meaning of “short”, “long”, or “rich”. In Weegloo, they differ by **how CDA indexes and lets you query** the field. Ask: **will this Space ship a product that uses the Weegloo API to search this field?**

### Decision (use in order)

1. **`LongText`** — Use **only** when the product **will** run **CDA full-text search** (`match`-style / full-text similarity) **on this field** in real features (site search, discovery, admin search, etc.).  
   - If there is **no** planned full-text search over this field via Weegloo, **`LongText` is the wrong type** — even for paragraphs, bios, or “about” copy.

2. **`RichText`** — Use for **text that must not be full-text indexed** for Weegloo search: long copy, descriptions, article bodies, **“About” sections**, anything loaded by id/locale and **never** queried with CDA full-text on that field.  
   - **`RichText` does not mean “Markdown” or “must contain markup”** — it means **non-searchable long (or long-ish) text** in the API sense. Rich formatting in the editor is incidental.

3. **`ShortText`** — Use for values that are **short** and/or need **exact or prefix** matching in CDA (codes, slugs, one-line labels, emails-as-identifiers, etc.).  
   - If the app **never** needs keyword/prefix/exact indexing but the string is tiny and acts like an identifier, **`ShortText`** is still appropriate.  
   - If indexing/search is **never** needed and the shape is not “short identifier-like”, prefer **`RichText`** over **`ShortText`** only when **`ShortText`** would be a poor fit (e.g. unstructured paragraphs); for **very short** strings, **`ShortText`** usually stays clearer.

### Anti-patterns LLMs must avoid

- **Wrong:** “It’s a long paragraph → **`LongText`**.”  
  **Right:** “We only display it / fetch by key → **`RichText`** (unless full-text search is a real requirement).”

- **Wrong:** “**`RichText`** = Markdown field.”  
  **Right:** “**`RichText`** = **no Weegloo full-text search** on that field; naming is historical.”

- **Resume-style sites:** e.g. **`aboutBody`**, long **`description`** shown on a page with **no** CDA full-text search feature → use **`RichText`**, not **`LongText`**.

### Quick check before you finalize the `ContentType`

- List every **`LongText`** field and confirm: **“We will run CDA full-text queries against this field.”** If **no** → change design to **`RichText`** (or **`ShortText`** if it’s really a short exact/prefix field).

---

## Field types (reminder)

- **Array**: Stores multiple values in an array format.
- **Boolean**: Stored values can be used for search.
- **Date**: Stored values can be used for search.
- **Long**: Stored values can be used for search.
- **Number**: Stored values can be used for search; supports decimal numbers.
- **Refer**: Stored values can be used for search.
- **Json**: Stored values are **not indexed** and cannot be searched.
- **ShortText**: **Exact and prefix** search in CDA. Use for short identifiers, labels, codes—when that query style matches the product. See **ShortText vs LongText vs RichText** above—not every non-search field should default here if **`RichText`** fits better.
- **LongText**: **Full-text search** in CDA. Use **only** when the product **requires** full-text search on this field via the API; otherwise use **`RichText`**. Do not use **`LongText`** “because the copy is long.”
- **RichText**: **Not** full-text indexed; **not searchable** via Weegloo full-text. Use for long (or structured) body copy **without** CDA full-text search—**not** synonymous with Markdown/markup as a type rule.
- **Location**: Stored values support geographic searches such as `near` or `within`; suitable for storing latitude and longitude coordinates.

**Mapping types → `validations`:** For **Array**, define element type under **`items`**; per-element rules go in **`items.validations`**. Prefer **`dateRange`** on **Date**, **`range`** on **Number** / **Long**, **`regexp` / `prohibitRegexp` / `size` / `in` / `unique`** on text-like fields, and on **Refer** use **`referContentType`** (→ Content), or **`mediaMimetypeGroup` / `mediaFileSize` / `mediaImageDimensions`** (→ Media) when the product requires it — see **`FieldValidation`** above and **`weegloo-api-endpoints`** for CMA schema links.

---

## Important

- **Locale model** (default locale, fallback, `localized: false` writes): **`weegloo-default-locale`** rule and skill.
- A `ContentType` must be **published** before creating `Content`.
- **Updates** are **full replacement** (`cma_UpdateOneContentType`): preserve **field `id`s** and send **all** fields when editing.
- Stricter validations may break **existing** entries on next save — warn when migrating live data.
- Changing **`LongText` ↔ `RichText`** (or other type changes) on a live field is a **schema migration**—plan content re-save and app typing, not a silent rename.
