---
name: weegloo-space-access-token
description: Create a Weegloo SpaceAccessToken (CMA) — a read+write token confined to ONE Space whose exact power is set entirely by a bound SpaceRole. Unlike the read-only DeliveryAccessToken it can write (CMA data + CDA + Upload); unlike a Personal Access Token it cannot touch Space settings, the Organization, the account plane, or ACMA/ACDA. Where it runs — a trusted backend, or a public/browser client such as anonymous posting — and what it can do are the user's call, governed by how the bound SpaceRole is scoped. Bind role.sys.id to a SpaceRole matched to that use — for a publicly-exposed token, tight enough that a leak is acceptable; never Administrator or the first list item. Handle WGL422001 without escalating. Skill text in English only.
---

# Weegloo Space Access Token (Space-scoped read + write, role-governed)

## When to use

- When you need **scoped read+write into one Space**, with the token's power capped by a bound `SpaceRole`. Both are first-class: a **trusted backend / automation** (importer, sync job, CI) **and** a **public / browser** client — e.g. **anonymous posting** or a public submission form backed by a narrowly-scoped role.
- When the user asks for a **"Space token"**, a **"scoped API key that can write to this Space"**, an **anonymous-write / public-submit token**, or a token **narrower than a Personal Access Token** but **write-capable** (unlike a read-only DeliveryAccessToken).
- Via MCP **`cma_CreateSpaceAccessToken`** (or the equivalent CMA flow) under `/spaces/{spaceId}/space-access-tokens`.

**Where it runs and what it can do are the user's decision, governed by the bound role** (see the hard rules). For a client that **only reads** (no write path), a read-only **`DeliveryAccessToken`** is simpler — **but when the same client already carries a SpaceAccessToken for writes, do not add a separate DAT for reads; read through that same SAT** (it authorizes CDA). See *One exposed key beats two* below. For end-user sign-in use **`weegloo-service-login`**.

## What it is (identity + scope)

A SpaceAccessToken is a **Weegloo User-plane** bearer token (prefix **`SPCAT`**). Its scope is deliberately confined:

- ✅ **Read + write the Space's data** — Content / ContentType / Media / publish, **and** the Space's service configuration (Webhook, ServiceLogin / ServiceUserRole, **`DeliveryAccessToken` issuance**, Locale, WebHosting, SpaceRole) — **each only to the extent the bound `SpaceRole` grants that permission**.
- ✅ **CDA** — read published resources in its Space.
- ✅ **Upload** — upload files (then a CMA Media create attaches them).
- ❌ **Space *settings* — always 403, regardless of the bound role**: cannot modify the **Space object**, manage **`SpaceMembership`**, or **mint another `SpaceAccessToken`** (self-mint of a write token is blocked). *(Issuing a read-only `DeliveryAccessToken` is **not** blocked — see rule 5.)*
- ❌ **Organization plane** — no Space lifecycle, org membership, market/app, usage.
- ❌ **Account plane** — no `/me`, no Personal Access Token issuance, no org creation, no MFA/terms/withdrawal.
- ❌ **ACMA / ACDA** — it is **not** a Service User token and never authorizes the app (Service User) plane.

Privilege ordering: **`PersonalAccessToken` ⊃ `SpaceAccessToken` ⊃ `DeliveryAccessToken`**. The SpaceAccessToken sits between them — write-capable like a PAT, but caged to one Space and one role like a DAT.

### The three Weegloo-User tokens — pick the least-privileged that works

| Token | Prefix | Authorizes | Confined to | Where it may run |
|-------|--------|------------|-------------|------------------|
| **DeliveryAccessToken** | `DVRAT` | **CDA read-only** | one Space, bound `SpaceRole` | **Browser OK** (least privilege) |
| **SpaceAccessToken** | `SPCAT` | **CMA data + CDA + Upload** (read **and** write) | one Space, bound `SpaceRole` | **Anywhere** — governed by the bound role (server, or a public client with a narrow role) |
| **PersonalAccessToken** | — | Weegloo-User rights minus web-only account ops | the user's Org(s) + every Space they belong to | **Server-side** (broad; CI / scripts) |

