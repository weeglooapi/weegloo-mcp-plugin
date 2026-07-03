---
name: weegloo-service-login-github
description: Provider-specific setup for Weegloo ServiceLogin with **GitHub** OAuth 2.0 — the exact GitHub steps to register an OAuth App and obtain the `clientId` / `clientSecret`, the GitHub Authorization callback URL to register (`https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/github`), the single-callback-URL and generate-secret-shown-once gotchas, and the walkthrough to hand the user when asking for the blocking credentials. Use ONLY when the chosen provider is GitHub. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for another provider (Google, Facebook, GitLab, LINE, Kakao, or Naver).
---

# Weegloo ServiceLogin — GitHub provider setup

This is the **GitHub instance** of the provider-agnostic ServiceLogin setup. It covers only the
**GitHub** side: registering the OAuth App and producing the `clientId` / `clientSecret` that
`ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use GitHub —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-GitHub provider** (other providers follow the same *shape*, but their console steps differ —
> Google, Kakao, Naver, and LINE have their own dedicated skills; Facebook and GitLab ride the spine's
> generic shape — see *Configuration responsibilities* in the spine).

## GitHub's Authorization callback URL (deploy-independent — register it now)

In the GitHub OAuth App, the **Authorization callback URL** is, with the real `{spaceId}` substituted:

```
https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/github
```

- The `/code/` segment is required — it is the **GitHub → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/github`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `github`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.
- **GitHub OAuth Apps allow exactly one callback URL** (unlike GitHub *Apps*). So this single value must
  be the `…/code/github` URL above — don't try to also list your app's `callbackUrl` here.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own GitHub OAuth App** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user this
step-by-step walkthrough, with the real `{spaceId}` already filled into the callback URL above:

1. Go to **GitHub → your profile menu → Settings → Developer settings → OAuth Apps**, then click **New
   OAuth App** (the button reads **Register a new application** the first time). Give the user **this
   menu path** — it is the durable anchor. To register the app under an **organization** instead of a
   personal account, go via **Your organizations → (org) Settings → Developer settings → OAuth Apps**.
   If you also want to hand them a clickable link, **find the current one at that moment rather than
   pasting a hardcoded/memorized URL** — look it up (e.g. GitHub's official "Creating an OAuth app" doc).
2. Fill the form:
   - **Application name** — any user-facing name.
   - **Homepage URL** — your app's URL (a placeholder like the eventual site URL is fine; it is not part
     of the OAuth handshake).
   - **Authorization callback URL** — paste **exactly** the callback URL above (with the real
     `{spaceId}`). This is the one field that matters for sign-in.
   - There is **no "OAuth consent screen" / Test users** step (that is Google-only) and **no JavaScript
     origins** field — the browser navigates to `auth.weegloo.com`, never to GitHub directly.
   - You do **not** pick OAuth scopes here — there is no scope field on a GitHub OAuth App. Weegloo
     requests the scopes it needs (`read:user`, `user:email`) automatically at sign-in. The user only
     supplies the `clientId` / `clientSecret` and the callback URL.
3. Click **Register application**. On the app's settings page, copy the **Client ID** (always visible).
4. Next to **Client secrets**, click **Generate a new client secret**. **GitHub shows the secret value
   only once** — copy it immediately. (If it is lost, generate a new one and update `ServiceLogin`.)
5. Send back both the **Client ID** and the **Client secret**.

Then create the `ServiceLogin` with those values (provider `github`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting GitHub sign-in as done.

## GitHub-specific note — email retrieval can block first sign-in

Weegloo reads the member's email from `GET https://api.github.com/user` only; it does **not** fall back
to GitHub's `/user/emails`. So although Weegloo requests the `read:user` and `user:email` scopes, a
GitHub account whose email is **private** (GitHub's default) returns `email: null` from `/user`, and
Weegloo aborts the sign-in with `WGL422056`.

Where this surfaces matters: it happens server-side on the `…/login/oauth2/code/github` callback,
**before** any redirect to your `callbackUrl`. Weegloo responds with an HTTP 400 and a localized JSON
body on the `auth.weegloo.com` domain (the body carries a localized reason/suggestion, not the literal
`WGL422056` string). There is no `exchangeToken` and no return trip to the app, so the SDK's
`handleCallback()` never runs — the product **cannot intercept or recover from this case at runtime**.

Unlike Google (which always returns a verified email), this is a first-sign-in failure mode specific to
GitHub: the account must have a **public profile email** (GitHub → Settings → Public profile → Email).
Since it can't be handled in code, the only real lever is communicating it to users up front — apply
your own judgment on whether and where that belongs for the product you're building.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
