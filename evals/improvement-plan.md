# Improvement Plan (post-T0)

Living plan derived from the T0 baseline ([2026-05-28-baseline.md](./runs/2026-05-28-baseline.md)) and two codex consultations. Update as interventions ship and T1+ measurements come in.

## Where this stands

- T0 baseline: **62 / 64 median**, **~57 / 64 mean-floor** (estimated under proposed rubric v2)
- Plan C (original "slim ambient rules from 43KB to 1.5KB") is **mostly invalidated** by T0 data — rules are doing real safety-net work for P5/P6/P8 (33-67% of runs)
- Codex pushed back on initial post-T0 plan: do not batch-rewrite all 13 skill descriptions; trigger reliability is a diagnostic, not the north-star; P2-class failures need server-side enforcement, not more text

## Mental model (refined)

After T0 + codex:

| Knowledge type | Best home | Why |
|---|---|---|
| Small, sharp, always-on constraints (e.g. "never Administrator on token", base URLs, Accept header) | **Ambient rule** | Cheap to load, hard to miss |
| Multi-step workflows / decision trees (architecture selection, ContentType modeling) | **Skill** | Activated when relevant; can contain procedure |
| Reference facts (state enums, lifecycle, locale shapes) | **Ambient rule** | P7 proved rule-only works at ceiling |
| High-cost anti-patterns the model rationalizes around | **Server/tool enforcement** | Only enforcement beats LLM prior |
| Trap warnings the model needs to see at the moment of action | **MCP tool description** | Closest to the action point |

Do not auto-convert rules to skills. Do not auto-delete rules when a skill exists.

## Execution order (codex-revised)

### 1. C — Inline MCP tool description traps  *(1 day, plugin)*

**Goal:** put trap warnings at the action point. Model attends to tool descriptions more reliably than ambient text.

**Concrete edits to MCP tool descriptions (server-side or plugin-side, wherever the descriptions live):**

| Tool | Append to description |
|---|---|
| `cma_CreateContentType` | "For text fields: default to RichText. Use LongText only when CDA full-text search will run on this field. Field names like 'body', 'description', 'article' do NOT justify LongText by themselves." |
| `cma_CreateDeliveryAccessToken` | "role.sys.id MUST be a least-privilege SpaceRole scoped to the intended ContentTypes. NEVER Administrator. NEVER the first item from cma_GetListSpaceRoles without intent." |
| `cma_CreateContent` | "Every populated field requires a value under the Space default locale (resolve via cma_GetOneSpace.defaultLocale). localized:true allows additional locale buckets; localized:false rejects them." |
| `cma_CreateWebHosting` | "Subdomain must be user-provided (no inference). Run cma_CheckSubdomain first. Build output ZIP must have index.html at root and at most 100 files total." |
| `cma_PatchOneContentType` / `cma_UpdateOneContentType` | "Requires x-weegloo-version header with current sys.version. PUT is full replacement; PATCH is RFC 6902 JSON Patch with Content-Type: application/json-patch+json." |

**Why first:** cheapest place to put a trap, closest to action, hardest for the model to ignore.

**Measurement:** does NOT need a full T1 — track whether MCP error/refuse paths fire in subsequent runs.

---

### 2. B — Strengthen `weegloo-create-content-type` skill body  *(half day, plugin)* ✅ DONE

**Goal:** kill P2 R2-class failure where agent invokes skill, cites rule, then defaults to LongText anyway.

**Concrete edit:** insert as first content section (before "Core workflow"):

```markdown
## Default rule (read this first)

**Default text field type: RichText.**

Pick **LongText** only if the user has explicitly said the product will run
CDA full-text search on this field in real features (site search, discovery,
admin search, etc.).

Do NOT pick LongText because:
- the field stores long content
- the field is called "body" / "description" / "article" / "본문"
- "blogs usually need search"

These rationalizations contradict the skill. If you are about to use one,
stop and either ask the user "will you run CDA full-text search on this field?"
or default to RichText.

Migration RichText → LongText is possible later. Defaulting to LongText
without need burns API capacity and forces re-migration.
```

