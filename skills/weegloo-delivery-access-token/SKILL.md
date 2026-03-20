---
name: weegloo-delivery-access-token
description: Create Weegloo DeliveryAccessToken (CDA) safely via CMA—least-privilege SpaceRole only; never Administrator; ask the user if the role cannot be created or chosen. Skill text in English only.
---

# Weegloo Delivery Access Token (CDA)

## When to use

- When creating a **`DeliveryAccessToken`** for the **CDA API** (browser or server read-only clients), via MCP **`cma_CreateDeliveryAccessToken`** or equivalent CMA flow.
- When the user asks for a “CDA token”, “delivery token”, or **`env.js` / `DELIVERY_ACCESS_TOKEN`** provisioning backed by a new token.

## Why this skill exists

**`cma_CreateDeliveryAccessToken`** requires a **`role`** argument: a **`Refer`** to a **`SpaceRole`**. LLMs often pick the first role they find—frequently **Administrator**—which yields a **highly privileged** token. That is a **critical security flaw** for public or browser-exposed tokens.

---

## Mandatory rules

1. **Never** create a **`DeliveryAccessToken`** using the **Administrator** **`SpaceRole`** (or any role that grants **broad write/admin** access equivalent to running the Space as an admin). **No exceptions** for agent workflows—if the user insists, refuse and explain risk; they must create such a token themselves in the console if they truly intend it.

2. **Preferred path:** Create a **dedicated least-privilege `SpaceRole`** that grants **read** access **only** to the **`ContentType`(s)** the product actually needs for CDA, then reference that role in **`cma_CreateDeliveryAccessToken`**.
   - Use CMA **`cma_CreateSpaceRole`**. For HTTP schema details (**`CreateSpaceRole`**, permission payloads), open **CMA Swagger UI** and **OpenAPI JSON** only via the **`weegloo-api-endpoints`** Cursor rule—do **not** duplicate URLs in this skill.
   - Scope permissions to **minimum read** for those types; do **not** add create/update/delete unless the user clearly requires them (they usually do **not** for CDA-only sites).

3. **If you cannot create a `SpaceRole`** (missing rights, policy, or tool failure): **do not guess.**
   - Call **`cma_GetListSpaceRoles`** (and **`cma_GetOneSpaceRole`** if needed) to gather **`sys.id`**, **`name`**, and **`description`** (and any summary fields available).
   - **Present the list to the user** and **ask which `SpaceRole` ID** to bind to the **`DeliveryAccessToken`**.
   - **Stop** until the user answers with an explicit choice.

4. **Never** choose a **`SpaceRole`** silently. **No** “first role in the list”, **no** defaulting to Administrator, **no** inferred “probably Editor”. **Security-sensitive.**

---

## MCP tools (typical)

| Step | MCP tool |
|------|----------|
| List roles | `cma_GetListSpaceRoles` |
| Inspect one role | `cma_GetOneSpaceRole` |
| Create least-privilege role | `cma_CreateSpaceRole` |
| Create token | `cma_CreateDeliveryAccessToken` |

**`cma_CreateDeliveryAccessToken`**: requires **`spaceId`**, **`name`**, and **`role`** where **`role.sys`** is a **`Refer`** to the chosen **`SpaceRole`** (**`targetType`** must match the API schema, e.g. **`SpaceRole`**). Full schema: **`weegloo-api-endpoints`** → CMA Swagger / OpenAPI (**`CreateDeliveryAccessToken`**).

---

## Suggested workflow

1. From the product (or user), list which **published `ContentType`s** CDA must **read**.
2. If permitted: **`cma_CreateSpaceRole`** with **read-only** (or minimal) permissions for **only** those types; name it clearly (e.g. `cda-read-resume-types`).
3. **`cma_CreateDeliveryAccessToken`** with **`role`** → that new **`SpaceRole`**’s **`sys.id`**.
4. If step 2 is not possible: show **`cma_GetListSpaceRoles`** results; **require explicit user selection** of **`SpaceRole` id** before **`cma_CreateDeliveryAccessToken`**.
5. Remind the user: tokens used in **`env.js` / browsers** are **exposed**—least privilege is **mandatory**.

---

## Important

- **Agents** must use **MCP** for CMA operations per project rules—do not hand-craft REST for token creation in the agent path unless the user is doing local dev outside MCP.
- **Administrator**-backed delivery tokens can **read and mutate** everything that role allows—unacceptable for typical marketing/resume/market templates.