Browser that only **reads, with no write path** → **DeliveryAccessToken** (simpler, no write). **Scoped write** — anywhere, including public / anonymous — → **SpaceAccessToken** with a role scoped to that use; **if that same client also needs to read, read through this SAT (it authorizes CDA) instead of adding a DAT** — see *One exposed key beats two*. Broad **cross-Space / Organization** reach → **PAT** (keep it server-side — it is broad and long-lived).

### One exposed key beats two (read + write from the same client)

A client that must **write** already carries a SpaceAccessToken, and a SAT **already authorizes CDA read**. So for a client that both reads and writes — e.g. an **anonymous board** (list posts + create/edit/delete) — do **not** issue a separate read-only `DeliveryAccessToken` beside it. Read through the **same SAT**.

Why: the two-token split (DAT for reads + SAT for writes) and a single SAT expose the **same capability union** — splitting does not shrink what a leaked client can do. It only places **two secrets in an untrusted client instead of one** (more to leak, rotate, and audit) for no blast-radius gain. Both tokens ship in the same bundle anyway, so "the DAT leaks harmlessly on its own" does not hold. When the capability is identical, fewer embedded secrets is strictly better.

Scope the single SAT's role to exactly the union the client needs — e.g. `content.Read` + `media.Read` on the public ContentType(s) **plus** `script.Execute` (and `media.Create` for uploads) — and keep any secret-bearing ContentType (a password / credential store) **Read-denied**, exactly as you would with a DAT.

**Split into a separate DAT only for a concrete reason** — most commonly **independent revocation** (delete the SAT to kill writes while public reads keep working on the DAT), or read and write living in **different clients / tiers**. Absent such a reason, prefer one key. The "a DAT is simpler for pure reads" guidance above assumes a read-only client with **no** write token; it does not apply once a write SAT is already exposed to that client.

---

## Mandatory rules (hard gates)

1. **The bound role is the entire blast radius — scope it to the exposure.** A SpaceAccessToken can do exactly what its bound `SpaceRole` permits, no more. Put the token wherever the use needs it — a server, **or a public / browser client for anonymous writing** — but **scope the role to match**: anything publicly exposed must carry a role narrow enough that a leaked token can only do the intended, bounded thing (e.g. create-only into one `ContentType`). **Never** bind **Administrator** or a broad write role to a token you will expose publicly.

2. **Bind `role` by `sys.id` — deliberately, never a default.** Pass **`cma_CreateSpaceAccessToken.role.sys.id`** = the `sys.id` of the role you actually intend (scoped per rule 1). **Forbidden:** the **first** entry from **`cma_GetListSpaceRoles`**, **Administrator**, or widening the role after an error. Permission-rule design (`createdBy`, **`:self`**, `contentType`/`tag` filters): **`weegloo-space-role`**.

3. **You can only grant a role you already hold (or that you own as Space admin).** Creating a SpaceAccessToken requires the caller to hold the Space's **token / API-key management permission** **and** either be a Space admin (default role) **or** personally hold the exact `SpaceRole` being bound. Otherwise the create fails with **`WGL422001`** (see below). This is an anti-escalation guard — do not work around it.

4. **On `WGL422001`, do NOT escalate.** Never fall back to Administrator or a broader role to make the create succeed. Explain that the caller cannot grant a role they do not hold, and offer legitimate options: pick a role the caller actually has, have a Space admin create it, or (if appropriate) grant the caller that role first. See **`weegloo-global-rules`** → *Plan/quota* discipline for the same no-workaround stance.

5. **Know what is walled off vs. what the bound role controls.** Three **Space-*settings*** operations are **always 403, regardless of the bound role**: minting/managing another **`SpaceAccessToken`** (self-mint of a write token is blocked), editing the **Space object**, and managing **`SpaceMembership`**. **Everything else** in the Space — including **issuing read-only `DeliveryAccessToken`s** and managing Webhook / ServiceLogin / Locale / WebHosting / SpaceRole — is permitted **only to the extent the bound `SpaceRole` grants that permission**. So it is the **role**, not the token type, that stops a SpaceAccessToken from minting DATs or editing service config — which is exactly why scoping the bound role to the use (rule 1) matters. In short: it **can** issue a `DeliveryAccessToken` (if the role allows), but **never** another `SpaceAccessToken`.