**Why second:** B alone is not enough (codex was clear on this — see #3), but it's cheap and reduces the surface that the LongText refuse rule (#3) has to catch.

**Measurement:** P2 mini T1 (3 runs of P2 prompt only, ~30 min). Target: 0/3 LongText defaults.

---

### 3. E-lite — Server-side LongText warn/refuse  *(backend work, weegloo-server)*

**Goal:** prevent the rationalize-around-rule pattern (P2 R2 mechanism) at the API layer.

**Concrete behavior on `cma_CreateContentType` server endpoint:**

- Inspect submitted fields
- If a field has type=LongText AND fieldId ∈ {body, description, article, content, post, text, contents, 본문} (or matches a heuristic for long-prose names) AND request has no explicit "fullTextSearchAcknowledged" flag or equivalent:
  - **Warn mode (first ship):** include `warnings: [{ code: "WGL_LONGTEXT_LIKELY_UNINTENDED", message: "...", suggestedType: "RichText" }]` in 201 response
  - **Refuse mode (after warn-mode validation):** return 422 with `code: WGL_LONGTEXT_REJECTED_HEURISTIC` and the same suggestion
- Bypass via explicit `acknowledgments: ["fullTextSearchRequired"]` in payload

**Why third:** codex was emphatic — the P2 mechanism is "model knew and rationalized around the rule", which is exactly the class server-side enforcement is for. B + C narrow the surface; E-lite catches what slips through.

**Owner:** needs weegloo-server backend collaboration. Decision needed on warn-mode vs refuse-mode rollout.

**Measurement:** P2 full T1 (3 runs) after server change ships.

---

### 4. Rubric v2 — switch to mean-floor  *(30 min, evals only)* ✅ DONE

**Goal:** surface partial failures currently hidden by median per dim.

**Edit `evals/rubric.md`:** change "use the median" to "use the mean per dim, floored to integer". Retroactively recompute T0 totals (~57/64). Update scoreboard with both T0 numbers (median + mean-floor) for transparency.

**Why fourth:** trivial work but must be locked in before T1 so apples-to-apples.

---

### 5. A — Skill description rewrites, **only for demonstrated trigger misses**  *(half day, plugin)* ✅ DONE

**NOT all 13.** Codex was explicit: batching all is churn.

**Only these three:**

| Skill | Current trigger | Target | Add to description |
|---|---|---|---|
| `weegloo-default-locale` | 33% | 100% | "Use when creating or updating Content in any localized or multi-language scenario." (Korean triggers removed — semantic match, not keyword match) |
| `weegloo-web-hosting` | 67% | 100% | "Use before any deploy to Weegloo WebHosting." |
| `weegloo-service-login` | 67% | 100% | "Use BEFORE any general brainstorming for end-user sign-in features." |

Leave the other 10 alone unless T1 reveals new trigger misses.

**Why fifth:** trigger reliability is a diagnostic, not the KPI. Outputs were correct even when skill didn't trigger (ambient rules covered). Polish triggers only on prompts where output quality was at risk.

---

### 6. T1 full measurement

After 1-4 ship. Compare to T0 (under rubric v2). Decide:
- If ≥ +5 mean-floor: ship batch, move to Tier 2
- If +2 to +4: extract the failing prompts, dig into specific mechanism
- If < +2: something is structurally wrong, escalate to Tier 2 immediately

---

## Tier 2 — after T1 (do NOT pre-commit to broad E)

Codex's order:
1. **I / F: higher-level intent / plan-first MCP tools** (`weegloo_plan_service`, `weegloo_create_blog_schema`, `weegloo_create_public_delivery_token`). Shapes good outputs earlier instead of catching bad ones later.
2. **Broad E (server-side refuse for all anti-patterns)** — only for unstable classes T1 surfaces. Security-critical guardrails (Administrator, PAT, raw HTTP) are 0/24 hits already; not worth E investment there.
3. **Structural routing for brainstorming reflex**: MCP `instructions` surface that pushes "for Weegloo product/API prompts, invoke weegloo skill before generic planning/brainstorming". Plus consider CLAUDE.md skill-routing template the plugin ships in its `init` (separate decision — user-side config).

## Tier 3 — quality-of-life

- **G: eval automation** (`claude --print` driven, Skill() log parsing, anti-pattern auto-detect). Cuts T2/T3 measurement from 3 hours to ~20 min.
- **J: starter templates** (`weegloo_starter("members-board")` etc.) — sidesteps modeling phase for common cases.
- **H: opt-in telemetry from real sessions** — expand the prompt set beyond our 8.

## What NOT to do (locked in by data)

- ❌ DELETE `.mdc` ambient rules just because a companion skill exists (P5/P6/P8 disproved this)
- ❌ Auto-convert reference-style rules to skills (P7 disproved)
- ❌ Batch-rewrite all 13 skill descriptions (codex called this churn; trigger ≠ output quality)
- ❌ Treat trigger reliability as a KPI (correct output with no skill invocation is still a win)
- ❌ Ship broad server-side refuse across all anti-patterns (security-critical surface is already 0-hit)
- ❌ Spend time tightening prompts that already 3/3 ceiling (P1, P3, P4, P7) without new evidence

## Open decisions — RESOLVED 2026-05-28

1. **Who edits MCP tool descriptions (#1 C)?** ✅ **Server-side.** Descriptions live in CMA controllers (`@Operation` annotations in weegloo-server), fetched at runtime via OpenAPI → MCP conversion. C requires a weegloo-server backend PR, same as E-lite.
2. **E-lite (#3) warn-mode vs refuse-mode:** ✅ **Warn-mode first.** Less disruptive; provides false-positive data on the heuristic; agent can self-correct from warning. Escalate to refuse-mode if agent ignores warnings in T1.
3. **B mini T1 vs hold for full T1:** ✅ **P2 mini T1 after Phase 1 (B+A+rubric v2), then full T1 after Phase 2 (C+E-lite).** Mini T1 validates the highest-value plugin-side fix quickly.
4. **#5 A — scope expansion:** ✅ **Yes, gated on output risk.** Widen only when T1 shows trigger miss + output quality degradation co-occurring. Trigger miss alone (ambient rule covers) = no action.

## Sequencing — DECIDED: modified β

C is server-side (not plugin), so the original α/β/γ options changed:

| Phase | What | Where | Status |
|-------|------|-------|--------|
| **Phase 1** | B (skill body) + A (3 skill descriptions) + rubric v2 | plugin repo | ✅ Shipped |
| **Measure** | P2 mini T1 (3 runs) | evals | Next |
| **Phase 2** | C (tool description traps) + E-lite (warn-mode) | weegloo-server | Needs backend PR |
| **Measure** | Full T1 (8×3) | evals | After Phase 2 ships |

Rationale: maximizes immediate plugin-side throughput. C and E-lite both need server work, so batch them. If B alone kills P2 LongText trap, E-lite becomes defense-in-depth rather than critical path.
