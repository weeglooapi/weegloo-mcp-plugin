---
name: weegloo-service-login-naver
description: Provider-specific console setup for Weegloo ServiceLogin with **Naver** (Naver Login) OAuth 2.0 — registering the Naver Developers application, getting clientId/clientSecret, the Callback URL https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/naver, the "API to use = Naver Login" and email information-to-collect selections, and the development-status/review gate limiting sign-in to registered test members. 네이버 로그인, 네이버 소셜 로그인 연동, 네이버 계정 회원가입. Use ONLY when the provider is Naver, never Google, GitHub, Facebook, GitLab, LINE or Kakao. Spine: weegloo-service-login-client; model: weegloo-service-login.
---

# Weegloo ServiceLogin — Naver provider setup

This is the **Naver instance** of the provider-agnostic ServiceLogin setup. It covers only the
**Naver Developers** side: registering the application and producing the `clientId` / `clientSecret`
that `ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK,
`callbackUrl`, `exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-client`** (the spine). This skill does **not** decide whether to use Naver —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-Naver provider** (other providers follow the same *shape*, but their console steps differ —
> Google, GitHub, Facebook, GitLab, Kakao, and LINE have their own dedicated skills).

> **Console language.** Naver Developers has **no English localization** — its console and docs are
> Korean-only. The steps below name each field by its **English meaning**; the live console shows the
> Korean equivalent, so match by meaning/position and look up the current label if a screen has moved.

## Naver's Callback URL (deploy-independent — register it now)

In the Naver Developers console, the **Callback URL** (under the **Naver Login** API settings) is, with
the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/naver
```

The leading **`+ `** renders the line green (`weegloo-global-rules` → *Highlight what the user
must act on or must know*) and is **not part of the URI** — the **Callback URL** field takes the
`https://…` text only. **Tell the user this URI up front, before you build**, not only when you
ask for the credentials (`weegloo-service-login` → *Tell the user the provider Redirect URI UP
FRONT*).

- The `/code/` segment is required — it is the **Naver → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/naver`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `naver`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Naver Developers application** and only the
user can produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the
user the illustrated walkthrough, which carries a screenshot of every step below:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/naver
```

Then summarize it inline, with the real `{spaceId}` already filled into the Callback URL above:

1. Go to **Naver Developers → Application → Register Application**. Give the user **this menu path** —
   it is the durable anchor. If you also want to hand them a clickable link, **find the current one at
   that moment rather than pasting a hardcoded/memorized URL** — Naver relocates console pages, so a
   literal URL embedded here would go stale; look it up (e.g. Naver's official "Naver Login" developer
   guide).
2. **API to use:** select **Naver Login**. Without it the app has no login capability.
3. **Information to collect (member info):** choose the fields the product needs. If the product needs
   the member's email, mark **email** as **required** here — Naver returns only the fields you selected.
4. **Environment / Callback URL:** add the **web environment that matches your product — PC web, mobile
   web, or both** — and register **exactly** the Callback URL above (with the real `{spaceId}`) under
   it. The Callback URL is the **same regardless of the user's device**: the OAuth redirect always
   targets `auth.weegloo.com`, not your app, so the "environment" only tells Naver which client
   platform the product runs on — it does not change the Callback URL. If a **service URL** is also
   required per environment, use your app's base URL (or a placeholder until deploy — it is not part of
   the OAuth handshake the way the Callback URL is).
5. On the registered app's detail page, copy the **Client ID** (`clientId`) and **Client Secret**
   (`clientSecret`).
6. Send back both values.

Then create the `ServiceLogin` with those values (provider `naver`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting Naver sign-in as done.

## Naver-specific note — development status limits who can sign in

A newly registered Naver Login application starts in **development status**: only the developer account
and explicitly **registered test members** can complete sign-in. Public users are blocked until the app
passes Naver's **review** and goes to production — analogous to Google's *Testing → Test users* gate.

Practical consequences:

- While building and demoing, add every account that must sign in as a **test member**, or sign in only
  with the developer account — otherwise sign-in fails for outside testers with no code-level fix.
- **Email is mandatory.** Weegloo **rejects the sign-in server-side** and creates **no `ServiceUser`**
  when the provider returns no email (the same email-required failure the
  **`weegloo-service-login-github`** skill documents as `WGL422056`) — so an email-less member is a
  **blocked sign-in, not a state to tolerate**. Naver returns email only if **email** is selected **and
  marked required** in the information-to-collect step (step 3), and only for accounts that actually
  have a usable email. Mark email **required** in the console, and tell end users up front that an
  account without a shared email cannot sign in.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-client`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-facebook`** (Facebook), **`weegloo-service-login-gitlab`** (GitLab), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-line`** (LINE).
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