6. **Never reach across the cage.** A SpaceAccessToken is not valid for **ACMA / ACDA** (Service User plane), the **Organization** plane, or the **account** plane (`/me`, PAT issuance, org creation). If a task needs any of those, this is the wrong token — use the matching identity (**`weegloo-service-architecture`** to choose).

7. **Plan / quota limits apply.** A SpaceAccessToken is a **counted, billable** resource. Create can fail with a **`WGL429*`** plan-limit error. Follow **`weegloo-global-rules`** → *Plan limit / quota exceeded*: explain, point to pricing, offer to free a slot or upgrade, and **ask** — never auto-delete other tokens or switch Space to dodge the cap.

---

## Lifecycle & authority (operational)

- **Authority = the bound `SpaceRole`.** What the token can do is decided entirely by the role bound at create time — to reason about a token's power, look at its role. The token resource does **not** echo a `role` field back, so record which role you bound.
- **`name` and `role` are immutable; only `description` is updatable.** There is no in-place role change or secret regeneration — to change the role or rotate the secret, **delete and recreate**.
- **`cma_DeleteSpaceAccessToken` fully revokes it** (server-side auth cache included). Deletion is the correct, complete revoke; there is no separate "disable".

---

## `role` — required `Refer<SpaceRole>` (create)

`role` is **required** (no default) and must be a `Refer` to the intended `SpaceRole` (scoped per rule 1), **not** a bare id string:

```json
"role": { "sys": { "type": "Refer", "id": "<SpaceRole_sys_id>", "targetType": "SpaceRole" } }
```

## Suggested workflow

1. Decide the **exact** read/write surface the use needs (which `ContentType`s, which actions, whose resources) **and where the token will live** (a server, or a public / browser client).
2. **`cma_CreateSpaceRole`** — a least-privilege role for precisely that surface (scope with `createdBy :self` / `contentType` / `tag` filters as needed — **`weegloo-space-role`**). Reuse an existing scoped role only if it already matches.
3. Copy that role's **`sys.id`** from the response → **`cma_CreateSpaceAccessToken`** with `role.sys.id` set to **only** that id.
4. Capture **`sys.accessToken`** from the response (the `SPCAT…` secret). It is a live credential, readable again on GET — handle it per where it runs (e.g. a secret manager for a backend). Rotate by delete+recreate. **If you embed it in a public client, the bound role is the only thing limiting whoever holds it — keep that role minimal.**
5. If step 3 fails with **`WGL422001`** → rule 4 (no escalation). If it fails with **`WGL429*`** → rule 7 (plan limit).

## MCP tools (typical)

| Step | MCP tool |
|------|----------|
| List roles (to pick / show `sys.id`) | `cma_GetListSpaceRoles` |
| Create least-privilege role | `cma_CreateSpaceRole` |
| Create token | `cma_CreateSpaceAccessToken` |
| List tokens | `cma_GetListSpaceAccessTokens` |
| Get one token | `cma_GetOneSpaceAccessToken` |
| Update description | `cma_UpdateOneSpaceAccessToken` |
| Delete (full revoke) | `cma_DeleteSpaceAccessToken` |

Update is **full replacement** of the updatable field set (description only); a partial JSON-Patch path also exists for app code — see **`weegloo-cma-json-patch`**. Schema: **`weegloo-api-endpoints`** → CMA OpenAPI (**`CreateSpaceAccessToken`**).

---

## Related

- **`weegloo-delivery-access-token`** — the read-only sibling for **browser/CDA** delivery. Use it, not a SpaceAccessToken, when the client is a browser that only reads.
- **`weegloo-user-login`** — the other Weegloo-User credentials: PAT (server/CI, broad) and the console FE login popup (browser admin sessions).
- **`weegloo-space-role`** — permission maps, `createdBy.sys.id`, `:self`, per-`ContentType`/`tag` scoping — how to build the least-privilege role to bind.
- **`weegloo-service-architecture`** — choosing the right token/identity per service type (where a SpaceAccessToken fits vs DAT / PAT / ServiceLogin).
- **`weegloo-api-endpoints`** — base URLs, vendor JSON media type, OpenAPI links, the token→API-surface table.

## Important

- **The bound role is the entire security boundary** — scope it to the use and its exposure (for a publicly-embedded token, tight enough that a leak is acceptable); never Administrator, never the first list item.
- Use **MCP** for CMA per project rules; do not call the REST endpoints directly as the agent.
