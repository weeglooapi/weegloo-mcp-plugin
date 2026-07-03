---
name: weegloo-service-login-line
description: Provider-specific setup for Weegloo ServiceLogin with **LINE** (LINE Login) OAuth 2.0 — the exact LINE Developers steps to create a LINE Login channel and obtain the `clientId` / `clientSecret` (= Channel ID / Channel secret), the LINE Callback URL to register (`https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/line`), the LINE-"Provider"-is-not-Weegloo's-provider terminology trap, and the separate email-permission application gotcha. Use ONLY when the chosen provider is LINE. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for Google, GitHub, Facebook, GitLab, Kakao, or Naver.
---

# Weegloo ServiceLogin — LINE provider setup

This is the **LINE instance** of the provider-agnostic ServiceLogin setup. It covers only the
**LINE Developers** side: creating the LINE Login channel and producing the `clientId` / `clientSecret`
that `ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK,
`callbackUrl`, `exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use LINE —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-LINE provider** (other providers follow the same *shape*, but their console steps differ —
> Google, GitHub, Kakao, and Naver have their own dedicated skills; Facebook and GitLab ride the spine's
> generic shape).

> **Terminology trap — LINE's "Provider" is NOT Weegloo's `{provider}`.** In the LINE Developers
> console, a **Provider** is an owner/organization container, and under it you create **Channels**. The
> Weegloo `{provider}` value is `line`; the thing you create in LINE's console is a **LINE Login
> channel**. Don't conflate the two.

## LINE's Callback URL (deploy-independent — register it now)

In the LINE Login channel, the **Callback URL** (under the channel's **LINE Login** settings) is, with
the real `{spaceId}` substituted:

```
https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/line
```

- The `/code/` segment is required — it is the **LINE → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/line`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `line`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own LINE Login channel** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user this
step-by-step walkthrough, with the real `{spaceId}` already filled into the Callback URL above:

1. Go to **LINE Developers Console → (create or select a) Provider → Create a new channel → LINE Login**.
   Give the user **this menu path** — it is the durable anchor. If you also want to hand them a
   clickable link, **find the current one at that moment rather than pasting a hardcoded/memorized
   URL** — LINE relocates console pages, so a literal URL embedded here would go stale; look it up
   (e.g. LINE's official "LINE Login / Integrating LINE Login" docs).
2. Fill the channel form (channel name, region, etc.) and ensure the **Web app** app type is enabled —
   the browser reaches LINE via `auth.weegloo.com`, so no native/mobile app type is needed for this flow.
3. **Register the Callback URL:** on the channel's **LINE Login** tab, add **exactly** the Callback URL
   above (with the real `{spaceId}`).
4. **Get the credentials:**
   - **`clientId` = Channel ID** — on the channel's **Basic settings**.
   - **`clientSecret` = Channel secret** — also on **Basic settings** (issue/copy it there).
5. Send back the **Channel ID** (`clientId`) and the **Channel secret** (`clientSecret`).

Then create the `ServiceLogin` with those values (provider `line`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting LINE sign-in as done.

## LINE-specific note — email is mandatory and needs a separate permission application

**Weegloo requires a member email.** If the provider returns none, Weegloo **rejects the sign-in
server-side** (before any callback) and **no `ServiceUser` is created** — the same email-required
failure the **`weegloo-service-login-github`** skill documents as `WGL422056`. A member with no email is
therefore a **blocked sign-in, not a state to design around**: without an email the person simply
**cannot use the service**.

LINE makes this easy to hit: it does **not** return the member's email just because the channel exists.
The **email address permission** must be applied for separately in the channel's **OpenID Connect**
settings (submit the requested form / screenshot and accept the terms). Until LINE grants it, no email
is returned and every sign-in is rejected.

So treat email as **mandatory setup**, not optional:

- Apply for the LINE **email permission** early — it is a LINE-side approval, not a runtime toggle you
  can flip from code — and don't go live until it is granted.
- Even after approval, a user who **declines** the email consent cannot sign in; the abort is
  server-side and unrecoverable in code, so **tell end users up front** that a shared email is required
  (same lever as the GitHub case).

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver).
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
