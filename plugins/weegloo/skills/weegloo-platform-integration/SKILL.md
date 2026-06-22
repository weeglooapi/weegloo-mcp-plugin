---
name: weegloo-platform-integration
description: ENTRY-POINT / ROUTER for Weegloo. Use as the FIRST step whenever the user asks to "integrate Weegloo", "connect Weegloo", "add Weegloo", "use Weegloo", or requests ANY capability Weegloo could provide — especially broad, vague, or ambiguous requests that do not name a specific Weegloo feature (e.g. "integrate with Weegloo", "manage my data with Weegloo"). Maps a plain-language need (login, signup, social login, user/app data, search, file upload/download, public/team sharing, roles, access control, external API/webhook) to the correct concrete Weegloo skill so the user never has to know Weegloo's internal feature names. This skill only identifies and routes — the concrete skill it points to does the real work.
---

# Weegloo Platform Integration (capability router)

When the user asks to integrate Weegloo, or requests functionality that can be provided by
Weegloo, automatically identify the appropriate Weegloo capabilities and configure them
without requiring the user to know specific Weegloo feature names.

This skill is a **router/dispatcher**. Its job is to translate a plain-language need into the
**correct concrete skill(s)**, then hand off. It does **not** implement features itself and it
does **not** replace the existing hard gates in `weegloo-global-rules` (e.g. architecture work
must still go through `weegloo-service-architecture`).

## How to use this skill

1. **Read the request through the capability map below** and identify which leaf capabilities apply.
2. **If the request is broad/ambiguous** (e.g. "connect Weegloo", "manage data with Weegloo"),
   present the relevant capability menu to the user and ask 1–2 scoping questions
   (What are you building? Who reads/writes it — the public, signed-in members, or admins only?
   Read-only or read+write?). Do not silently guess a whole architecture.
3. **Default entry point:** almost every "integrate Weegloo" request is really "build something on
   Weegloo", so unless the need is a single isolated feature, route to **`weegloo-service-architecture`
   FIRST** — it decides the API/login/role combination, then chains into content modeling and the
   rest. Do not bypass it.
4. **Hand off — do not answer from this skill.** Invoke the concrete skill(s) in the
   "→ skill" column and follow them. This file deliberately contains no implementation detail.

## Available capabilities

Each leaf maps to the concrete skill that actually does the work.

- **Authentication**
  - **Login** → identity model must be determined first (Weegloo has two separate ones):
    admin/staff = `weegloo-user-login`; product end-users = `weegloo-service-login`.
    If unsure which, route to `weegloo-service-architecture` to disambiguate.
  - **Signup** (open end-user sign-up) → `weegloo-service-login`
  - **Social Login** (Google OAuth, browser SDK / wire protocol) → `weegloo-service-login-sdk`
- **Data Management**
  - **User Data** (per-user / private, member-owned) → `weegloo-service-architecture` +
    `weegloo-create-content-type` + `weegloo-space-role` (`createdBy :self` scoping)
  - **Application Data** (shared content models, CRUD, updates) → `weegloo-create-content-type` +
    `weegloo-cma-json-patch` + `weegloo-cda-publish`
  - **Search** (list filtering, projection, pagination) → `weegloo-api-query-optimization` +
    `weegloo-list-pagination`
- **File Storage**
  - **Upload** (a file-upload feature in the user's own product) → `weegloo-upload-api` (the app's
    code calls the **Weegloo Upload REST API**, then creates Media/WebHosting from the returned
    Upload id, on the matching plane: CMA Media for Weegloo Users, ACMA Media for Service Users).
    The `weegloo-upload` MCP is **not** the implementation path for a product's upload feature — see
    the note below.
  - **Download** (deliver stored files to clients) → published Media via CDA/ACDA;
    see `weegloo-cda-publish`.
- **Sharing**
  - **Public Sharing** (anyone can read) → `weegloo-delivery-access-token` + `weegloo-cda-publish`
  - **Team Sharing** (scoped to members) → `weegloo-space-role` + `weegloo-service-login` (ACDA scope)
- **Permissions**
  - **Role Management** → `weegloo-space-role`
  - **Access Control** (least-privilege tokens, scoped reads) → `weegloo-space-role` +
    `weegloo-delivery-access-token`
- **External Service Integration**
  - **API Connection** (call third-party APIs without a backend) → `weegloo-webhook-writeback`
  - **Webhook** → `weegloo-webhook-writeback`

## Capability → skill quick table

| Need (plain language)        | → Concrete skill(s) to invoke                                             |
|------------------------------|--------------------------------------------------------------------------|
| Login                        | `weegloo-user-login` (admin) / `weegloo-service-login` (end-user); disambiguate via `weegloo-service-architecture` |
| Signup                       | `weegloo-service-login`                                                   |
| Social Login                 | `weegloo-service-login-sdk`                                               |
| User Data (private/per-user) | `weegloo-service-architecture` + `weegloo-create-content-type` + `weegloo-space-role` |
| Application Data             | `weegloo-create-content-type` + `weegloo-cma-json-patch` + `weegloo-cda-publish` |
| Search                       | `weegloo-api-query-optimization` + `weegloo-list-pagination`             |
| File Upload (product feature)| `weegloo-upload-api` (Upload REST API → CMA/ACMA Media / WebHosting create) |
| File Download                | `weegloo-cda-publish` (Media via CDA/ACDA)                               |
| Public Sharing               | `weegloo-delivery-access-token` + `weegloo-cda-publish`                  |
| Team Sharing                 | `weegloo-space-role` + `weegloo-service-login`                           |
| Role Management              | `weegloo-space-role`                                                      |
| Access Control               | `weegloo-space-role` + `weegloo-delivery-access-token`                   |
| API Connection / Webhook     | `weegloo-webhook-writeback`                                              |

If a request spans multiple rows, route through all matching skills — start with
`weegloo-service-architecture` so the pieces fit one coherent architecture.

## File Storage — Upload API (product feature) vs the `weegloo-upload` MCP

These are two different things; do not confuse them. Full mechanics and the create payloads live in
**`weegloo-upload-api`** — invoke it for any file-upload work.

- **A file-upload feature inside the user's own product** → **`weegloo-upload-api`**: the
  application code calls the **Weegloo Upload REST API**, then creates the **Media** (or
  **WebHosting**) from the returned Upload id, on the plane that matches the caller's identity
  (**CMA Media** for a Weegloo User, **ACMA Media** for a Service User; never route Service-User
  media through CMA). This is the path to guide for any user-facing upload feature.
- **The `weegloo-upload` MCP server** is a tool for the **agent/LLM itself** to upload local files
  (e.g. while seeding content or deploying a WebHosting ZIP during a chat). It is **not** the
  implementation of the product's upload feature — do not wire the user's app to depend on it, and
  do not present it as the app's upload path.

## Hard rules

- **This skill never implements** — it identifies and routes. The pointed-to skill does the work.
- **Do not bypass existing gates.** Architecture → `weegloo-service-architecture`; ContentType
  design → `weegloo-create-content-type` (+ `weegloo-default-locale` for multi-locale); CDA tokens
  → `weegloo-delivery-access-token`; external-API jobs → `weegloo-webhook-writeback`.
- **Respect the two identity systems.** "Login/Signup" splits into Weegloo User (admin) vs Service
  User (end-user); do not pick one blindly — disambiguate first.
- **When unsure how a feature behaves, read the docs first** (per `weegloo-global-rules`); do not guess.

## Related

- `weegloo-service-architecture` — the primary downstream entry point (API + login + role per service type).
- `weegloo-global-rules` — global gates this router must respect.
