---
name: weegloo-create-content-type
description: Create or design a Weegloo ContentType: content modeling, schema/field design, choosing a field's type. Covers localized vs non-localized fields, ShortText vs LongText vs RichText (search semantics), FieldValidation, publishWithAuthor, displayField (console label), Refer relationships, and the platform hard limits on field count and value length, so it also answers how long a field value may be or how many fields/array items are allowed. Use when modeling content for a new app, defining fields/schema, picking a type for a note/post body, or before finalizing ANY ContentType. 콘텐츠 타입, 스키마/필드 설계, 데이터 모델링, 필드 타입, 다국어 필드.
---

# Weegloo Create ContentType

Use this when creating a `ContentType` (MCP `cma_CreateContentType` — **auto-publishes on create**),
when designing a schema, or when picking a field's type / `localized` flag.

## Core workflow

1. Before any `Content`, create the `ContentType`.
2. For **each field**, decide **`localized: true` vs `false`** — *before* types and validations.
3. Assign the **text type** by **search semantics**, not by the words "short"/"long"/"rich", then
   check the copy against **Hard limits** — a `ShortText` stops at **64** characters.
4. Add **`validations`** where the product meaning is clear; leave them off where it is not.
5. Set **`displayField`** to the `apiName` of a `ShortText` field. Do not leave it out.
6. Decide **`publishWithAuthor`** now — it is not retroactive.
7. `cma_CreateContentType` / `cma_UpdateOneContentType` / `cma_PatchOneContentType` all
   **auto-publish on success** — no separate `cma_PublishOneContentType` call in the standard
   create/edit flow. Call it directly only to recover a non-Published type (after an explicit
   `Unpublish`, or a Draft left by a create/edit whose chained publish failed).

---

## Text type: ShortText vs LongText vs RichText — search semantics

**Default text field type: `RichText`.** These three types do **not** differ by how long the copy is.
They differ by **how CDA indexes and lets you query** the field. The question is always:
***will this Space ship a product that runs Weegloo full-text search on this field?***

### Decision (in order)

1. **`LongText`** — **only** when the product **will** run **CDA full-text search** (`match`-style /
   full-text similarity) **on this field** in real features (site search, discovery, admin search).
   No planned full-text search over this field via Weegloo ⇒ **`LongText` is the wrong type**, even
   for paragraphs, bios or "about" copy.
2. **`RichText`** — long or long-ish copy that is **loaded by id/locale and never full-text queried**:
   article bodies, descriptions, "About" sections. **`RichText` does not mean "Markdown" and does not
   require markup** — it means *non-searchable text* in the API sense. Editor formatting is incidental.
3. **`ShortText`** — short values needing **exact or prefix** matching (codes, slugs, one-line labels,
   emails-as-identifiers), and tiny identifier-like strings even when never searched. For unstructured
   paragraphs prefer `RichText`; for very short strings `ShortText` stays clearer.

### Do NOT pick LongText because

- the field stores long content;
- the field is called "body" / "description" / "article";
- "blogs usually need search".

These rationalizations contradict this skill. If you are about to use one, stop and either ask the
user *"will you run CDA full-text search on this field?"* or default to `RichText`. Migration
RichText → LongText is possible later; defaulting to LongText without need burns API capacity and
forces a re-migration.

**Before finalizing:** list every `LongText` field and confirm *"we will run CDA full-text queries
against this field."* If no → change it to `RichText` (or `ShortText` if it is really a short
exact/prefix field).

---

## Hard limits — field count and value length (platform-enforced)

These are **platform-enforced bounds, not style advice**: a `ContentType` or `Content` write that
exceeds one is **rejected**. Every number below counts **characters (string length), not bytes** —
Hangul and other CJK characters count as **one** each. A value limit applies **per value**, i.e. to
**each locale bucket** of a `localized: true` field, not to the sum across locales.

