---
name: weegloo-marketapp-packaging
description: Build-time rules for any WebHosting that will (or may) be packaged into a MarketApp AppBundle. The server rewrites source Space sys.id, resource sys.ids, and DeliveryAccessToken strings at install time, but only when the build output inlines them as contiguous literals (no placeholder syntax). Use whenever writing or modifying a WebHosting that could later ship as a MarketApp — these decisions must be made at build-output authoring time, not at packaging time — and also when running the packaging step itself.
---

# Authoring a WebHosting for MarketApp packaging

> **First, the fact you need to know: the Weegloo server *automatically rewrites* the source Space's `sys.id`s and `DeliveryAccessToken` strings into the installing Space's values at install time.** Without knowing this mechanism exists, an agent writing the WebHosting has no reason to put the source Space's literal values into the build output — it will reach for placeholders, hide tokens behind env-var indirection or runtime concat, or leave the values blank "because hard-coding the author's Space looks wrong". Each of those produces a bundle whose installs silently keep pointing at the **author's** Space, with no error. Once you know the mechanism exists, the build-time decision is simple: **inline the source Space's literal values directly**, contiguously, into the text output — see the rules below.

## When to use

- **(Primary)** You are **writing or modifying a WebHosting web app** that **could ever be packaged into a MarketApp later** — even if you are not packaging it yet. Build-output decisions made now must be compatible with the server's install-time substitution.
- You are **authoring a MarketApp** that bundles an existing WebHosting and need to know how the server transforms it on install.
- You are deciding what to put in your build output for things like the Space `sys.id`, `DeliveryAccessToken`, `ContentType.sys.id`, etc.
- You are debugging why an installed MarketApp's hosted site still points at the original (author) Space.

## Not for

- A user **installing** an existing MarketApp — the server handles substitution automatically; nothing to do on the client.
- Plain WebHosting deploys (direct `CreateUpload` + `cma_CreateWebHosting` flow) — **no substitution** happens on that path. See **`weegloo-web-hosting`**.

## Mental model

Substitution is **install-time**, not request-time. Static files are physically rewritten and saved into the installing Space's WebHosting storage. The CDN serves the already-rewritten bytes — there is no per-request templating.

Two server-side phases:

1. **Pack** — when an `AppBundle` is generated from a source Space (`AppBundleGenerator.generate(...)` → `AppBundlePackRequest` → `AppBundlePackWorker.processWebHostingResources`).
   - Scans each *text-content-type* file in the source `WebHosting` for occurrences of a set of "keys to replace".
   - Records exact byte `start`/`end` positions per file as a `FileKeyPosition` manifest stored alongside the bundle.
   - Binary files are copied as-is and never scanned.
2. **Install / Unpack** — when a user installs the MarketApp into a target Space (`AppBundleInstaller.install(...)` → `AppBundleUnpackRequest` → `AppBundleUnpackWorker.installWebHosting`).
   - Creates new resources in the target Space, accumulating an `idMap` (old value → new value).
   - For each file with recorded key positions, re-reads the file, applies the map at the recorded positions, and writes the result to the new WebHosting storage.
   - Files with no recorded positions and binary files are copied verbatim.

## Automatic substitutions

The Pack step adds the following to the "keys to replace" set:

- **`sys.id` of every resource included in the bundle** — `ContentType`, `Content`, `Media`, `Locale`, `SpaceRole`, `ServiceUserRole`, `DeliveryAccessToken`, `Tag`, `Webhook`, …
- **The source `Space.sys.id`**.
- **The actual `accessToken` string of every `DeliveryAccessToken`** in the bundle (not just its `sys.id`).

The Unpack step maps each of these to the freshly created value in the target Space. A brand-new `DeliveryAccessToken` is created per source token — both its `sys.id` and the token string itself are substituted into the hosted text files.

## Files that get scanned

Pack only scans these `Content-Type`s for keys:

- `text/*`
- `application/javascript`
- `application/typescript`
- `application/ecmascript`
- `application/json`
- `application/xml`

Everything else (images, fonts, archives, other binary uploads) is **copied byte-for-byte** and never touched.

## Build-time guidance (the actionable part)

When you produce the static bundle that becomes the source Space's `WebHosting`:

1. **Inline the source Space's `spaceId` and `DeliveryAccessToken` literally** into the built JS / HTML / JSON (e.g. via `NEXT_PUBLIC_*` at build time, or hand-written config). Same for any other resource `sys.id`s the client code needs.
2. **Do not invent any placeholder syntax** (`{{spaceId}}`, `__TOKEN__`, `%%CDA_TOKEN%%`, etc.). The server matches the *original literal value*. A placeholder will simply pass through unchanged into installed copies.
3. The build does not need to know anything about the destination Space — the server rewrites at install.
4. **Inline once, contiguously.** Avoid runtime concatenation that hides the literal token from the static text (e.g. `"tok_" + "abc...xyz"`). The exact original string must appear as one contiguous substring in the file.
5. Before publishing a new MarketApp version, **`grep` the built files** for the original `spaceId` and `accessToken` to confirm they appear as one literal substring in every place the runtime needs them.

## Caveats

### 1) Substring match, no boundary check

The scanner is a plain repeated `String.indexOf(key, startIndex)` loop. There is no word-boundary, quote, or context check. Long random IDs are safe in practice. Short or low-entropy `accessToken` strings can collide with unrelated text (CSS class names, URL paths, HTML attribute values) and get replaced too.

### 2) JS/JSON escape sequences are NOT normalized

The scanner reads files as plain UTF-8 text and matches against the raw bytes. If your bundler emits a token as `-` instead of `-`, or splits it across a string concatenation, the literal won't match → no substitution → installed copies will keep pointing at the **author's** Space. This is the most common silent failure mode. **Always verify with `grep` against the actual built artifact**, not just the source.

### 3) No substitution in binary files

Only the content types listed under "Files that get scanned" are rewritten. Embedding identifiers in PNG `tEXt` chunks, PDF metadata, font tables, etc. will not be substituted.

### 4) Pack → Install only; re-uploads are NOT substituted

Substitution runs exclusively on the **AppBundle Pack → AppBundle Unpack** path. Calling `cma_UpdateOneWebHosting` directly against an installed app's `WebHosting` writes the new bytes verbatim — no rewriting. To ship a content update to installed MarketApps, generate a **new `AppBundle`** (which re-runs Pack with fresh key positions) and follow the MarketApp upgrade flow. Note that `MarketAppUpdateWorker` itself only updates the MarketApp's catalog metadata (icon, screenshots) and does **not** trigger any WebHosting rewrite.

## Related skills

- **`weegloo-web-hosting`** — direct (non-MarketApp) WebHosting deploy workflow, and the static-only platform limits (100-file cap, no SSR, browser-side API calls) that still apply to MarketApp WebHostings.
- **`weegloo-delivery-access-token`** — how to scope the source Space's `DeliveryAccessToken` (least-privilege `SpaceRole`, never Administrator). The same scoping carries over to the substituted token in installed Spaces.
- **`weegloo-api-endpoints`** — CDA/ACDA base URLs and identity model that the inlined values will be used against from the browser.
