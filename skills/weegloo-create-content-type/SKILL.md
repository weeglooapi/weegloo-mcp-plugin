---
name: weegloo-create-content-type
description: Creates a ContentType in Weegloo. Use when defining a new ContentType; apply validations when product meaning is clear (FieldValidation + soft guidance in the skill)—not a blanket requirement on every field. Skill text and examples are English-only.
---

# Weegloo Create ContentType

## When to use

- When creating a new `ContentType` in Weegloo (via MCP `cma_CreateContentType`, then publish).

## Why validations were often missing before

- This skill used to **only** describe field types. Nothing told the model to **infer** constraints from names (`start`, `url`, `sku`, …), so the default was `validations: []` everywhere.
- MCP tool schemas for `validations` often surface **only part** of the API (`message`, `dateRange`, …). The full list is in **CMA Swagger** — see [CreateContentType](https://cma.weegloo.com/v1/swagger-ui/index.html#/About%20ContentType/CreateContentType) and the `FieldValidation` schema in [`/v1/swagger/v3/api-docs`](https://cma.weegloo.com/v1/swagger/v3/api-docs).

**From now on:** avoid defaulting every field to **`validations: []`** without thought—check **`FieldValidation`** and the soft guidance below. Add constraints when the product meaning is clear; omit or keep them loose when formats are locale- or product-dependent. For **Refer → Media**, consider **media file size / mime / dimensions** when the product requires it.

---

## Core workflow

1. Before any `Content`, create the `ContentType`.
2. **Design fields → add `validations` only where it clearly helps** (see soft guidance below + `FieldValidation` reference).
3. Publish the `ContentType` (`cma_PublishOneContentType`) before creating `Content`.

---

## Validations: default rule

For each field, ask:

1. Is the value **meant to match a known format** (date span, URL, code, phone, enum-like token)?
2. Is **length**, **numeric range**, **allowed reference targets**, or **media constraints** part of the product meaning?

If **yes** → add one or more objects to **`validations`** (and for **Array**, use **`items.validations`** for per-element rules).

If the user explicitly says “free text, any string” → you may leave `validations` empty for that field.

---

## `FieldValidation` (CMA API) — supported keys

Authoritative shape: **OpenAPI `FieldValidation`** on [Create ContentType](https://cma.weegloo.com/v1/swagger-ui/index.html#/About%20ContentType/CreateContentType). A single validation object may include **`message`** (user-facing) plus **one or more** of:

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
- Optional **`flags`** on `regexp` / `prohibitRegexp` per Swagger `RegexpParameter`.

**Optional ShortText** (empty **or** `YYYY.MM`):

```json
{
  "regexp": { "pattern": "^$|^(\\d{4}\\.\\d{2})$" },
  "message": "Leave empty or use YYYY.MM (e.g. 2022.02)."
}
```

---

## When to consider validations (soft guidance)

Fields support **`validations`**; the CMA accepts the kinds summarized in **`FieldValidation`** above (and the full OpenAPI schema). Use them when they **match the product**—not as a checklist of generic regexes.

- **Avoid** strict **`regexp`** (or other format locks) for values that **vary by locale, convention, or legal rules** (e.g. **phone numbers**). Prefer leaving the field loose in the ContentType, or validate in the app, unless the user defines an explicit format.
- **Consider** validations when the intent is **clear and stable**: e.g. something that is obviously **email-like**, a **team-agreed date or code format**, **enum-like** choices (**`in`**), **numeric bounds** on **Number** / **Long** (**`range`**), **date bounds** on **Date** (**`dateRange`**), or **Refer** rules (**`referContentType`**, **`mediaMimetypeGroup`** / **`mediaFileSize`** / **`mediaImageDimensions`**) when the product needs them.
- If unsure, stay **conservative** (e.g. **`size`** only, or no pattern) and let the user or product spec tighten later.

---

## Field types (reminder)

- **Array**: Stores multiple values in an array format.
- **Boolean**: Stored values can be used for search.
- **Date**: Stored values can be used for search.
- **Long**: Stored values can be used for search.
- **Number**: Stored values can be used for search; supports decimal numbers.
- **Refer**: Stored values can be used for search.
- **Json**: Stored values are **not indexed** and cannot be searched.
- **ShortText**: Stored values support only exact or prefix search; suitable for storing product codes or similar identifiers.
- **LongText**: Stored values support full-text search; suitable for storing titles, descriptions, or long text content.
- **RichText**: Stored values are **not indexed** and cannot be searched; suitable for article bodies or content where search is not required.
- **Location**: Stored values support geographic searches such as `near` or `within`; suitable for storing latitude and longitude coordinates.

**Mapping types → `validations`:** For **Array**, define element type under **`items`**; per-element rules go in **`items.validations`**. Prefer **`dateRange`** on **Date**, **`range`** on **Number** / **Long**, **`regexp` / `prohibitRegexp` / `size` / `in` / `unique`** on text-like fields, and on **Refer** use **`referContentType`** (→ Content), or **`mediaMimetypeGroup` / `mediaFileSize` / `mediaImageDimensions`** (→ Media) when the product requires it — see **`FieldValidation`** above and [CMA Swagger](https://cma.weegloo.com/v1/swagger-ui/index.html#/About%20ContentType/CreateContentType).

---

## Important

- A `ContentType` must be **published** before creating `Content`.
- **Updates** are **full replacement** (`cma_UpdateOneContentType`): preserve **field `id`s** and send **all** fields when editing.
- Stricter validations may break **existing** entries on next save — warn when migrating live data.
