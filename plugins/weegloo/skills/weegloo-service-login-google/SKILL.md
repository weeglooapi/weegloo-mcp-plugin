---
name: weegloo-service-login-google
description: Provider-specific setup for Weegloo ServiceLogin with **Google** OAuth 2.0 — the exact Google Cloud Console steps to create an OAuth client and obtain the `clientId` / `clientSecret`, the Google redirect URI to register (`https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/google`), the OAuth consent screen / Test users gotcha, and the walkthrough to hand the user when asking for the blocking credentials. Use ONLY when the chosen provider is Google. For the provider-agnostic wire protocol / SDK / callback flow see `weegloo-service-login-sdk`; for the conceptual model see `weegloo-service-login`. Do not use this for another provider (GitHub, Facebook, GitLab, LINE, Kakao, or Naver).
---

# Weegloo ServiceLogin — Google provider setup

This is the **Google instance** of the provider-agnostic ServiceLogin setup. It covers only the
**Google Cloud Console** side: creating the OAuth client and producing the `clientId` / `clientSecret`
that `ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-sdk`** (the spine). This skill does **not** decide whether to use Google —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-Google provider** (other providers follow the same *shape*, but their console steps differ —
> GitHub, Kakao, Naver, and LINE have their own dedicated skills; Facebook and GitLab ride the spine's
> generic shape — see *Configuration responsibilities* in the spine).

## Google's redirect URI (deploy-independent — register it now)

In the Google Cloud Console OAuth client, the **Authorized redirect URI** is, with the real `{spaceId}`
substituted:

```
https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/google
```

- The `/code/` segment is required — it is the **Google → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/google`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `google`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Google Cloud OAuth client** and only the user
can produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
this step-by-step walkthrough, with the real `{spaceId}` already filled into the redirect URI above:

1. Go to the **Google Cloud Console → OAuth clients** page (create or select a project first):
   **https://console.cloud.google.com/auth/clients** . Hand the user that link — it drops them
   straight on the client list. If Google has relocated it (they move console pages periodically), fall
   back to the durable menu path — **Google Auth Platform → Clients** (older consoles: **APIs &
   Services → Credentials**) — which is the anchor; re-find the current URL from Google's docs if the
   link 404s.
2. **First time only:** configure the **OAuth consent screen** (User type **External**; set an app name
   + support email). While the app stays in *Testing*, add the signing-in Google account under **Test
   users**, otherwise sign-in is blocked.
3. **+ Create Credentials → OAuth client ID**, and for **Application type select `Web application`** —
   give it a name. **Choose `Web application` even when your product is an Android / iOS app**; do
   *not* pick the "Android" or "iOS" type. Weegloo's redirect URI is `https://auth.weegloo.com/…` (a
   web URL), so from Google's side the OAuth client is always a web app — a native app receives its
   token via the `https` WebHosting deep-link bridge, not a Google native client (see
   **`weegloo-service-login-sdk`** → *Native apps (Android / iOS)*).
4. Under **Authorized redirect URIs**, **Add URI** and paste **exactly** the redirect URI above (with
   the real `{spaceId}`). **No "Authorized JavaScript origins" are needed** — the browser navigates to
   `auth.weegloo.com`, never to Google directly.
5. Click **Create**, then copy the **Client ID** and **Client Secret** from the dialog and send both
   back.

Then create the `ServiceLogin` with those values (provider `google`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting Google sign-in as done.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-sdk`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
