---
name: weegloo-service-login-kakao
description: Provider-specific setup for Weegloo ServiceLogin with **Kakao** (Kakao Login) OAuth 2.0 — the exact Kakao Developers steps to create an app and obtain the `clientId` / `clientSecret`, the Kakao Redirect URI to register (`https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/kakao`), the REST-API-key-is-the-clientId gotcha, the Client Secret generate-and-enable gotcha, the consent-item / Business-app requirement for email, and the walkthrough to hand the user when asking for the blocking credentials. Use ONLY when the chosen provider is Kakao. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for Google, GitHub, Facebook, GitLab, LINE, or Naver.
---

# Weegloo ServiceLogin — Kakao provider setup

This is the **Kakao instance** of the provider-agnostic ServiceLogin setup. It covers only the
**Kakao Developers** side: creating the app and producing the `clientId` / `clientSecret` that
`ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use Kakao —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-Kakao provider** (other providers follow the same *shape*, but their console steps differ —
> Google, GitHub, Naver, and LINE have their own dedicated skills; Facebook and GitLab ride the spine's
> generic shape).

## Kakao's Redirect URI (deploy-independent — register it now)

In the Kakao Developers console, the **Redirect URI** (under **Kakao Login**) is, with the real
`{spaceId}` substituted:

```
https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/kakao
```

- The `/code/` segment is required — it is the **Kakao → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/kakao`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `kakao`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Kakao Developers app** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user this
step-by-step walkthrough, with the real `{spaceId}` already filled into the Redirect URI above:

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

Then create the `ServiceLogin` with those values (provider `kakao`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting Kakao sign-in as done.

## Kakao-specific note — email is mandatory, and Kakao gates it

**Weegloo requires a member email.** If the provider returns none, Weegloo **rejects the sign-in
server-side** (before any callback) and **no `ServiceUser` is created** — the same email-required
failure the **`weegloo-service-login-github`** skill documents as `WGL422056`. A member with no email is
therefore a **blocked sign-in, not a state to design around**: without an email the person simply
**cannot use the service**.

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

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
