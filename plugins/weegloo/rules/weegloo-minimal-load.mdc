---
id: weegloo-minimal-load
type: rule
title: Weegloo - fetch the minimum, compute on the client
description: >
  Foundational cost rule for every Weegloo integration. Each request fetches only the data the
  current step actually needs (select, server-side filters, limit, totalCount, image style presets,
  CDA for public reads), and every computation that does NOT require server-side authority runs on
  the CLIENT (browser for web, the app for mobile/native) from data already fetched - never as an
  extra Weegloo round-trip or a Script run. Also fixes the counterweight (secrets, authorization,
  atomicity, concurrency, unbounded queries stay server-side) and the forbidden load anti-patterns
  (polling loops, paging to count, N+1 by-id reads, fetch-all-then-filter, unprojected reads).
---

rules:
  - section: The principle (non-negotiable — applies to every Weegloo integration)
    items:
      - "**Weegloo is shared, metered infrastructure — every call is something you SPEND.** A request carries **only the data the current step needs**; every computation that does **not** require server-side authority runs on the **client** (browser for web, the app for mobile/native) from data already in hand. Excess load is a **defect to fix**, not a style preference."
      - "**Narrow on the server** (scope → filter → order → paginate → project), then **derive the rest on the client**. \"Compute on the client\" is **never** a licence to pull a whole collection and sort it out locally — the worst of both, and a **data-exposure bug** when the rows carry anything the caller must not see."
      - "**This binds the agent's own `mcp__weegloo__*` reads too**, not only the code you generate."

  - section: Fetch the minimum — mandatory on every read
    items:
      - "**`select` on every read.** An unprojected `GetList*` / list GET returns **whole documents** — every locale bucket of every field of every row — and nothing errors or truncates (**`weegloo-api-query-optimization`**)."
      - "**Filter and scope SERVER-SIDE, on the indexed axes** (`sys.contentType.sys.id`, status, `createdBy`, tags, `sys.id[in]`). Filtering in memory is valid **only** when the loaded array is already the whole bounded dataset; over a paginated or unknown-size collection it is silently **wrong** — it searches only the rows you happen to hold."
      - "**`limit` = what the view renders**; page further only when the user asks (`links.next`). **Never page to count or aggregate** — every list response carries **`totalCount`**. **Never N+1 by-id reads** — `include=1`, `sys.id[in]`, or one filtered list. Thumbnails take a **`/style1`**…**`/style10`** preset segment on the Media file URL, not the original shrunk in CSS."
      - "**Public / high-traffic reads go through CDA (or ACDA), not CMA/ACMA** — a management-plane read works perfectly while bypassing the delivery cache and loading the wrong plane."
      - "**Do not re-fetch what has not changed** — keep results in client state across renders, mounts and route changes; re-fetch on a **real signal** (a user action, your own write, an event), **never on a timer** and never per keystroke (debounce, cancel in-flight)."

  - section: Compute on the CLIENT — the default placement of work
    items:
      - "**Arithmetic and presentation are client work, never a reason for another Weegloo request or a Script run:** aggregates **over rows already loaded**, grouping and chart series, sorting and filtering **within a loaded complete set**, date/timezone math, formatting and i18n, derived labels, validation feedback, virtualization."
      - "**Do not create Weegloo resources to hold what the client can derive.** A `summary` / `stats` / `total` Content rewritten on every change is a second source of truth **and** extra write load — compute it at render time, unless the value must be **authoritative** (next section)."
      - "**A Script must earn its run.** Executions are a **monthly, Organization-wide allowance** shared by `/execute`, Webhook-run Scripts and Schedulers; once it is spent, **every** Script and Scheduler in the Organization stops. A Script that only rearranges data the caller already holds, or a Scheduler firing faster than the requirement needs, spends it for nothing — ask **\"does this need the server's authority?\"**; if no, it is client code (**`weegloo-script`**, **`weegloo-scheduler`**)."

  - section: What must NOT move to the client (the counterweight)
    items:
      - "**Moving any of these to the client is a security bug, not a saving** — each stays server-side whatever it costs: anything needing a **secret** (API key, SMTP credential, PG secret key); **authorization and trust** decisions — permission checks, payment **amount verification**, signature / webhook verification, quota enforcement, where a client-computed value is an **input to be verified, never the truth**; **atomic multi-step writes** and **concurrency-safe** updates of a shared row (`sys.version`); **privilege delegation**; and any **query over a dataset the client does not — and must not — hold**."
      - "**Never over-fetch in order to compute locally.** If the client-side math would need rows the caller must not see, or an unbounded set, that computation is **server-side by definition** — the minimum-data rule wins over the client-compute rule, never the other way round."

  - section: Forbidden load anti-patterns (fix on sight)
    items:
      - "**Polling loops** — no `setInterval` / retry loop re-fetching a list to notice a change; use a user action, a **Webhook** (event) or a **Scheduler** (clock). **One exception:** awaiting an async job you just created — poll **that one resource by `sys.id`**, projected, with **backoff** and a bounded attempt count (**`weegloo-script`**)."
      - "**A `fields.*` filter or `order` without `X-Weegloo-Advanced-Search: true`** — an unindexed scan that passes on seed data and times out as the Space fills up."
