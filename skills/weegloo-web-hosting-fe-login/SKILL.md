---
name: weegloo-web-hosting-fe-login
description: Browser admin login for sites on Weegloo WebHosting — console FE popup, postMessage accessToken, sessionStorage, CMA /me + space-membership checks. English only.
---

# Weegloo WebHosting — FE console login (static sites)

## When to use

- Implementing **admin / CMA-authenticated editing** from a **static** site (ZIP on **Weegloo WebHosting**), with **no backend**.
- Wiring **Weegloo console (FE) login** in a **popup**, receiving the **access token** via **`postMessage`**, then validating with **CMA** from the browser.

## Platform context

- **WebHosting serves static files only** — there is **no server** to hold secrets or exchange OAuth codes. The **browser** stores the **CMA access token** (e.g. **`sessionStorage`**) after the console posts it back.
- **Never** send **`Accept: application/json`** to Weegloo APIs — use vendor negotiation per **`weegloo-api-endpoints`** (omit `Accept` or use the documented vendor type) to avoid **406** and related issues.

---

## 1. Register a `message` listener (once per page lifecycle)

Listen for **`postMessage`** from the **Weegloo console FE origin** only.

**Production example** (adjust origin if your environment uses a different console host, e.g. a dev FE):

```javascript
window.addEventListener("message", (event) => {
  if (event.origin !== "https://console.weegloo.com") return
  console.log("Token received:", event.data)
  // Handle token — see section 3
})
```

**Requirements:**

- **Strict `event.origin` check** — do not trust messages from other origins.
- Register **once** (e.g. app root client mount) to avoid duplicate handlers.
- Optionally gate **`console.log`** to development builds so tokens are not logged in production.

---

## 2. Open the login popup

Open the console **login** URL with the **current site origin** so the console can post the token back to the opener:

```javascript
const popup = window.open(
  "https://console.weegloo.com/login?origin=" +
    encodeURIComponent(location.origin),
  "weegloo-login",
  "width=500,height=600"
)
```

**Notes:**

- **`name`** (`"weegloo-login"`) — reuse the same name so repeated clicks target the same window where appropriate.
- **`origin`** query param — must be the **exact** origin of the static app (scheme + host + port), matching **`location.origin`**.
- If the product supports **multiple console bases** (dev vs prod), read the FE base from **`window.__ENV__`** / **`NEXT_PUBLIC_*`** and build  
  `{feOrigin}/login?origin=${encodeURIComponent(location.origin)}`.

---

## 3. Persist the token from `postMessage`

After the console completes login, it **`postMessage`s** to the opener. The payload includes the token:

- Read **`event.data.accessToken`** (camelCase as specified by the FE contract).
- If present and non-empty, store it in **`sessionStorage`** under the key **`access_token`**:

```javascript
const token = event.data?.accessToken
if (typeof token === "string" && token.trim()) {
  sessionStorage.setItem("access_token", token.trim())
}
```

Do **not** use **`localStorage`** unless the product explicitly requires persistence across tabs/sessions — **`sessionStorage`** limits exposure to the tab.

---

## 4. Validate login with CMA **`GET /me`**

With **`Authorization: Bearer <access_token>`**, call:

- **`GET {CMA_BASE}/v1/me`**

If the response is **200 OK** and the body is usable, the token is **valid for CMA** (user is authenticated to Weegloo as that principal).

**Failure** (401, 403, network error): treat as **not logged in** — clear **`access_token`** and update UI.

**Headers:** follow **`weegloo-api-endpoints`** — do **not** send **`Accept: application/json`**.

---

## 5. Enforce Space membership (service-scoped “admin”)

A valid **`/me`** token is **not** enough for a **space-scoped** app. The user must have a **Space membership** for the **Space** this site manages.

1. Determine **`SPACE_ID`** for this deploy (from **`window.__ENV__`**, build-time env, or product config).
2. Call **`GET {CMA_BASE}/v1/me/space-memberships`** with **`Authorization: Bearer`** and filter so the result includes membership for **`SPACE_ID`** (query params or client-side filter per CMA docs — e.g. filter by space id if supported).
3. If **no membership** exists for that **Space**: the user must **not** be treated as admin for this service — **clear **`sessionStorage`** `access_token`** (logout) and show an appropriate message.

This matches the rule in **`weegloo-global-rules`**: use **`/me/space-memberships`**, not **`/organizations`**, for “my spaces”.

---

## 6. Logout

To log out:

- **`sessionStorage.removeItem("access_token")`**
- Optionally **`postMessage`** / close popup / refresh UI — product-specific.

No server-side session to revoke unless the product also calls a CMA revoke endpoint (uncommon for this static pattern).

---

## End-to-end checklist (LLM / implementer)

| Step | Action |
|------|--------|
| 1 | Single **`message`** listener; **`event.origin`** === console FE origin |
| 2 | **`window.open`** → `{console}/login?origin=encodeURIComponent(location.origin)` |
| 3 | On message: **`event.data.accessToken`** → **`sessionStorage.setItem("access_token", …)`** |
| 4 | **`GET /v1/me`** with Bearer → **200** ⇒ token valid |
| 5 | **`GET /v1/me/space-memberships`** → must include **target `SPACE_ID`**; else remove token |
| 6 | Logout ⇒ **`sessionStorage.removeItem("access_token")`** |

---

## Security notes

- Anything in **static JS** and **sessionStorage** is visible to the user — treat **`access_token`** as sensitive; use **short-lived** tokens and **least-privilege** roles where possible.
- **Origin check** on **`postMessage`** is mandatory.
- Prefer **`sessionStorage`** over **`localStorage`** for tab-scoped admin sessions unless requirements say otherwise.

---

## Related

- **Deploy ZIP / env.js:** **`weegloo-web-hosting`** skill.
- **HTTP bases / Accept / OpenAPI links:** **`weegloo-api-endpoints`** rule.
- **MCP** is for **management** (deploy, CMA from agents); **this flow runs in the end user’s browser** against **CMA** with the stored token.