| Limit | Max | What it bounds |
|---|---|---|
| **Fields per ContentType** | **80** | Field definitions a single `ContentType` may declare. |
| **`ShortText`** value | **64** | Longer copy is **not** a ShortText with a looser validation — it must be **`LongText`** or **`RichText`**. |
| **`LongText`** value | **5,120** | The only text type that is **full-text searchable** (via Advanced Search). |
| **`RichText`** value | **204,800** | The largest text type — and it **supports no search of any kind**. |
| **`Json`** value | **5,120** | Measured on the **serialized** JSON, not on key or entry count. |
| **`Array`** items | **64** | Element count, whatever the element type (including `Refer`). |

**What this forces on the design**

- **Picking a text type is two questions, not one** — search semantics (above) **and** whether the
  copy fits. Copy that can exceed **5,120** characters cannot be `LongText` however badly the product
  wants full-text search on it: it becomes **`RichText`** (and is then unsearchable), or it gets
  split across fields or entries.
- **A `size` validation can only tighten these, never raise them.** `{"size": {"max": 500}}` on a
  ShortText is a valid narrowing; `{"max": 5000}` does **not** buy a 5,000-character ShortText.
- **80 fields is a modeling ceiling, and a type nearing it is usually several types.** Split it and
  link the parts with **`Refer`** (see *Model relationships as Refer*).
- **A list that can grow past 64 items is not an `Array`.** Model those as separate `Content` entries
  that point back with a **`Refer`**, not as an ever-longer array on one entry.

---

## The other field types

| Type | Search behaviour | Notes |
|---|---|---|
| **Boolean** | searchable | |
| **Long** | searchable | integer |
| **Number** | searchable | supports decimals |
| **Date** | searchable | see value format below |
| **Refer** | searchable by target id | points at `Content` or `Media` |
| **Location** | geo search (`near`, `within`) | latitude / longitude |
| **Array** | per element type | element type goes under **`items`**; per-element rules in **`items.validations`** |
| **Json** | **not indexed, not searchable** | |

(Text types and every max are in **Hard limits** above — do not restate them per type.)

---

## Per-field `localized` — decide it first

This flag is part of the **ContentType** field definition: it says whether the field stores **one
value per locale** or **a single space-wide value** authored under the **default locale** only.

**The design-time question:** *"Could this field ever legitimately differ between `en-US` and
`ko-KR`?"* **No → `localized: false`.**

Choose **`localized: false`** for values that are **logically identical in every locale**: stable
identifiers (codes, UUID-like strings, slugs), and a **single global reference** that is not
translated — one profile photo or attachment as a **`Refer → Media`** shared across locales. Copying
the *same* Media refer into every locale bucket is the anti-pattern `localized: false` exists to stop;
it inflates every payload and multiplies authoring mistakes.

Choose **`localized: true`** only where the value is genuinely translated copy.

> The **write and read semantics** of both settings (default-locale bucket rules, what `required` +
> `localized` demands on Content create, `fallbackCode` behaviour) are already stated in the
> always-loaded locale rule — `plugins/weegloo/rules/weegloo-default-locale.mdc:13-16` — and in full
> in the **`weegloo-default-locale`** skill. Do not re-derive them here.

---

## Field flags: `required` and `disabled` (top-level, not validations)

Beyond `type` / `localized` / `validations`, each field definition carries two **top-level booleans**
(siblings of `type`, **not** entries in `validations`):

- **`required`** (default `false`) — makes the field **mandatory**. There is **no "required"
  validation type**; mandatoriness is this flag. For a `required` **localized** field, Content create
  must supply a value for **every non-optional locale** (see `weegloo-default-locale`). A
  non-`required` field has **no** locale-presence requirement.
- **`disabled`** (default `false`) — disables the field without deleting it.

---

## `displayField` — the console label (stop omitting it)

`displayField` is a **top-level string on the ContentType** (sibling of `name` / `fields` /
`publishWithAuthor`), and its value is the **`apiName`** of the field the console shows as each
entry's label. It is **optional in the schema — which is exactly why it keeps getting left out**,
leaving an entry list the user cannot read at a glance.

**Rule:** if the ContentType has any **`ShortText`** field, set `displayField` to that field's
`apiName`. With several, pick the one that names the entry (`title`, `name`, …); otherwise take the
first `ShortText` field. Omit `displayField` **only** when the type has **no** `ShortText` field.

