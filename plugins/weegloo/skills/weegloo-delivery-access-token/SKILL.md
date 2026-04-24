---
name: weegloo-delivery-access-token
description: Create Weegloo DeliveryAccessToken (CDA) via CMA—bind role.sys.id to the intended least-privilege SpaceRole only; never Administrator or first list item; handle WGL422001 without fallback. Skill text in English only.
---

# Weegloo Delivery Access Token (CDA)

## When to use

- When creating a **`DeliveryAccessToken`** for the **CDA API** (browser or server read-only clients), via MCP **`cma_CreateDeliveryAccessToken`** or equivalent CMA flow.
- When the user asks for a “CDA token”, “delivery token”, or **`env.js` / `DELIVERY_ACCESS_TOKEN`** provisioning backed by a new token.

## Why this skill exists

**`cma_CreateDeliveryAccessToken`** requires a **`role`**: a **`Refer`** to a **`SpaceRole`**. Agents often pass the **wrong** role—typically the **first** entry from **`cma_GetListSpaceRoles`** (**Administrator**)—or **replace** the intended least-privilege role after an error. Tokens used in browsers must be **least-privilege** only.

---

## Mandatory rules

1. **Never** create a **`DeliveryAccessToken`** using the **Administrator** **`SpaceRole`** (or any role with **broad write/admin** access). **No exceptions** in agent workflows; if the user insists, refuse and explain; they may use the console themselves.

2. **Bind `role` to the intended `SpaceRole` by `sys.id`.** If you just created a read-only **`SpaceRole`** for CDA, **`cma_CreateDeliveryAccessToken`** MUST set **`role.sys.id`** to **that** role’s **`sys.id`** from the **`cma_CreateSpaceRole`** response (or from **`cma_GetOneSpaceRole`** for a user-approved role). **Do not** substitute another id from a fresh list; **do not** use Administrator.

3. **Preferred order:** **`cma_CreateSpaceRole`** (read-only for the **`ContentType`s** CDA needs) → copy **`sys.id`** from the response → **`cma_CreateDeliveryAccessToken`** with **`role`** referencing **only** that id. OpenAPI: **`weegloo-api-endpoints`** (do not duplicate URLs here).

4. **Required `role` shape:**

```json
"role": {
  "sys": {
    "type": "Refer",
    "id": "<SpaceRole_sys_id>",
    "targetType": "SpaceRole"
  }
}
```

5. **If you cannot create a `SpaceRole`:** call **`cma_GetListSpaceRoles`**, show **non-Administrator** roles with **`name`** and **`sys.id`**, **require the user to choose `sys.id`**, then use **only** that id. **Do not** default to the first list item.

6. **Never** pick a **`SpaceRole`** silently.

---

## Error `WGL422001` (cannot assign permission you do not own)

If **`cma_CreateDeliveryAccessToken`** fails with an ownership / permission error while using the **correct** least-privilege **`SpaceRole`**:

- **Do not** fall back to **Administrator**.
- **Do:** explain; options include creating the token in the **Weegloo console** with the same **`SpaceRole`**, or using a CMA principal that may assign that role.

Do **not** treat Administrator as an acceptable workaround for public **`env.js`** tokens.

---

## Suggested workflow

1. Identify **published `ContentType`s** CDA must read.
2. **`cma_CreateSpaceRole`** with read-only rules and a clear **`name`** (product-specific; chosen by the team).
3. **`sys.id`** from the **create response** → pass into **`cma_CreateDeliveryAccessToken`** as **`role.sys.id`**.
4. If step 3 fails with **`WGL422001`**: follow the section above—**no** Administrator fallback.

---

## MCP tools (typical)

| Step | MCP tool |
|------|----------|
| List roles | `cma_GetListSpaceRoles` |
| Inspect one role | `cma_GetOneSpaceRole` |
| Create least-privilege role | `cma_CreateSpaceRole` |
| Create token | `cma_CreateDeliveryAccessToken` |

Schema: **`weegloo-api-endpoints`** → CMA OpenAPI (**`CreateDeliveryAccessToken`**).

---

## Important

- Use **MCP** for CMA per project rules where applicable.
- **`env.js`** tokens are **public**—least privilege is mandatory.
- Administrator-backed delivery tokens are **not** acceptable for typical **public, browser-exposed** CDA clients.
