# Master/detail UIs, `Refer → Media` resolution, and image style presets

Read this when the task is a **list/sidebar → open an item** UI (history list, gallery, inbox,
search results → item page), or when a `Refer → Media` field must become a **displayable image/file
URL**, or when picking a **thumbnail / avatar / hero size**. SKILL.md §6 carries the four headline
facts; this file is the full pattern.

---

## 1. The split: lightweight list, lazy detail

§2–§3 of SKILL.md optimize **bulk** loading (one list instead of many GETs). They do **NOT** mean
"render a detail or image view straight from the list response." A master/detail UI uses the
**opposite** split:

- **List (sidebar): fetch a lightweight projection per row** — `sys.id` plus the human-readable
  **label field you will display** (e.g. `fields.prompt`, `fields.title`). Use `select` to keep rows
  small, and **always project and render a meaningful label**, never just an id or a thumbnail. A
  sidebar/list that shows no title/prompt text is a defect, not an optimization.
- **Detail (on click): fetch that ONE Content by id, lazily.** Hit the single-Content endpoint for
  the selected item — `…/content-types/{contentTypeId}/contents/{contentId}` (on ACMA/ACDA always
  nested under the ContentType; see **`weegloo-api-endpoints`**). This lazy by-id GET is **correct
  and expected**. The "avoid N GETs" guidance in §3 is about loading a *batch* up front — it is
  **not** a reason to skip the detail fetch for the *one* item the user actually opened, nor to try
  to cram every row's full detail into the initial list call.

---

## 2. A reference field holds a stub — resolve it

`fields.image1`, `fields.file`, an author `Refer → User`, a `Refer → Content` all give you an
**id + `targetType`**, not the asset's URL or the linked document's fields. (The stub shape and the
standing "references are never embedded" obligation are in `weegloo-global-rules`; repeated here
only as the anchor for the rendering rules below.) Two ways to get the real resource:

1. **Follow the id.** Read `…sys.id` from the Refer and fetch the target directly, e.g.
   `GET /v1/spaces/{spaceId}/medias/{id}` for a `Refer → Media`.
2. **Expand on read with `?include=1`.** The response then carries every referenced resource in a
   **sibling, singular `include` object keyed by PascalCase `targetType`** — `include.Media`,
   `include.Content`, `include.Space`, `include.Organization`, `include.User`, … . Resolve a field's
   `sys.id` against the matching `include.<Type>` array by id. (Shape detail + a both-shapes
   accessor: **`weegloo-default-locale`**.)

### Rendering a referenced Media (image / file fields)

- On the **detail** fetch, expand the reference (`?include=1`) — or follow up with a Media fetch —
  and read the file URL from the **Media's** `fields.file`, whose **shape depends on the plane**: on a
  **delivery** read (CDA / ACDA, default) it is **flat** — **`fields.file.url`**; on a **management**
  read (CMA / ACMA), and on delivery with `locale=*`, it is a **per-locale bucket** —
  **`fields.file.{locale}.url`**. Indexing `[locale]` on a default delivery read yields `undefined`
  (**`weegloo-default-locale`**). Confirm the Media is deliverable first
  (**`weegloo-media-lifecycle`**).
- **Do NOT assume the list response already carries usable image URLs.** List-level expansion is not
  guaranteed to resolve every Refer→Media into a deliverable URL, and pulling all rows' media up
  front defeats the lightweight-list goal above. The reliable place to read image/file fields for
  rendering is the **detail fetch of the selected item** — exactly the per-item
  `…/contents/{contentId}` call, reading `fields.image1..N` → Media → file URL.

---

## 3. Image processing — on-the-fly resize via `/{styleN}`

Once you have an image Media's file URL, **append a preset style name as a path segment** to get a
**resized, WebP-converted** copy generated on the fly. The original file stays untouched — you do
**not** re-upload or store a separate thumbnail.

```
<file URL>/style3        e.g.  https://…/tumbler.png/style3   → 128×128 WebP
```

Ten presets; each value is the **max dimension** in px and the **original aspect ratio is
preserved** (the image is scaled so its longest side fits the box). Output is always **WebP at 100%
quality**:

| style | px | | style | px |
|---|---|---|---|---|
| `style1` | 32  | | `style6`  | 320  |
| `style2` | 64  | | `style7`  | 480  |
| `style3` | 128 | | `style8`  | 640  |
| `style4` | 192 | | `style9`  | 960  |
| `style5` | 256 | | `style10` | 1024 |

There are **only these presets** — no arbitrary `width`/`height`/`quality`/`format` parameters.
Pick the smallest style that covers the rendered size (e.g. avatars → `style1`/`style2`, list
thumbnails → `style3`, hero → `style9`/`style10`); requesting a larger style than you display just
wastes bytes. Use the **plain file URL** (no suffix) only when you genuinely need the untouched
original (download, exact-fidelity, or a non-image asset).

**Availability:** the styled URL works once the Media is **Published**, which a Media reaches
**automatically** after its upload finishes processing — there is **no separate publish step** for
Media (unlike Content). So a normally-uploaded image just works. The only cases where it is not yet
deliverable: upload processing hasn't completed, or the upload opted out of auto-publish with
**`X-Weegloo-Ignore-Publish: true`** (see `weegloo-upload-api`).