Resend it on every edit — `cma_UpdateOneContentType` is **full replacement**, so an update that drops
`displayField` clears the label.

---

## Validations — when, and the shape that trips everyone

**Do not default every field to `validations: []`, and do not bolt a generic regex onto everything
either.** Infer constraints from the field's meaning and name (`start`, `url`, `sku`, …), then:

- **Add** one when the intent is **clear and stable** — enum-like choices (`in`), numeric bounds on
  Number/Long (`range`), date bounds on Date (`dateRange`), a team-agreed code format, uniqueness, or
  a `Refer` restriction.
- **Leave it loose** when the format varies by **locale, convention or legal rules** (phone numbers
  are the classic) — validate in the app instead, unless the user defined an explicit format.
- If unsure, stay conservative (`size` only, or nothing) and let the spec tighten it later.
- If the user says "free text, any string", `validations` stays empty for that field.

### The keys

| Key | Applies to | Payload |
|---|---|---|
| **`size`** | ShortText / LongText / RichText / Array / Json | `{ "min", "max" }` — char length or element count; **narrows only** |
| **`in`** | ShortText / LongText / Long / Number | array of allowed values (strings **or** numbers) |
| **`range`** | Number / Long | `{ "min", "max" }` |
| **`dateRange`** | Date | `{ "min", "max", "after", "before" }` as date-time strings |
| **`unique`** | ShortText / Long / Number / Date | `true` / `false` — **rejected** on LongText / RichText |
| **`regexp`** / **`prohibitRegexp`** | ShortText / LongText | `{ "pattern": "...", "flags": "..." }` — **an object, see below** |
| **`referContentType`** | Refer → Content | array of ContentType refer objects |
| **`mediaMimetypeGroup`** / **`mediaFileSize`** / **`mediaImageDimensions`** | Refer → Media | see `references/field-validations.md` |

Any validation object may also carry **`message`** (user-facing). Combine constraints in **one**
`validations[]` element when they share a message; use separate objects for different messages.

### `regexp` is an OBJECT, not a string

```json
{ "regexp": "^\\d{4}\\.\\d{2}$", "message": "…" }                      // ❌ 400 from the API

{ "regexp": { "pattern": "^\\d{4}\\.\\d{2}$" },                        // ✅
  "message": "Use YYYY.MM only (e.g. 2022.02)." }
```

Escape backslashes in JSON (`\\d`, not `\d`). For an **enum-like** ShortText prefer `in` over a
regex — it accepts the empty string as a permitted value:

```json
{ "in": ["", "employment", "activity"],
  "message": "Leave empty, or choose employment or activity." }
```

`referContentType` is likewise an array of **Refer objects**, not of id strings:

```json
{ "referContentType": [
    { "sys": { "type": "Refer", "id": "<contentTypeId>", "targetType": "ContentType" } } ] }
```

> **Read `references/field-validations.md`** when you need the exact payload of a key not spelled out
> above — in practice: constraining a **`Refer → Media`** field (mime group / file size / image
> dimensions), writing a **`referContentType`** restriction, an **optional** regex field, `flags` and
> the `pattern` length cap, or `items.validations` on an Array. Everything the ordinary create needs
> is already on this page.

**MCP tool schemas for `validations` surface only part of the API.** The authoritative shape is the
CMA OpenAPI `FieldValidation` / `CreateContentType` — get the API-docs URL from
**`weegloo-api-endpoints`**, never from a pasted link.

---

## Field value formats (for the Content you create next)

- **RichText**: value is a **string**. Any string content (plain text, markdown, HTML — product's
  choice). Do **not** send a JSON object such as `{ "type": "doc", "content": [...] }`.
- **Date**: an **ISO 8601 datetime string in UTC** — `"2026-05-28T00:00:00.000Z"`. Only the `Z`
  suffix is accepted. Not a date-only string (`"2026-05-28"`), not a timestamp (`1716854400000`), not
  an offset (`+09:00`).
- **Location**: `{ "latitude": <number>, "longitude": <number> }` — **full** keys; `lat` / `lng` /
  `lon` are **rejected**. e.g. `{ "ko-KR": { "latitude": 37.5662, "longitude": 126.9910 } }`.
