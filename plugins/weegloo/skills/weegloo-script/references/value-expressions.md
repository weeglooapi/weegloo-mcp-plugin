# Dates and operator edge cases

Read this whenever a **date** is compared, stored or read out of the payload, or when a `$` operator
is rejected. The pointer roots, the JsonLogic operator list and the three slot kinds are already
complete in `SKILL.md`.

## `date` — comparing dates, whatever the format

**Comparison coerces its operands to numbers, so date TEXT is `NaN` and every comparison over it is
silently `false`** — never compare `"2026-10-03"` directly. Normalize it first. There is deliberately
no `before` / `after` / `equal` operator, because once normalized the stock ones are the answer:

```jsonc
{ "date": [ <value>, <output>? ] }                                 // `$date` in a data slot
{ "<":  [ { "date": a }, { "date": b } ] }                         // before  (`>` = after)
{ "<=": [ { "date": from }, { "date": x }, { "date": to } ] }      // between — chained comparison
{ "==": [ { "date": [a, "day"] }, { "date": [b, "day"] } ] }       // same DAY (bare `date` = same instant)
{ "date": [ { "+": [ "{ /now/millis }", 604800000 ] }, "iso" ] }   // 7 days from now, ready to store
```

- **Reads** ISO-8601 / RFC 3339 (`2026-10-03T09:00:00+09:00`; fraction and offset optional, a space
  accepted in place of `T`), a bare `2026-10-03` (UTC midnight), RFC 1123 as an HTTP `Date` header
  carries it (`Sat, 03 Oct 2026 00:00:00 GMT`), and an epoch count (`< 1e11` ⇒ seconds, else
  milliseconds — so `{ /now/seconds }` and `{ /now/millis }` both read correctly). **No offset ⇒
  UTC.**
- **`output`:** `millis` (default — the comparable one) · `seconds` · `iso` · `day` (`2026-10-03`).
- **`iso` is the only form a `Date` FIELD accepts on write.** Storing a payload date needs it:
  `"fields": { "visitAt": { "en-US": { "$date": [ "{ /payload/fields/visitAt }", "iso" ] } } }` — a
  bare `2026-10-03` written straight into a Date field is rejected.
- **Absent or unreadable ⇒ 400** (catchable by `Try`), and so is a number outside the epoch window
  (`20261003`, `2026`, `0`). That is deliberate: read as epochs they would become silent 1970 dates,
  and a guard comparing against 1970 does not fail — it inverts.
- `/now/iso` is the same rendering as `sys.createdAt`, so a `/now`-derived value compares against a
  stored system timestamp directly, with no normalization on either side.
- Filtering a **list** by date is a server-side `where` (`gte`/`lte`) on the search read, not
  JsonLogic — there is no `filter` operator to apply after loading (see `queries-and-iteration.md`).

## `$` on operators — the error cases

A key like `cat` or `in` is a legitimate **field name**, so in a **data** slot (`fields`,
`Http.body`, `Return.value`, `SetVar.value`, `Cache.value`/`defaultValue`) an operator **must** carry
a `$`. In an **expression** slot (`If.condition`, `Loop.while`, `version`) bare and `$` both work; in
a **template** slot nothing but `{ /pointer }` is interpreted.

- **A data key that really starts with `$` is doubled:** `"$$ref"` means the field `$ref`.
- **`WGL400055`** — an unknown `$` key: a typo, or an operator that does not exist (`$map`,
  `$filter`, `$reduce`, `$all`, `$some`, `$none` are **not supported** — iterate with `Loop`).
- **`WGL400056`** — a `$` operator sharing its object with sibling keys. An operation must be its
  object's **only** key; move the sibling data one level out.
- Once inside a `$` operation, **nested** operators need no `$` (adding one is still valid), so a
  deeply nested expression only needs the prefix at its root. **When unsure, prefix every operator
  with `$`** — it is correct in every slot.

```jsonc
// ❌ WGL400056 — operator and data in one object
"value": { "$+": [ "{ /vars/n }", 1 ], "note": "bumped" }

// ✅ the operation is its object's only key
"value": { "total": { "$+": [ "{ /vars/n }", 1 ] }, "note": "bumped" }
```

## Pointer resolution — the details that bite

- **Single pointer preserves the source type**: `{ /payload/fields/count }` stays a number, an object
  stays an object. **Any other text in the string makes it a template** and the result is a string —
  `"{ /payload/fields/count }pt"` is `"3pt"`, and `"{ /a }{ /b }"` is a concatenation (which is why a
  signed message `"{ /sig/1 }.{ /rawPayload }"` needs no `$cat`).
- **A missing path is not an error**: `null` for a single pointer, `""` inside a template. A typo in
  a pointer therefore surfaces as an empty field or a `false` condition, never as a failure — check
  the pointer first when a write lands empty.
- **Only `{ /… }`-shaped substrings resolve** (brace, optional space, a `/pointer`, optional space,
  brace), so ordinary braces — a JSON literal `{"k":1}` in a text field, a CSS snippet — are left
  as-is and need no escaping. To keep a brace that *would* be read as a pointer, write **`\{`**.
- A pointer into a statement that **failed** binds nothing: a failed `Http` has no `{ /resp/body }`,
  and the failure is only readable inside `catch` as `{ /error/message }`.
