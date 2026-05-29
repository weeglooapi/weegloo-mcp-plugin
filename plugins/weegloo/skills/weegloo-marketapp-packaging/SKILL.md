---
name: weegloo-marketapp-packaging
description: Build-time rules for any WebHosting that will (or may) be packaged into a MarketApp AppBundle. The source Space's `sys.id`, `DeliveryAccessToken`, and any other resource `sys.id`s the client code references must be preserved in the build output verbatim, as intact literal strings — do not replace them, do not abstract them, do not split them across concatenation, do not leave them blank. Use whenever writing or modifying a WebHosting that could later ship as a MarketApp; these decisions must be made at build-output authoring time, not at packaging time.
---

# Authoring a WebHosting for MarketApp packaging

> **Build rule.** In the static build output, keep the source Space's `sys.id`, `DeliveryAccessToken`, and any other resource `sys.id`s the client code references as **verbatim, intact literal strings**. Do not replace them with placeholder syntax, do not hide them behind env-var indirection or runtime concatenation, do not leave them blank. The MarketApp distribution path requires this; if you alter or omit these values, MarketApp installs of this WebHosting will not work correctly.

An uninformed agent's instinct — "the author's Space shouldn't be hard-coded into the build output, that's a smell" — is **wrong** for WebHostings destined for MarketApp packaging. The correct pattern is the opposite: **inline the source Space's literal values directly**, contiguously, into the text output, and leave them there.

## When to use

- **(Primary)** You are **writing or modifying a WebHosting web app** that **could ever be packaged into a MarketApp later** — even if you are not packaging it yet. The build-output decisions made now must follow these rules.
- You are **authoring a MarketApp** that bundles an existing WebHosting.
- You are deciding what to put in your build output for things like the Space `sys.id`, `DeliveryAccessToken`, `ContentType.sys.id`, etc.
- You are debugging why an installed MarketApp's hosted site is misbehaving.

## Not for

- A user **installing** an existing MarketApp — there is nothing to do on the client.
- Plain WebHosting deploys (direct `CreateUpload` + `cma_CreateWebHosting` flow) — these rules don't apply. See **`weegloo-web-hosting`**.

## Build-time rules

When you produce the static bundle that becomes the source Space's `WebHosting`:

1. **Inline the source Space's `spaceId` and `DeliveryAccessToken` as literal string values** into the built JS / HTML / JSON (e.g. via `NEXT_PUBLIC_*` at build time, or hand-written config). Same for any other resource `sys.id`s the client code needs.
2. **Do not hide the values behind runtime indirection.** No runtime env-var lookups, no runtime fetches, no string concatenation (e.g. `"tok_" + "abc...xyz"`) that prevents the value from appearing as one intact substring in the static text.
3. **Do not leave the values blank** because "hard-coding the author's Space looks wrong" — it is the correct pattern here.
4. **Configure your bundler to preserve these values as plain, intact string literals.** Some bundlers transform string literals (e.g. emit `-` instead of `-`) or split strings across concatenation. Verify against the actual built artifact, not just the source.
5. **Put identifiers the runtime needs in text files** (HTML / JS / JSON / XML / etc.), not in binary assets (images, fonts, archives, etc.).
6. **Verify before publishing.** `grep` the actual built artifacts (not just the source) for the original `spaceId`, `accessToken`, and any other inlined resource `sys.id`s, and confirm each appears as one intact literal substring in every place the runtime needs them.

## Related skills

- **`weegloo-web-hosting`** — direct (non-MarketApp) WebHosting deploy workflow, and the static-only platform limits (100-file cap, no SSR, browser-side API calls) that also apply to MarketApp WebHostings.
- **`weegloo-delivery-access-token`** — how to scope the source Space's `DeliveryAccessToken` (least-privilege `SpaceRole`, never Administrator). The same scoping carries over wherever the token is used.
- **`weegloo-api-endpoints`** — CDA/ACDA base URLs and identity model that the inlined values will be used against from the browser.
