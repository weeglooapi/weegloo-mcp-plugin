# `FieldValidation` — exact payloads

Read this when you are constraining a **`Refer`** field (to Content types, or to a Media mime group /
file size / image dimensions), writing an **optional** regex, reaching for `flags`, or putting rules
on **Array elements**. The *when to validate at all*, the key list with its applies-to column, and the
`regexp`-is-an-object trap are already complete in `SKILL.md` — this page is the payload detail.

Authoritative shape: OpenAPI **`FieldValidation`** under **`CreateContentType`** (get the CMA API-docs
URL from **`weegloo-api-endpoints`**; the MCP tool schema for `validations` exposes only part of it).

## Anatomy

A field's `validations` is an **array of objects**. Each object may carry **`message`** (the
user-facing string) plus **one or more** constraint keys. Constraints that share a message belong in
**one** object; use separate objects when each rule needs its own message.

```jsonc
"validations": [
  { "size": { "min": 2, "max": 40 }, "unique": true,
    "message": "2–40 characters, and it must be unique." },
  { "prohibitRegexp": { "pattern": "\\s{2,}" },
    "message": "No double spaces." }
]
```

## Text patterns — `regexp` / `prohibitRegexp`

**ShortText / LongText only.** Both take the same object:

```jsonc
{ "pattern": "…",   // REQUIRED, max 256 characters
  "flags":   "…" }  // optional, only the characters i m u s
```

- `flags` accepts **nothing but a subset of `imus`** — `g`, `y`, `d` are rejected.
- Escape backslashes for JSON: `\\d`, `\\s`, `\\.`.
- `prohibitRegexp` inverts the test: the value must **not** match.

**An optional field still has to accept the empty string** — a bare pattern makes it de-facto
required, which is the most common regex bug here. Alternate against `^$`:

```json
{ "regexp": { "pattern": "^$|^(\\d{4}\\.\\d{2})$" },
  "message": "Leave empty or use YYYY.MM (e.g. 2022.02)." }
```

For an **enum-like** value prefer `in` over a regex — it takes `""` as a plain member of the list and
produces a far better console experience (it renders as *Accept only specified values*).

## `size`, `in`, `range`, `dateRange`, `unique`

| Key | Payload | Notes |
|---|---|---|
| `size` | `{ "min": int64, "max": int64 }` | Both Long, bounded to the JS safe-integer range (±9007199254740991). Measures **string characters** on ShortText / LongText / RichText, **element count** on Array, and the **serialized** form on Json. It can only **narrow** the type's platform maximum — never raise it. |
| `in` | JSON array of allowed values | Strings for ShortText / LongText, **numbers** for Long / Number. `""` is a legal member. |
| `range` | `{ "min": number, "max": number }` | Number / Long only. |
| `dateRange` | `{ "min", "max", "after", "before" }` | Date only; every value is a **date-time string**. `min`/`max` are inclusive bounds, `after`/`before` exclusive. |
| `unique` | `true` / `false` | ShortText / Long / Number / Date only — **rejected on LongText and RichText**, which is the usual reason a "unique slug" model fails: a slug must be `ShortText`. |

## `Refer → Content` — `referContentType`

The array-of-Refer-objects payload is in `SKILL.md`. Two things it does not say:

- Swagger defines a typed DTO **`FieldValidationReferContentType`** — the same validation with
  `referContentType` **required** (plus `message`). Where the API expects that DTO, send exactly the
  same array shape; there is no second format.
- On an **`Array` of `Refer`**, the restriction belongs in **`items.validations`** (see below), not
  on the Array field itself. Listing several ContentTypes in the array is an **OR**: the reference
  may point at any one of them.

## `Refer → Media` — the three media constraints

These apply only to a `Refer` whose `targetType` is `Media`, and only when the product genuinely
requires the constraint. Over-tightening them turns an ordinary upload into an unexplained rejection.

```jsonc
{ "mediaMimetypeGroup": ["Image"] }                                   // allowed categories
{ "mediaFileSize": { "min": 0, "max": 5242880 } }                     // BYTES (int64) — 5 MB here
{ "mediaImageDimensions": { "width":  { "min": 200, "max": 4000 },    // pixels (int32)
                            "height": { "min": 200, "max": 4000 } } }
```

`mediaMimetypeGroup` takes an array of these exact enum identifiers:

`Attachment` · `Plaintext` · `Image` · `Audio` · `Video` · `RichText` · `Presentation` ·
`Spreadsheet` · `PdfDocument` · `Archive` · `Code` · `Markup`

(The same identifiers are the values of the CMA Media-list `mimeGroups` filter.)
`mediaImageDimensions` is meaningful only for image media — pairing it with a
`mediaMimetypeGroup: ["Image"]` keeps the failure mode legible.

## `Array` — per-element rules live under `items`

An `Array` field declares its element type in **`items`**, and rules on each **element** go in
**`items.validations`**. Rules on the Array *itself* (`size` = how many elements) stay in the field's
own `validations`.

```jsonc
{
  "apiName": "tags", "type": "Array",
  "validations": [ { "size": { "max": 10 }, "message": "Up to 10 tags." } ],
  "items": {
    "type": "ShortText",
    "validations": [ { "in": ["news", "guide", "release"] } ]
  }
}
```

The platform caps an Array at **64** elements whatever `size` says.

## Which validation is legal on which type

| Type | Accepts |
|---|---|
| ShortText | `size`, `in`, `unique`, `regexp`, `prohibitRegexp` |
| LongText | `size`, `in`, `regexp`, `prohibitRegexp` (**no `unique`**) |
| RichText | `size` only |
| Long / Number | `range`, `in`, `unique` |
| Date | `dateRange`, `unique` |
| Json | `size` (on the serialized form) |
| Array | `size`; element rules in `items.validations` |
| Refer → Content | `referContentType` |
| Refer → Media | `mediaMimetypeGroup`, `mediaFileSize`, `mediaImageDimensions` |
| Boolean / Location | — |

Sending a key the type does not accept is a **400**, not a silently ignored rule.

## Tightening validations on a live ContentType

A stricter validation is **not** applied retroactively, but it **blocks the next save** of every
existing entry that violates it — an editor opening an old row gets a rejection they cannot explain.
Before tightening on live data: find the offending entries first, migrate their values, then tighten.
