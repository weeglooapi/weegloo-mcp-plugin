# Maps Embed API — the full recipe

Read this when a map needs anything beyond the single `place` pin the spine already ships: a
directions / search / street-view block, several places, localization, an address that comes from
content, or a map that renders an error.

Official reference: https://developers.google.com/maps/documentation/embed/get-started

The key, the minimal iframe and the mode list are in `SKILL.md` — this file assumes you already have
them, and does not repeat the key.

## Pick the mode from what the UI actually shows

Base URL: **`https://www.google.com/maps/embed/v1/{mode}?key={KEY}&{params}`**

| UI intent | `{mode}` | Required parameter |
|---|---|---|
| **one place / address on a map** (the common case) | `place` | `q=` place name, address, plus code, or `place_id:…` |
| a bare coordinate view, no pin | `view` | `center=lat,lng` |
| a directions / route block ("how to get here") | `directions` | `origin=` + `destination=` |
| "nearby X" / a category of results | `search` | `q=` search term (optionally location-restricted) |
| a street-level look at the frontage | `streetview` | `location=lat,lng` **or** `pano=` |

Every mode also accepts `zoom` (0–21), `maptype=roadmap` / `satellite`, `language`, `region`
(a two-character ccTLD) and `center`.

- **`directions`** adds `waypoints` (pipe-separated, max 20), `mode=driving` / `walking` /
  `bicycling` / `transit` / `flying`, `avoid=tolls` / `ferries` / `highways`, and
  `units=metric` / `imperial`.
- **`streetview`** adds `heading` (-180–360), `pitch` (-90–90), `fov` (10–100), `radius` and
  `source`.

**Localize the map to the site's audience** with `language=` and `region=` — e.g.
`language=ko&region=KR`, `language=ja&region=JP` — so map labels and search behaviour match what the
visitor expects. Omit both for an English/global site.

## The iframe — details that bite

- **URL-encode `q` / `origin` / `destination`.** Spaces become `+` or `%20`. An un-encoded non-ASCII
  address often still resolves, but encode it anyway — build the value with `encodeURIComponent` when
  the address comes from content.
- **Minimum size is 200×200 px.** Below that the map does not render at all — a compact mini-map card
  must still clear it.
- Keep `loading="lazy"` and `referrerpolicy="strict-origin-when-cross-origin"` (Google's recommended
  attributes), and give every iframe a `title` for screen readers.
- Prefer a **responsive wrapper** (`aspect-ratio`, or a `position:relative` padding box) over a fixed
  pixel height, so the map survives mobile.
- Prefer **`q=place_id:…`** when the exact business is known: an address string can resolve to a
  neighbouring pin, a place ID cannot.

## One embed shows ONE place — plan a list accordingly

The Embed API takes **no marker list** — there is no parameter for an arbitrary set of custom pins.
So for a **branch list / store locator / venue gallery**, either:

- render **one small iframe per card**, each with its own `q`; or
- use **`search` mode** when the pins genuinely are a search result
  (`q=coffee+shops+in+Seattle`).

Do **not** reach for the Maps **JavaScript** API for multi-marker — that pulls an SDK, a script
loader and a different quota into a static site. If the design truly requires clustered custom
markers, **say so and ask** before switching.

## Where the address comes from

If the places are content the user manages, the address belongs in a **ContentType field**, not in
hard-coded HTML: model `name` and `address` (ShortText), plus `lat` / `lng` / `placeId` when the
design needs them (`weegloo-create-content-type`), read them over CDA, and build the iframe `src` in
the browser from the field value.

Hard-code an address **only** for a single fixed location that is part of the site's chrome — a
footer, a contact page.

## If the map does not render

Google renders its own error **inside** the iframe. The usual causes:

- the **Maps Embed API** is not enabled on the key's project;
- the key's HTTP-referrer restriction does not cover the deployed origin;
- a malformed `q`.

Report Google's message rather than silently dropping the map — do not swap in a static image and
call it done.
