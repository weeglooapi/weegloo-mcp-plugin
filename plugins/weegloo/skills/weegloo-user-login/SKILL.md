---
name: weegloo-user-login
description: Weegloo User login — authenticate a Weegloo platform account (Space owner or invited user) so the caller can hit CMA, Upload, and CDA as an admin. NOT for the public; there is no self-signup — identity is provisioned by Weegloo via Space-membership invitations. Two mechanisms produce a Weegloo User Bearer Token, Personal Access Token (PAT) for server-side / CI / scripts, and the Weegloo Console FE login popup (origin-checked postMessage → sessionStorage) for browser apps including static sites on Weegloo WebHosting. Use when building an API-driven custom admin UI, a Weegloo-User-only "internal" product, or wiring CMA-authenticated editing from a static site. Contrast with `weegloo-service-login`, which is end-user sign-up for the product itself and whose token is scoped to ACMA / ACDA / Upload (never CMA / CDA).
---

# Weegloo — User login (admin / platform account)

## The two login models in Weegloo (read this first)

Weegloo has **two completely separate identity systems**. The rest of this skill — and the entire `weegloo-service-login` family of skills — assumes this distinction.

| | **Weegloo User login** (this skill) | **Service User login** |
|---|---|---|
| Who is the identity? | A **Weegloo platform account** — the human who owns a Space, or who was **invited** to it as a Space member. | An **end-user of the product** the Space ships (e.g. a member of a forum the Space runs). |
| Who runs the user directory? | **Weegloo** itself. One account, many Spaces (via memberships). | The **Space**. One directory per Space, **separate** from Weegloo accounts. |
| Self sign-up? | **No.** Onboarding is by **Space invitation** (or by being a Space owner). The general public cannot get in. | **Yes.** Anyone can sign up through the product — that is the entire point. |
| Perspective in the product | **Admin / staff** of the product. | **Member / customer / reader** of the product. |
| Token authorises which APIs? | **CMA**, **Upload**, **CDA**. (Management plane + uploads + delivery.) | **ACMA**, **ACDA**, and **Upload**. Never CMA / CDA. Member media flow is Upload → ACMA Media create. |
| Documented in | **`weegloo-user-login`** (this skill). | **`weegloo-service-login`** + **`weegloo-service-login-sdk`** skills. |