- **Refer**: `{ "sys": { "type": "Refer", "id": "<id>", "targetType": "Content" | "Media" } }` —
  **not** a bare id string.

These are the high-frequency gotchas, not the full spec; the complete field-value contract is the CMA
`content` API reference (path via **`weegloo-api-endpoints`**), locale-key rules in
**`weegloo-default-locale`**.

---

## Model relationships as Refer (normalize by default)

When one entry relates to another — reply → parent, comment → post, post → author — model the link as
a **`Refer` field**, not a `ShortText` holding the other entry's id by hand. `Refer` is typed and
first-class: restrict it with `referContentType`, resolve it server-side with `include`, and filter by
target id. A `ShortText` id is an opaque string the platform cannot validate, resolve or traverse.
`Refer` supports **self-reference** (a ContentType referencing itself) for trees and threads — reply
chains, category parents, nav menus.

| Relationship | ✅ Refer | ❌ Anti-pattern |
|--------------|---------|-----------------|
| reply → parent comment | `parent` (Refer, self-ref) | `parentCommentId` (ShortText) |
| comment → post | `post` (Refer) | `postId` (ShortText) |
| post → many related | `Array` of `Refer` | comma-joined ids in a `ShortText` |

**Denormalize only with a stated reason** — a deliberately frozen *snapshot at write time* (author
name as it was, a cached count) or a performance-driven denormalized read. Default to the reference;
make the snapshot the explicit exception, with the reason recorded. Don't reach for a flat id
"because it's simpler" — that is the rationalization this section exists to stop.

Full reference model (single / array / bidirectional / self / circular + `include` resolution) lives
in the Weegloo docs: the **Reference** and **Content modeling** core-concept pages.

---

## Don't model what the platform provides

- **Author / `createdBy`** — expose it via **`publishWithAuthor`** and the built-in `sys.createdBy`.
  Do **not** add a separate author field (a Comment ContentType needs no `author` field).
- **Timestamps** — `sys.createdAt` / `sys.updatedAt` are automatic. Add a Date field only for a
  user-controlled date (a publish date the author picks).
- **ID** — `sys.id` is auto-generated. Do not create an id field.

---

## `publishWithAuthor` — expose the author on the delivery plane

`publishWithAuthor` is a boolean on the **ContentType** (not a field). It decides whether
**publishing** bakes the author — `sys.createdBy` (and `sys.updatedBy`) — into the **published
snapshot**. It is **`false` by default**.

Set it whenever the **delivered** content needs to know **who created it**:

- **Author byline / display** on delivered content — "posted by X", a comment's author, a profile
  owner, an avatar next to a post.
- **`createdBy` / `:self` permission filters** on the delivery plane — a member seeing only their own
  rows (see **`weegloo-space-role`**).
- **Author-based grouping or moderation** — anything reading `sys.createdBy` off a delivered resource.

**Why the default bites (footgun).** With `publishWithAuthor: false`, the **CDA / ACDA published
snapshot carries no `sys.createdBy`**, so every author-dependent feature above silently returns
**empty** — a blank byline, a `:self` `Allow` rule that matches nothing, a `Deny` rule that excludes
no one. **Management (CMA / ACMA) is unaffected**, because it reads the **draft**, which always keeps
`sys.createdBy`. That asymmetry is the trap: it works in the console and on ACMA, and only breaks on
the delivered read.

**Applied at publish time, not retroactive.** Turning it on later does **not** restore authors on
already-published entries — each must be **re-published**. Enable it **when you model the
ContentType, before any Content is authored/published**. This is load-bearing for **ServiceLogin**
products, where member posts and comments are written and read back through ACDA.

---

## Editing a ContentType later

- **Updates are full replacement** (`cma_UpdateOneContentType`): preserve **field `id`s** and send
  **all** fields, `displayField` and `publishWithAuthor` included.
- **Stricter validations may break existing entries** on their next save — warn before migrating live
  data.
- **Changing `LongText` ↔ `RichText`** (or any other type change) on a live field is a **schema
  migration** — plan content re-save and app typing, not a silent rename.
