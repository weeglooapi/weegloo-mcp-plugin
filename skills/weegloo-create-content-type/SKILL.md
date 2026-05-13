---
name: weegloo-create-content-type
description: Creates a ContentType that defines the structure of Content. Use when creating a ContentType in Weegloo.
---

# Weegloo Create ContentType

## When to use

- When creating a ContentType resource.

## Instructions
- Before creating a `Content` resource, you must first create a `ContentType` resource.
- After creating a `ContentType`, you must publish it before using it to create any `Content`.
- The characteristics of each `FieldType` are as follows:
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


## Content create payload shape (default-locale wrapping)

When creating `Content` of this `ContentType` via CMA / ACMA, **every field value is wrapped in a default-locale bucket** — even for fields declared `localized: false` on the `ContentType`. Sending a bare value yields `WGL400006 BadRequest "required property '<field>' not found"`.

Suppose the space default locale is `en-US` and the `ContentType` declares:

- `slug`  — `ShortText`, `localized: false`
- `title` — `ShortText`, `localized: true`
- `body`  — `LongText`,  `localized: false`
- `parentRevision` — `Refer → Content`, `localized: false`

The correct create body is:

```json
{
  "fields": {
    "slug":  { "en-US": "claude-code" },
    "title": { "en-US": "Claude Code" },
    "body":  { "en-US": "# Hello\n\nMarkdown body." },
    "parentRevision": {
      "en-US": {
        "sys": { "type": "Refer", "targetType": "Content", "id": "<revisionId>" }
      }
    }
  }
}
```

Common wrong shapes that fail:

```json
// WRONG: bare scalars at the field level
{ "fields": { "slug": "claude-code", "title": "Claude Code", "body": "..." } }

// WRONG: only a non-default locale provided
{ "fields": { "title": { "ko-KR": "클로드 코드" } } }
```

Notes:

- Wrapping applies uniformly to `ShortText`, `LongText`, `RichText`, scalar types, and `Refer`.
- For `localized: true` fields you may also include other locales (e.g. `{ "en-US": "...", "ko-KR": "..." }`), but the **default-locale entry is mandatory** when the field is populated.
- For `localized: false` fields, **only** the default-locale key is accepted; other locale keys are invalid for those fields.
- On read (CDA / ACDA list and get), the response shape depends on the `locale` query parameter: omit or specific locale → flat scalar; `?locale=*` → per-locale map for `localized: true` fields.

## Important
A `ContentType` must be **published** before it can be used to create `Content` resources.