**Quick disambiguation:** if the identity in front of you was **invited** to a Space and edits content there, it is a **Weegloo User**. If the identity **signed up through the product** (typically via the Space's OAuth providers) it is a **Service User** — stop reading this skill and go to **`weegloo-service-login`**.

## When to use Weegloo User login

Weegloo User login is the right model when **any** of the following are true:

- **API-driven custom admin UI.** The team prefers to manage content through your own interface (CMA / Upload calls) instead of, or in addition to, the Weegloo Console. The site signs the admin in as their **Weegloo User** and calls CMA on their behalf.
- **Weegloo-User-only "internal" product.** The whole product is gated to Weegloo Users on a particular Space — anyone who has not been **invited** to that Space cannot get past the login screen. This is the right pattern for staff dashboards, internal tooling, and secret previews — **not** for paid member areas (use Service User for paid customers).
- **Server-side / CI scripts that talk to Weegloo.** Backfills, scheduled jobs, build-time content fetches, deploy automation. These run with a Weegloo User identity supplied as a **PAT**.

It is **wrong** to use Weegloo User login for end-users of a product (paid members, community readers, forum posters, app sign-ups). Use **ServiceLogin** for that — see **`weegloo-service-login`**.

## Token scope — what a Weegloo User Bearer Token authorizes

A Weegloo User Bearer Token (PAT or one obtained via the console FE login popup) is valid against:

- **CMA** (`https://cma.weegloo.com`) — full read / create / update / delete / publish on resources the user's `SpaceRole` permits.
- **Upload** (`https://upload.weegloo.com`) — file uploads, normally followed by a CMA call to attach the resulting Media.
- **CDA** (`https://cda.weegloo.com`) — reads of published resources as that user. In **production**, public CDA reads should still use a least-privilege **`DeliveryAccessToken`** (**`weegloo-delivery-access-token`** skill) so the client is least-privileged; the Weegloo User token is broader than the public site needs.

It is **not** the right token for **ACMA** or **ACDA** — those require a **Service User** Bearer Token issued by `ServiceLogin`. See **`weegloo-api-endpoints`** for base URLs and the vendor JSON media type, and **`weegloo-service-login`** for the contrasting identity model.

## Authentication mechanisms

Two mechanisms can produce a Weegloo User Bearer Token. Pick the one that matches the runtime.

### Mechanism A — Personal Access Token (PAT) for server-side / CI / scripts

- A long-lived secret issued from the **Weegloo Console** for a specific Weegloo User. See the project README and `installer-cli/README.md` for issuance; the same token also feeds the Weegloo MCP servers via `AUTH_BEARER_TOKEN`.
- Use it as **`Authorization: Bearer <PAT>`** when calling CMA / Upload / CDA from a **server**, **CI job**, **CLI**, or **local dev script**.
- **Never ship a PAT to a browser.** It is too privileged and too long-lived for client distribution. If a browser app needs a Weegloo User session, use Mechanism B.

### Mechanism B — Weegloo Console FE login popup, for browser apps

When the runtime is a **browser** — for example a custom admin UI deployed as a static site on Weegloo WebHosting — open a popup to the Weegloo Console FE, let the user sign in to Weegloo there, and receive the access token back via `postMessage`. The rest of this skill documents that flow.

The flow is **not WebHosting-specific** even though static-site admin UIs are the most common use case (no server to perform a normal OAuth exchange). It also works on any other browser-hosted site that wants a CMA session against Weegloo.

---

## Console FE login popup — implementation

This section assumes Mechanism B (browser, no backend).

### Platform context

- The browser stores the **CMA access token** (typically in **`sessionStorage`**) after the console posts it back. On Weegloo WebHosting in particular, **there is no server** to hold secrets or exchange OAuth codes.
- **Never** send **`Accept: application/json`** to Weegloo APIs — use vendor negotiation per **`weegloo-api-endpoints`** (omit `Accept` or use the documented vendor type) to avoid **406** and related issues.

### 1. Register a `message` listener (once per page lifecycle)

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

### 2. Open the login popup

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
- **`origin`** query param — must be the **exact** origin of the app (scheme + host + port), matching **`location.origin`**.
- If the product supports **multiple console bases** (dev vs prod), read the FE base from **`NEXT_PUBLIC_*`** or your app's runtime config and build  
  `{feOrigin}/login?origin=${encodeURIComponent(location.origin)}`.

### 3. Persist the token from `postMessage`

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

### 4. Validate the login with CMA **`GET /me`**

With **`Authorization: Bearer <access_token>`**, call:

- **`GET {CMA_BASE}/v1/me`**

If the response is **200 OK** and the body is usable, the token is **valid for CMA** (the user is authenticated to Weegloo as that Weegloo User).

**Failure** (401, 403, network error): treat as **not logged in** — clear **`access_token`** and update UI.

**Headers:** follow **`weegloo-api-endpoints`** — do **not** send **`Accept: application/json`**.

### 5. Enforce Space membership (gate to *this* Space)

A valid **`/me`** token is **not** enough for a **space-scoped** admin UI. The user must have a **Space membership** for the **Space** this product manages — being a Weegloo User in general is not the same as being invited to *this* Space.

1. Determine **`SPACE_ID`** for this deploy (from build-time env, runtime config, or product config).
2. Call **`GET {CMA_BASE}/v1/me/space-memberships`** with **`Authorization: Bearer`** and filter so the result includes membership for **`SPACE_ID`** (query params or client-side filter per CMA docs — e.g. filter by space id if supported).
3. If **no membership** exists for that **Space**: the user must **not** be treated as admin for this product — **clear `sessionStorage` `access_token`** (logout) and show an appropriate message.

> **Response shape — the `space` ref is nested under `sys`, not at the item root.** Each `items[]` element is a **`SpaceMembership`** whose target Space lives at **`item.sys.space.sys.id`**:
>
> ```json
> { "items": [
>   { "sys": { "type": "SpaceMembership", "space": { "sys": { "id": "i4ZfqXFL" } } } }
> ] }
> ```
>
> **Correct membership check** (gate to this Space):
> ```js
> const isMember = (resp.items || []).some(
>   m => m.sys && m.sys.space && m.sys.space.sys && m.sys.space.sys.id === SPACE_ID
> );
> ```
> **Wrong — `m.space` is `undefined`, so this is always `false` and every real member is rejected:**
> ```js
> (resp.items || []).some(m => m.space && m.space.sys && m.space.sys.id === SPACE_ID) // ❌
> ```
> This is a Weegloo-wide convention: on membership resources the related resource (`space` / `organization`) is carried under **`sys`** (alongside `sys.type`), not flattened onto the item. **`/me/organization-memberships`** follows the same pattern (`item.sys.organization.sys.id`). Don't guess the path — read `item.sys.*`.

This matches the rule in **`weegloo-global-rules`**: use **`/me/space-memberships`**, not **`/organizations`**, for "my spaces".

### 6. Logout

To log out:

- **`sessionStorage.removeItem("access_token")`**
- Optionally **`postMessage`** / close popup / refresh UI — product-specific.

There is no server-side session to revoke unless the product also calls a CMA revoke endpoint (uncommon for this static pattern).

---

## End-to-end checklist (FE popup mechanism)

| Step | Action |
|------|--------|
| 1 | Single **`message`** listener; **`event.origin`** === console FE origin |
| 2 | **`window.open`** → `{console}/login?origin=encodeURIComponent(location.origin)` |
| 3 | On message: **`event.data.accessToken`** → **`sessionStorage.setItem("access_token", …)`** |
| 4 | **`GET /v1/me`** with Bearer → **200** ⇒ token valid as a Weegloo User |
| 5 | **`GET /v1/me/space-memberships`** → must include **target `SPACE_ID`** at **`item.sys.space.sys.id`** (nested under `sys`, **not** `item.space`); else remove token |
| 6 | Logout ⇒ **`sessionStorage.removeItem("access_token")`** |

---

## Security notes

- Anything in **static JS** and **sessionStorage** is visible to the user — treat **`access_token`** as sensitive; use **short-lived** tokens and **least-privilege** Space roles where possible.
- **Origin check** on **`postMessage`** is mandatory.
- Prefer **`sessionStorage`** over **`localStorage`** for tab-scoped admin sessions unless requirements say otherwise.
- **Never** put a **PAT** in client-side code. PATs are for servers, CI, and developer scripts only.

---

## Related

- **End-user / member sign-up for the product itself (Service User, ACMA/ACDA):** **`weegloo-service-login`** skill.
- **OAuth wire protocol + browser SDK for the Service User flow:** **`weegloo-service-login-sdk`** skill.
- **Picking the right login model per service type:** **`weegloo-service-architecture`** skill.
- **Deploy ZIP / WebHosting platform constraints:** **`weegloo-web-hosting`** skill.
- **HTTP bases / `Accept` header / OpenAPI links / token-scope rules:** **`weegloo-api-endpoints`** rule.
- **Public read tokens for CDA (preferred over a Weegloo User token in the browser):** **`weegloo-delivery-access-token`** skill.
- **Space-scoped write token (bound to a `SpaceRole`; write-capable, for one Space):** **`weegloo-space-access-token`** skill.
- **SpaceRole permission filters (`createdBy`, `:self`):** **`weegloo-space-role`** skill.
