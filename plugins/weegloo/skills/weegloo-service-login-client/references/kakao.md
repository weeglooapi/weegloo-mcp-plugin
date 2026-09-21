# Kakao — ServiceLogin console setup

Read this **only when** the chosen provider is Kakao (`kakao`). It assumes the spine (`SKILL.md`):
the wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token boundary are
there, not here.

## Kakao's Redirect URI (deploy-independent — register it now)

In the Kakao Developers console, the **Redirect URI** (under **Kakao Login**) is, with the real
`{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/kakao
```

The leading `+ ` is **not part of the URI** — Kakao's **Redirect URI** field takes the `https://…`
text only.

**Tell the user this URI up front, before you build** (`weegloo-service-login` → *Tell the user the
provider Redirect URI UP FRONT*), not only when you ask for the credentials.

- The `/code/` segment is required — it is the **Kakao → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/kakao`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `kakao`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **F**, *Two URLs, two lifetimes*).
  `callbackUrl` is the deploy-dependent one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Kakao Developers app** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user the
illustrated walkthrough, which carries a screenshot of every step below:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/kakao
```

Then summarize it inline, with the real `{spaceId}` already filled into the Redirect URI above:

1. Go to **Kakao Developers → My Application** and create (or select) an app. Give the user **this menu
   path** — it is the durable anchor. If you also want to hand them a clickable link, **find the current
   one at that moment rather than pasting a hardcoded/memorized URL** — Kakao relocates console pages,
   so a literal URL embedded here would go stale; look it up (e.g. Kakao's official "Kakao Login"
   REST API / Getting Started docs).
2. **`clientId` = the app's REST API key**, not the JavaScript key or Native key. Find it under **App
   settings → App Keys → REST API key**. Copy that — using the wrong key silently breaks the
   server-side token exchange.
3. **Activate Kakao Login:** **Product settings → Kakao Login**, and set the **Activation** toggle to
   **ON**. Sign-in stays inert until this is on.
4. **Register the Redirect URI:** still under **Kakao Login**, add **exactly** the Redirect URI above
   (with the real `{spaceId}`). If the console also requires a registered **Web platform** site domain
   before it will save a Redirect URI, register `https://auth.weegloo.com` there (**App settings →
   Platform → Web**) — the browser reaches Kakao via `auth.weegloo.com`, never your app directly.
5. **Generate AND enable the Client Secret:** **Kakao Login → Security → Client secret**, generate a
   code, then set its **activation state** to **Enable**. Copy the generated value — this is
   `clientSecret`. A secret that is generated but left **disabled** (or never generated) is a common
   cause of exchange failures once Weegloo sends it.
6. Send back the **REST API key** (`clientId`) and the **Client secret** (`clientSecret`).

## Kakao-specific note — email is mandatory, and Kakao gates it

**Weegloo requires a member email.** If the provider returns none, Weegloo **rejects the sign-in
server-side** (before any callback) and **no `ServiceUser` is created** — the same email-required
failure Weegloo raises as `WGL422056`. A member with no email is therefore a **blocked sign-in, not a
state to design around**: without an email the person simply **cannot use the service**.

Kakao makes this easy to hit: it does **not** return an email unless the **Kakao Account (email)**
consent item is enabled under **Kakao Login → Consent Items**, and Kakao gates the email scope behind
additional verification — typically **Business app** registration and its review. (Kakao changes these
requirements periodically; confirm the current gate at setup time rather than assuming.)

So treat email as **mandatory setup**, not optional:

- Enable the **Kakao Account (email)** consent item and complete whatever **Business-app / review** step
  Kakao currently requires **before** launch — it is not a runtime toggle you can flip later without
  Kakao's review.
- Even with it enabled, a user who **declines** the email consent, or whose Kakao account has **no
  email**, still cannot sign in — and the abort is server-side and unrecoverable in code, so **tell end
  users up front** that a shared email is required (same lever as the GitHub case).

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `kakao`, plus
`defaultRole` and `callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole`
created and the credentials written off as "add later" — a role with no `ServiceLogin` is
**blocked-pending-input**, so end the turn by *asking for the credentials*, not by reporting Kakao
sign-in as done.
